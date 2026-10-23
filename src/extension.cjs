"use strict";

const path = require("node:path");
const {
  createClient,
  parseStudioParameters,
  pollTask,
  saveExclusive,
  taskRecord,
  SUCCESS,
  validateVideoReferences,
  validateReferenceUrl,
} = require("./core.cjs");
const KEY = "apixlyMedia.apiKey";
const HISTORY = "apixlyMedia.tasks";
const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
const controllers = new Set();
let activePanel;
let activeStudio;

function userError(message) {
  return Object.assign(new Error(message), { safe: true });
}

function createCommands(context, vscode, options = {}) {
  const factory = options.clientFactory ?? createClient;
  let submitting = false;
  const polling = new Set();

  function trusted() {
    if (!vscode.workspace.isTrusted) {
      throw userError("Open a trusted workspace to use Apixly Media.");
    }
  }

  async function client() {
    const key = await context.secrets.get(KEY);
    if (!key) {
      throw userError("Run Apixly Media: Set API Key first.");
    }
    return factory(key);
  }

  async function remember(job) {
    const saved = context.globalState.get(HISTORY, []);
    await context.globalState.update(
      HISTORY,
      [
        taskRecord(job),
        ...saved.filter(
          (item) => !(item.id === job.id && item.kind === job.kind),
        ),
      ].slice(0, 100),
    );
  }

  async function chooseTask() {
    const saved = context.globalState.get(HISTORY, []);
    const selection = await vscode.window.showQuickPick(
      [
        { label: "Enter an existing task ID", manual: true },
        ...saved.map((job) => ({
          label: `${job.kind}: ${job.model || "model unknown"}`,
          description: job.id,
          detail: `Last seen: ${job.status || "unknown"}`,
          job,
        })),
      ],
      { title: "Apixly Media — resume an existing task", ignoreFocusOut: true },
    );
    if (!selection) {
      return;
    }
    if (selection.job) {
      return selection.job;
    }
    const kind = await vscode.window.showQuickPick(["image", "video"], {
      title: "Task type",
    });
    if (!kind) {
      return;
    }
    const id = await vscode.window.showInputBox({
      title: "Existing Apixly task ID",
      placeHolder: "Paste the exact task ID",
      ignoreFocusOut: true,
      validateInput: (value) =>
        !value || value !== value.trim() || value.length > 200
          ? "Enter the exact task ID (no surrounding spaces)."
          : undefined,
    });
    if (!id) {
      return;
    }
    return { id, kind, status: "unknown", submittedAt: Date.now() };
  }

  async function references(mask = false) {
    const selected = await vscode.window.showOpenDialog({
      title: mask
        ? "Choose an optional PNG mask (Cancel to skip)"
        : "Choose reference images (Cancel to skip)",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: !mask,
      filters: mask
        ? { "PNG mask": ["png"] }
        : { Images: Object.keys(IMAGE_TYPES) },
    });
    if (!selected?.length) {
      return [];
    }
    if (selected.length > 8) {
      throw userError(
        "Select up to 8 reference images. Model-specific limits may be lower.",
      );
    }
    const result = [];
    let total = 0;
    for (const uri of selected) {
      const stat = await vscode.workspace.fs.stat(uri);
      total += stat.size;
      if (stat.size > 20 * 1024 * 1024 || total > 80 * 1024 * 1024) {
        throw userError(
          "Reference images are limited to 20 MiB each and 80 MiB total.",
        );
      }
      const extension = path.extname(uri.path).slice(1).toLowerCase();
      const type = IMAGE_TYPES[extension];
      if (!type || (mask && type !== "image/png")) {
        throw userError("Select a supported image file; masks must be PNG.");
      }
      const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
      if (bytes.byteLength > 20 * 1024 * 1024) {
        throw userError("Reference image exceeds 20 MiB.");
      }
      result.push({
        name: `reference-${result.length + 1}.${extension}`,
        type,
        bytes,
      });
    }
    return result;
  }

  async function saveResults(api, job, result) {
    if (!result.assets?.length) {
      throw userError(
        "The task finished without a downloadable asset. Check Apixly activity before submitting again.",
      );
    }
    const folders =
      vscode.workspace.workspaceFolders?.filter(
        (folder) => folder.uri.scheme === "file",
      ) || [];
    if (!folders.length) {
      throw userError(
        `Task ${job.id} finished. Open a local workspace folder, then check this task again to save it.`,
      );
    }
    const folder =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({
            placeHolder: "Choose the workspace that will receive these assets",
          });
    if (folder?.uri.scheme !== "file") {
      return;
    }
    let count = 0;
    for (let index = 0; index < result.assets.length; index++) {
      const download = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Apixly Media: downloading asset ${index + 1}/${result.assets.length}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const controller = new AbortController();
          controllers.add(controller);
          const disposable = token.onCancellationRequested(() =>
            controller.abort(),
          );
          try {
            return await api.download(
              result.assets[index],
              job,
              controller.signal,
            );
          } finally {
            disposable.dispose();
            controllers.delete(controller);
          }
        },
      );
      const destination = await vscode.window.showSaveDialog({
        title:
          "Save Apixly asset inside your workspace (existing files are preserved)",
        defaultUri: vscode.Uri.file(
          path.join(
            folder.uri.fsPath,
            `apixly-${job.kind}-${Date.now()}-${index + 1}${download.extension}`,
          ),
        ),
        filters: {
          [job.kind === "image" ? "Image" : "Video"]: [
            download.extension.slice(1),
          ],
        },
      });
      if (!destination) {
        continue;
      }
      if (destination.scheme !== "file") {
        throw userError("Select a local file inside your workspace.");
      }
      await saveExclusive(
        folder.uri.fsPath,
        destination.fsPath,
        download.bytes,
      );
      count++;
    }
    vscode.window.showInformationMessage(
      `Apixly Media: saved ${count} asset(s). Task ID: ${job.id}`,
    );
  }

  async function follow(api, job, once = false) {
    const taskKey = `${job.kind}:${job.id}`;
    if (polling.has(taskKey)) {
      throw userError("This task is already being checked in this window.");
    }
    polling.add(taskKey);
    try {
      const result = once
        ? await api.status(job)
        : await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Apixly ${job.kind}: ${job.id} — Cancel stops local polling only`,
              cancellable: true,
            },
            async (progress, token) => {
              const controller = new AbortController();
              controllers.add(controller);
              const disposable = token.onCancellationRequested(() =>
                controller.abort(),
              );
              try {
                return await pollTask(api, job, {
                  signal: controller.signal,
                  onStatus: async (status) => {
                    job.status = status.status;
                    await remember(job);
                    progress.report({
                      message: `${status.status}${status.progress === undefined ? "" : ` (${status.progress}%)`}`,
                    });
                  },
                });
              } finally {
                disposable.dispose();
                controllers.delete(controller);
              }
            },
          );
      job.status = result.status;
      await remember(job);
      if (SUCCESS.has(result.status)) {
        await saveResults(api, job, result);
      } else {
        vscode.window.showInformationMessage(
          `Apixly task ${job.id}: ${result.status}. Resume Task continues polling without submitting a new request.`,
        );
      }
    } finally {
      polling.delete(taskKey);
    }
  }

  async function generate(kind, edit = false) {
    trusted();
    if (submitting) {
      throw userError(
        "A generation dialog or submission is already open in this window.",
      );
    }
    submitting = true;
    let api;
    let job;
    try {
      api = await client();
      const model = await vscode.window.showInputBox({
        title: `Apixly ${kind}: exact model ID`,
        placeHolder: "Use an exact model ID available to your API key",
        ignoreFocusOut: true,
        validateInput: (value) =>
          !value || value !== value.trim() || value.length > 200
            ? "Enter the exact model ID; no alias or replacement is applied."
            : undefined,
      });
      if (!model) {
        return;
      }
      const prompt = await vscode.window.showInputBox({
        title: `Apixly ${kind}: prompt`,
        prompt:
          "This prompt and any reference files are sent to Apixly and its upstream model service.",
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim() ? undefined : "Enter a prompt.",
      });
      if (!prompt) {
        return;
      }
      const raw = await vscode.window.showInputBox({
        title: "Optional model parameters (JSON)",
        value: "{}",
        prompt:
          kind === "image"
            ? 'Model-specific options, for example {"size":"1024x1024","quality":"low"}. No defaults are added.'
            : 'Flattened video options, for example {"seconds":5,"resolution":"720p","aspect_ratio":"16:9"}. Reference videos/audios may be URL arrays.',
        ignoreFocusOut: true,
        validateInput: (value) => {
          try {
            parseStudioParameters(value, kind);
            return;
          } catch {
            return "Enter a JSON object with valid model options; model, prompt and async cannot be overridden.";
          }
        },
      });
      if (raw === undefined) {
        return;
      }
      const params = parseStudioParameters(raw, kind);
      let refs = [];
      let mask;
      if (edit) {
        refs = await references();
        if (!refs.length) {
          return;
        }
      } else if (kind === "video") {
        const url = await vscode.window.showInputBox({
          title: "Optional public HTTPS reference image URL",
          value: "",
          prompt:
            "Leave empty for text-to-video. Local files are not uploaded or hosted; the model must support image2video.",
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (!value) return;
            try {
              validateReferenceUrl(value);
              return;
            } catch (error) {
              return error.message;
            }
          },
        });
        if (url === undefined) return;
        if (url)
          params.images = [...(params.images || []), validateReferenceUrl(url)];
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Submit one paid ${kind} request using ${model}? Apixly pricing and model limits apply. Cancelling polling does not cancel the upstream task or its charges.`,
        { modal: true },
        "Submit paid request",
      );
      if (confirmed !== "Submit paid request") {
        return;
      }
      if (kind === "video") await validateVideoReferences(api, model, params);
      const submitted =
        kind === "image"
          ? await api.submitImage({ model, prompt, params, refs, mask })
          : await api.submitVideo({ model, prompt, params });
      job = {
        id: submitted.id,
        kind,
        model,
        status: submitted.status,
        submittedAt: Date.now(),
      };
      // Display the task ID before persistence so a storage error cannot hide it.
      vscode.window.showInformationMessage(
        `Apixly submitted ${kind}. Task ID: ${job.id}. Resume Task can recover it after a reload.`,
      );
      await remember(job);
    } finally {
      submitting = false;
    }
    if (job) {
      await follow(api, job);
    }
  }

  const actions = {
    setApiKey: async () => {
      const key = await vscode.window.showInputBox({
        title: "Apixly API key",
        prompt:
          "Stored with VS Code SecretStorage. Never written to settings or workspace files. Obtain a standard API key at https://apixly.ai.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          !value.trim() || /[\r\n]/.test(value)
            ? "Enter a standard Apixly API key."
            : undefined,
      });
      if (key === undefined) {
        return;
      }
      await context.secrets.store(KEY, key.trim());
      vscode.window.showInformationMessage(
        "Apixly API key saved in VS Code SecretStorage.",
      );
    },
    clearApiKey: async () => {
      await context.secrets.delete(KEY);
      vscode.window.showInformationMessage(
        "Apixly API key removed from VS Code SecretStorage.",
      );
    },
    generateImage: () => generate("image"),
    editImage: () => generate("image", true),
    generateVideo: () => generate("video"),
    resumeTask: async () => {
      trusted();
      const job = await chooseTask();
      if (job) {
        await follow(await client(), job);
      }
    },
    checkTask: async () => {
      trusted();
      const job = await chooseTask();
      if (job) {
        await follow(await client(), job, true);
      }
    },
  };
  for (const [name, action] of Object.entries(actions)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `apixlyMedia.${name}`,
        async (argument) => {
          try {
            if (argument !== undefined) {
              if (
                argument &&
                typeof argument === "object" &&
                Object.keys(argument).some((key) => /mask/i.test(key))
              )
                throw userError(
                  "Mask edits are not available in this release. No generation was submitted.",
                );
              throw userError(
                "This command accepts input through its own form. Programmatic arguments are not supported.",
              );
            }
            await action();
          } catch (error) {
            await vscode.window.showErrorMessage(
              `Apixly Media: ${error.safe ? error.message : "Operation could not complete. No request was retried. If submission had started, check Apixly activity before creating another request."}${error.unknownOutcome ? " Submission outcome is unknown. Check Apixly activity before submitting again." : ""}`,
            );
          }
        },
      ),
    );
  }
  return actions;
}

function registerStudio(context, vscode, actions) {
  const { createStudio, renderHtml } = require("./panel.cjs");
  const { createCatalogResolver } = require("./catalog-cache.cjs");
  const catalogResolver = createCatalogResolver();
  const crypto = require("node:crypto");
  const open = () => {
    if (activePanel) {
      activePanel.reveal();
      return;
    }
    const mediaRoot = vscode.Uri.file(
      path.join(context.extensionPath, "media"),
    );
    const cacheRoot = path.join(
      context.globalStorageUri.fsPath,
      "previews",
      crypto.randomUUID(),
    );
    const panel = vscode.window.createWebviewPanel(
      "apixlyMedia.studio",
      "Apixly Media Studio",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot, vscode.Uri.file(cacheRoot)],
      },
    );
    activePanel = panel;
    const resource = (name) =>
      panel.webview
        .asWebviewUri(
          vscode.Uri.file(path.join(context.extensionPath, "media", name)),
        )
        .toString();
    const studio = createStudio({
      context,
      vscode,
      webview: panel.webview,
      cacheRoot,
      actions,
      catalogResolver,
    });
    activeStudio = studio;
    const secretChanges = context.secrets.onDidChange?.((event) =>
      event.key === KEY ? studio.handle({ type: "ready" }) : undefined,
    );
    context.subscriptions.push(
      panel.webview.onDidReceiveMessage((message) => studio.handle(message)),
      panel.onDidDispose(() => {
        secretChanges?.dispose();
        activePanel = undefined;
        activeStudio = undefined;
        studio.dispose().catch(() => undefined);
      }),
      panel,
    );
    panel.webview.html = renderHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: resource("studio.js"),
      styleUri: resource("studio.css"),
      logoUri: resource("icon.png"),
      creativeUri: resource("creative-controls.js"),
      creativeUiUri: resource("creative-ui.js"),
      catalogUri: resource("model-catalog.js"),
      nonce: crypto.randomBytes(24).toString("hex"),
    });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("apixlyMedia.open", open),
  );
  return open;
}

function activate(context) {
  const vscode = require("vscode");
  const actions = createCommands(context, vscode);
  registerStudio(context, vscode, actions);
}
async function deactivate() {
  for (const controller of controllers) {
    controller.abort();
  }
  controllers.clear();
  if (activeStudio) await activeStudio.dispose();
  activeStudio = undefined;
  activePanel = undefined;
}
module.exports = { activate, deactivate, createCommands, registerStudio };
