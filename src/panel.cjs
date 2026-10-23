"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { composeCreativePrompt } = require("../media/creative-controls.js");
const { renderCreativePanel } = require("./creative-panel.cjs");
const { renderAccountPanel } = require("./account-panel.cjs");
const {
  parseModelCatalog,
  parseVideoConfig,
} = require("../media/model-catalog.js");
const {
  createCatalogResolver,
  catalogIdentity,
} = require("./catalog-cache.cjs");
const {
  createClient,
  parseStudioParameters,
  pollTask,
  saveExclusive,
  taskRecord,
  validateVideoReferences,
  validateReferenceUrl,
} = require("./core.cjs");
const LINKS = Object.freeze({
  home: "https://apixly.ai",
  models: "https://platform.apixly.ai/models",
  console: "https://platform.apixly.ai/keys",
  usage: "https://platform.apixly.ai/usage/logs",
  docs: "https://apixly.ai/docs",
});
const SIMPLE = new Set([
  "ready",
  "setKey",
  "clearKey",
  "selectReferences",
  "selectMask",
  "clearReferences",
  "clearMask",
  "cancelPolling",
  "clearVideoReferences",
  "requestCatalog",
  "refreshCatalog",
  "connectAccount",
  "cancelConnection",
  "disconnectAccount",
  "refreshAccount",
  "useManualKey",
]);
const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
function problem(message) {
  return Object.assign(new Error(message), { safe: true });
}
function exactKeys(value, keys) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw problem("Unrecognized panel message fields.");
}
function shortString(value, maximum = 200) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  );
}
function creativePrompt(message) {
  const composed = composeCreativePrompt({
    prompt: message.prompt,
    mode: message.kind === "edit" ? "edit" : "generate",
    ...(message.tools === undefined ? {} : { tools: message.tools }),
  });
  if (!composed.final_prompt.trim())
    throw problem("Enter a prompt or enable creative instructions first.");
  return composed.final_prompt;
}

function validateMessage(message) {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    Object.getPrototypeOf(message) !== Object.prototype
  )
    throw problem("Invalid panel message.");
  if (
    /mask/i.test(String(message.type)) ||
    Object.keys(message).some((key) => /mask/i.test(key))
  )
    throw problem(
      "Mask edits are not available in this release because no model passed visual qualification. No generation was submitted.",
    );
  if (SIMPLE.has(message.type)) {
    exactKeys(message, ["type"]);
    return message;
  }
  if (message.type === "openLink") {
    exactKeys(message, ["type", "link"]);
    if (!Object.hasOwn(LINKS, message.link))
      throw problem("Unknown Apixly link.");
    return message;
  }
  if (message.type === "selectAccountKey") {
    exactKeys(message, ["type", "keyId"]);
    if (
      typeof message.keyId !== "string" ||
      !(message.keyId === "studixly" || /^[1-9]\d{0,19}$/.test(message.keyId))
    )
      throw problem("Choose an active API Key you own.");
    return message;
  }
  if (message.type === "addVideoUrl") {
    exactKeys(message, ["type", "url"]);
    return { ...message, url: validateReferenceUrl(message.url) };
  }
  if (message.type === "saveAsset" || message.type === "useGeneratedImage") {
    exactKeys(message, ["type", "id"]);
    if (!shortString(message.id)) throw problem("Invalid asset selection.");
    return message;
  }
  if (message.type === "resumeTask") {
    exactKeys(message, ["type", "id", "kind"]);
    if (!shortString(message.id) || !["image", "video"].includes(message.kind))
      throw problem("Enter a valid task ID and type.");
    return message;
  }
  if (message.type === "submit") {
    exactKeys(message, ["type", "kind", "model", "prompt", "params", "tools"]);
    if (
      !["image", "edit", "video"].includes(message.kind) ||
      !shortString(message.model) ||
      typeof message.prompt !== "string" ||
      message.prompt.length > 20000 ||
      typeof message.params !== "string" ||
      message.params.length > 32768
    )
      throw problem("Enter a model ID, prompt, and valid parameters.");
    return {
      ...message,
      prompt: creativePrompt(message),
      params: parseStudioParameters(
        message.params,
        message.kind === "video" ? "video" : "image",
      ),
    };
  }
  if (message.type === "copyPrompt") {
    exactKeys(message, ["type", "kind", "prompt", "tools"]);
    if (!["image", "edit", "video"].includes(message.kind))
      throw problem("Choose a valid creation mode.");
    return { ...message, prompt: creativePrompt(message) };
  }
  throw problem("Unknown panel action.");
}

function escaped(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function renderHtml({
  cspSource,
  scriptUri,
  styleUri,
  logoUri,
  creativeUri,
  creativeUiUri,
  catalogUri,
  nonce,
}) {
  const csp = `default-src 'none'; img-src ${cspSource} data:; media-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; font-src ${cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escaped(csp)}"><link rel="stylesheet" href="${escaped(styleUri)}"><title>Apixly Media Studio</title></head>
<body><div class="app-shell">
<header class="topbar"><a class="brand" href="https://apixly.ai" data-link="home"><img src="${escaped(logoUri)}" alt="Apixly" width="34" height="34"><span>apixly<span class="brand-tag">MEDIA STUDIO</span></span></a><div class="top-actions"><span id="connection" class="connection">Checking connection</span><button id="settings-toggle" class="icon-button" aria-label="Open account settings" title="Account settings">⚙</button></div></header>
<section class="intro"><p class="eyebrow">FROM IDEA TO PROJECT ASSET</p><h1>Create images. <span>Bring them to life.</span></h1><p class="intro-copy">Generate and edit with apixly.ai, then save finished assets straight into your project.</p></section>
${renderAccountPanel()}
<main class="workspace-grid"><section class="composer glass"><div class="section-label"><span>01 / CREATE</span><a href="https://platform.apixly.ai/models" data-link="models">Explore models ↗</a></div>
<div class="mode-tabs" role="tablist" aria-label="Creation type"><button class="mode-tab active" role="tab" aria-selected="true" data-mode="image">✦ Image</button><button class="mode-tab" role="tab" aria-selected="false" data-mode="edit">◈ Edit image</button><button class="mode-tab" role="tab" aria-selected="false" data-mode="video">▷ Video</button></div>
<form id="creation-form"><div class="catalog-heading"><label for="model-picker">Available models</label><button id="refresh-catalog" type="button" class="button ghost compact">Refresh models</button></div><select id="model-picker" aria-label="Available models"><option value="">Enter an exact model ID</option></select><p id="catalog-status" class="field-hint" role="status">Open the picker to load models for your selected key.</p><label for="model">Exact model ID <span class="label-hint">Editable · never silently replaced</span></label><input id="model" name="model" list="model-options" value="grok-imagine-image" placeholder="Choose or enter a model ID" required maxlength="200" autocomplete="off"><datalist id="model-options"></datalist><p id="model-hint" class="field-hint">Choose any image model available to your Apixly key.</p>
<label for="prompt">Your idea</label><textarea id="prompt" name="prompt" rows="5" maxlength="20000" placeholder="A sculptural glass object, electric blue light, a quiet studio. Describe what you want to see…"></textarea><div class="prompt-footer"><span>Be specific about subject, light, and composition.</span><span id="prompt-count">0 / 20,000</span></div>
${renderCreativePanel()}
<div id="reference-section" class="reference-section hidden"><div class="label-row"><span class="field-label">Reference images</span><button type="button" class="text-button" id="clear-references">Clear</button></div><button type="button" id="pick-references" class="dropzone"><span class="dropzone-symbol">＋</span><strong>Choose reference images</strong><small>PNG, JPG, WebP, GIF, AVIF · up to 20 MiB each</small></button><div id="reference-list" class="reference-list"></div></div>
<div id="video-reference-section" class="reference-section hidden"><div class="label-row"><span class="field-label">Video reference image URL</span><button type="button" class="text-button" id="clear-video-references">Clear</button></div><div class="url-entry"><input id="video-reference-url" type="url" placeholder="https://…/image.png" aria-label="Public HTTPS video reference URL"><button type="button" id="attach-video-url" class="button secondary compact">Attach URL</button></div><div id="video-reference-list" class="reference-list"></div><p class="field-hint">Current qualified Grok reference video requires a public HTTPS image link. Local files are not uploaded or hosted. Or choose “Use for video” on a generated image below.</p></div><div class="parameters"><div id="aspect-ratio-row"><label for="aspect-ratio">Aspect ratio</label><select id="aspect-ratio"><option value="">Model default</option><option value="1:1">1:1</option><option>16:9</option><option>9:16</option><option>4:3</option><option>3:4</option></select></div><div id="video-duration-row" class="hidden"><label for="duration">Duration <span class="label-hint">seconds</span></label><input id="duration" type="number" min="1" max="30" step="1" value="1"></div><div id="video-resolution-row" class="hidden"><label for="resolution">Resolution</label><select id="resolution"><option value="">Model default</option><option>480p</option><option selected>720p</option><option>1080p</option><option>4k</option></select></div></div>
<details class="advanced"><summary>Advanced model parameters</summary><p class="field-hint">Optional JSON. These explicit values take precedence over the fields above. Supported options depend on the exact model.</p><textarea id="advanced-params" rows="3" spellcheck="false" aria-label="Advanced model parameters">{}</textarea></details>
<p class="billing-note"><span>◈</span> Free extension. Generation uses your Apixly balance. <a href="https://platform.apixly.ai/models" data-link="models">View prices ↗</a></p><button id="generate" type="submit" class="button primary generate-button"><span id="generate-label">Generate image</span><span>↗</span></button></form></section>
<section class="output-column"><div class="output glass"><div class="section-label"><span>02 / YOUR OUTPUT</span><span id="output-status" class="status-chip">Ready when you are</span></div><div id="empty-output" class="empty-output"><div class="orbit"><div class="orbit-inner">✦</div></div><h2>A little imagination.<br>A whole new possibility.</h2><p>Your finished image or video appears here.<br>Preview it, then save it straight into your project.</p></div><div id="progress-section" class="progress-section hidden" aria-live="polite"><div class="progress-heading"><span class="spinner"></span><strong id="progress-title">Creating your asset</strong></div><div class="progress-track"><div id="progress-bar"></div></div><p id="progress-detail">Preparing your request…</p><p id="task-id" class="task-id"></p><button id="cancel-polling" class="button secondary compact">Stop waiting</button><p class="fine-print">Stops local polling only. The upstream task may continue and incur charges.</p></div><div id="results" class="results"></div><div id="message" class="message hidden" role="status"></div></div>
<section class="history glass"><div class="section-label"><span>03 / KEEP GOING</span><span id="history-count">Task history</span></div><label for="task-history" class="sr-only">Recent tasks</label><select id="task-history"><option value="">Choose a recent task</option></select><div class="resume-controls"><select id="resume-kind" aria-label="Existing task type"><option value="image">Image task</option><option value="video">Video task</option></select><input id="resume-id" placeholder="Or paste a task ID" aria-label="Existing task ID"><button id="resume-task" class="button secondary compact">Resume</button></div><p class="field-hint">Reloaded VS Code? Resume by task ID. This never submits a new generation.</p></section></section></main>
<footer><span>Made for your creative workflow.</span><a href="https://apixly.ai" data-link="home">Powered by apixly.ai ↗</a></footer></div><script nonce="${escaped(nonce)}" src="${escaped(catalogUri)}"></script><script nonce="${escaped(nonce)}" src="${escaped(creativeUri)}"></script><script nonce="${escaped(nonce)}" src="${escaped(creativeUiUri)}"></script><script nonce="${escaped(nonce)}" src="${escaped(scriptUri)}"></script></body></html>`;
}

function createStudio({
  context,
  vscode,
  webview,
  cacheRoot,
  clientFactory = createClient,
  actions,
  catalogResolver = createCatalogResolver(),
  credentialSession,
}) {
  let selected = [];
  let videoReferences = [];
  let mask;
  let busy = false;
  let disposed = false;
  let controller;
  let catalogEpoch = 0;
  let activeCatalogIdentity;
  const assets = new Map();
  const send = (message) =>
    disposed
      ? Promise.resolve(false)
      : Promise.resolve(webview.postMessage(message));
  const tasks = () => context.globalState.get("apixlyMedia.tasks", []);
  async function api() {
    if (credentialSession) return (await credentialSession.resolve()).client;
    const key = await context.secrets.get("apixlyMedia.apiKey");
    if (!key) throw problem("Connect an Apixly API key to start creating.");
    return clientFactory(key);
  }
  async function state({ refreshAccount = false } = {}) {
    let connection;
    if (credentialSession) {
      try {
        connection = await credentialSession.view({ refresh: refreshAccount });
      } catch (error) {
        connection = {
          ...(await credentialSession.view()),
          hasCredential: false,
          error: error.safe
            ? error.message
            : "Could not refresh your account. Reconnect or try again.",
        };
      }
    }
    await send({
      type: "state",
      hasKey: connection
        ? connection.hasCredential
        : Boolean(await context.secrets.get("apixlyMedia.apiKey")),
      ...(connection ? { connection } : {}),
      tasks: tasks().map(taskRecord),
      references: selected.map((item) => ({
        name: item.name,
        bytes: item.bytes.length,
        previewUri: item.previewFile
          ? webview.asWebviewUri(vscode.Uri.file(item.previewFile)).toString()
          : undefined,
      })),
      videoReferences: videoReferences.map((item) => ({
        name: item.name,
        origin: new URL(item.url).origin,
      })),
      mask: mask ? { name: "PNG mask", bytes: mask.bytes.length } : null,
    });
  }
  async function remember(job) {
    await context.globalState.update(
      "apixlyMedia.tasks",
      [
        taskRecord(job),
        ...tasks().filter(
          (item) => item.id !== job.id || item.kind !== job.kind,
        ),
      ].slice(0, 100),
    );
  }
  async function choose(maskOnly = false) {
    const uris = await vscode.window.showOpenDialog({
      title: maskOnly ? "Choose a PNG edit mask" : "Choose reference images",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: !maskOnly,
      filters: maskOnly
        ? { "PNG mask": ["png"] }
        : { Images: Object.keys(IMAGE_TYPES) },
    });
    if (!uris?.length) return;
    if (uris.length + (maskOnly ? 0 : selected.length) > 8)
      throw problem(
        "Select up to eight images; model-specific limits may be lower.",
      );
    const next = [];
    let total = maskOnly
      ? 0
      : selected.reduce((sum, item) => sum + item.bytes.length, 0);
    for (const uri of uris) {
      const stat = await vscode.workspace.fs.stat(uri);
      total += stat.size;
      if (stat.size > 20 * 1024 * 1024 || total > 80 * 1024 * 1024)
        throw problem(
          "References are limited to 20 MiB each and 80 MiB total.",
        );
      const extension = path
        .extname(uri.path || uri.fsPath)
        .slice(1)
        .toLowerCase();
      const type = IMAGE_TYPES[extension];
      if (!type || (maskOnly && type !== "image/png"))
        throw problem("Choose supported image files; masks must be PNG.");
      const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
      if (!bytes.length || bytes.length > 20 * 1024 * 1024)
        throw problem("Reference image is empty or larger than 20 MiB.");
      await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
      const previewFile = path.join(
        cacheRoot,
        `reference-${crypto.randomUUID()}.${extension}`,
      );
      await fs.writeFile(previewFile, bytes, { flag: "wx", mode: 0o600 });
      next.push({
        bytes,
        type,
        name: `reference-${(maskOnly ? 0 : selected.length) + next.length + 1}.${extension}`,
        previewFile,
      });
    }
    if (maskOnly) {
      if (mask?.previewFile) await fs.rm(mask.previewFile, { force: true });
      [mask] = next;
    } else {
      selected = [...selected, ...next];
    }
    await state();
  }
  async function finish(apiClient, job) {
    controller = new AbortController();
    const result = await pollTask(apiClient, job, {
      signal: controller.signal,
      onStatus: async (status) => {
        job.status = status.status;
        await remember(job);
        await send({
          type: "progress",
          task: taskRecord(job),
          progress: status.progress,
        });
      },
    });
    if (!result.assets?.length)
      throw problem(
        "The task completed without a downloadable asset. Check your existing task in Apixly activity.",
      );
    await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    for (const asset of assets.values())
      await fs.rm(asset.file, { force: true });
    assets.clear();
    const previews = [];
    for (const asset of result.assets) {
      const download = await apiClient.download(asset, job, controller.signal);
      if (disposed) return;
      const id = crypto.randomUUID();
      const file = path.join(cacheRoot, `${id}${download.extension}`);
      await fs.writeFile(file, download.bytes, { flag: "wx", mode: 0o600 });
      assets.set(id, {
        file,
        extension: download.extension,
        kind: job.kind,
        sourceUrl: asset.url,
      });
      previews.push({
        id,
        kind: job.kind,
        bytes: download.bytes.length,
        extension: download.extension,
        previewUri: webview.asWebviewUri(vscode.Uri.file(file)).toString(),
        canUseForVideo: job.kind === "image" && typeof asset.url === "string",
      });
    }
    await send({ type: "result", task: taskRecord(job), assets: previews });
    await state();
  }
  async function run(message) {
    if (busy)
      throw problem(
        "A task is already running in this panel. Stop waiting before starting another.",
      );
    if (!vscode.workspace.isTrusted)
      throw problem("Open a trusted workspace to use Apixly Media.");
    const release = credentialSession?.hold();
    busy = true;
    await send({ type: "busy", value: true });
    try {
      const apiClient = await api();
      let job;
      if (message.type === "resumeTask") {
        job = tasks().find(
          (item) => item.id === message.id && item.kind === message.kind,
        ) || {
          id: message.id,
          kind: message.kind,
          status: "unknown",
          submittedAt: Date.now(),
        };
      } else {
        if (message.kind === "edit" && !selected.length)
          throw problem("Choose at least one reference image for editing.");
        const params = { ...message.params };
        if (message.kind === "video" && videoReferences.length)
          params.images = [
            ...(params.images || []),
            ...videoReferences.map((item) => item.url),
          ];
        if (message.kind === "video")
          await validateVideoReferences(apiClient, message.model, params);
        await send({ type: "submitting" });
        const submitted =
          message.kind === "video"
            ? await apiClient.submitVideo({
                model: message.model,
                prompt: message.prompt,
                params,
              })
            : await apiClient.submitImage({
                model: message.model,
                prompt: message.prompt,
                params,
                refs: message.kind === "edit" ? selected : [],
                mask: message.kind === "edit" ? mask : undefined,
              });
        job = {
          id: submitted.id,
          kind: message.kind === "video" ? "video" : "image",
          model: message.model,
          status: submitted.status,
          submittedAt: Date.now(),
        };
        await send({ type: "submitted", task: taskRecord(job) });
        await remember(job);
      }
      await finish(apiClient, job);
    } finally {
      release?.();
      busy = false;
      controller = undefined;
      await send({ type: "busy", value: false });
    }
  }
  async function save(id) {
    const asset = assets.get(id);
    if (!asset)
      throw problem(
        "This preview is no longer available. Resume its task to retrieve it again.",
      );
    const folders =
      vscode.workspace.workspaceFolders?.filter(
        (folder) => folder.uri.scheme === "file",
      ) || [];
    if (!folders.length)
      throw problem("Open a local workspace folder, then save this asset.");
    const folder =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({
            placeHolder: "Choose a workspace for this asset",
          });
    if (folder?.uri.scheme !== "file") return;
    const destination = await vscode.window.showSaveDialog({
      title: "Save to your project (existing files are preserved)",
      defaultUri: vscode.Uri.file(
        path.join(folder.uri.fsPath, `apixly-${Date.now()}${asset.extension}`),
      ),
      filters: { Media: [asset.extension.slice(1)] },
    });
    if (!destination) return;
    if (destination.scheme !== "file")
      throw problem("Select a local workspace file.");
    await saveExclusive(
      folder.uri.fsPath,
      destination.fsPath,
      await fs.readFile(asset.file),
    );
    await send({
      type: "saved",
      id,
      filename: path.basename(destination.fsPath),
    });
  }
  async function publishCatalog({ cachedOnly = false, force = false } = {}) {
    const epoch = ++catalogEpoch;
    const connected = credentialSession
      ? await credentialSession.view()
      : undefined;
    const key = credentialSession
      ? undefined
      : await context.secrets.get("apixlyMedia.apiKey");
    if (disposed || epoch !== catalogEpoch) return;
    if (connected ? !connected.hasCredential : !key) {
      if (activeCatalogIdentity)
        catalogResolver.invalidate(activeCatalogIdentity);
      activeCatalogIdentity = undefined;
      await send({
        type: "catalog",
        models: [],
        videos: [],
        available: false,
        clear: true,
      });
      return;
    }
    const resolved = credentialSession
      ? await credentialSession.resolve({ refreshAccount: force })
      : undefined;
    if (disposed || epoch !== catalogEpoch) return;
    const identity = resolved
      ? resolved.identity
      : catalogIdentity({ mode: "manual", key });
    if (activeCatalogIdentity && activeCatalogIdentity !== identity)
      catalogResolver.invalidate(activeCatalogIdentity);
    activeCatalogIdentity = identity;
    const publish = async (status) => {
      if (
        !disposed &&
        epoch === catalogEpoch &&
        activeCatalogIdentity === identity
      )
        await send({ type: "catalog", ...status, clear: !status.available });
    };
    if (cachedOnly) {
      await publish(catalogResolver.peek(identity));
      return;
    }
    const cached = catalogResolver.peek(identity);
    await publish({ ...cached, refreshing: true });
    const status = await catalogResolver.read(
      identity,
      async () => {
        const client = resolved ? resolved.client : clientFactory(key);
        const results = await Promise.allSettled([
          typeof client.modelCatalog === "function"
            ? client.modelCatalog()
            : client.models().then((data) => ({ data })),
          client.videoCapabilities(),
        ]);
        if (results[0].status === "rejected") throw results[0].reason;
        const envelope = parseModelCatalog(results[0].value);
        const models = envelope.data;
        const allowed = new Set(models.map((model) => model.id));
        let videos;
        let capabilitiesError = null;
        try {
          if (results[1].status === "rejected") throw results[1].reason;
          videos = parseVideoConfig({ data: results[1].value });
        } catch {
          videos = catalogResolver.peek(identity).videos || [];
          capabilitiesError = videos.length
            ? "Video parameters are unavailable. Showing saved video parameters; try Refresh models."
            : "Video parameters are unavailable. Image models are ready; try Refresh models for video controls.";
        }
        videos = videos.filter((row) => allowed.has(row.model));
        const { data, ...metadata } = envelope;
        return { models, videos, metadata, capabilitiesError };
      },
      { force, onUpdate: publish },
    );
    await publish(status);
  }
  return {
    async handle(raw) {
      if (disposed) return;
      try {
        const message = validateMessage(raw);
        if (message.type === "ready") {
          await state({ refreshAccount: Boolean(credentialSession) });
          await publishCatalog({ cachedOnly: true });
        } else if (
          [
            "connectAccount",
            "cancelConnection",
            "disconnectAccount",
            "refreshAccount",
            "selectAccountKey",
            "useManualKey",
          ].includes(message.type)
        ) {
          if (!credentialSession)
            throw problem("Account connection is unavailable in this host.");
          try {
            if (message.type === "cancelConnection")
              credentialSession.cancelConnect();
            else if (message.type === "connectAccount")
              await credentialSession.connect({
                openExternal: (url) =>
                  vscode.env.openExternal(
                    vscode.Uri.parse ? vscode.Uri.parse(url) : url,
                  ),
                onPending: (flow) => send({ type: "authorization", ...flow }),
              });
            else if (message.type === "disconnectAccount")
              await credentialSession.disconnect();
            else if (message.type === "refreshAccount")
              await credentialSession.refresh();
            else if (message.type === "selectAccountKey")
              await credentialSession.selectKey(message.keyId);
            else await credentialSession.useManual();
          } finally {
            await state();
            await publishCatalog({ cachedOnly: true });
          }
        } else if (
          message.type === "requestCatalog" ||
          message.type === "refreshCatalog"
        ) {
          await publishCatalog({ force: message.type === "refreshCatalog" });
        } else if (message.type === "copyPrompt") {
          await vscode.env.clipboard.writeText(message.prompt);
          await send({ type: "promptCopied" });
        } else if (message.type === "openLink") {
          await vscode.env.openExternal(
            vscode.Uri.parse
              ? vscode.Uri.parse(LINKS[message.link])
              : LINKS[message.link],
          );
        } else if (message.type === "setKey" || message.type === "clearKey") {
          await actions[
            message.type === "setKey" ? "setApiKey" : "clearApiKey"
          ]();
          await state();
          await publishCatalog({ cachedOnly: true });
        } else if (
          message.type === "selectReferences" ||
          message.type === "selectMask"
        ) {
          if (busy)
            throw problem(
              "Wait until the current request has finished before changing references.",
            );
          await choose(message.type === "selectMask");
        } else if (message.type === "clearReferences") {
          if (!busy) {
            for (const item of [...selected, mask].filter(Boolean))
              if (item.previewFile)
                await fs.rm(item.previewFile, { force: true });
            selected = [];
            mask = undefined;
            await state();
          }
        } else if (message.type === "clearMask") {
          if (!busy) {
            if (mask?.previewFile)
              await fs.rm(mask.previewFile, { force: true });
            mask = undefined;
            await state();
          }
        } else if (message.type === "cancelPolling") {
          controller?.abort();
        } else if (message.type === "addVideoUrl") {
          if (busy)
            throw problem(
              "Wait until the current request is finished before changing video references.",
            );
          if (videoReferences.length >= 8)
            throw problem(
              "Use up to eight URL references; model-specific limits may be lower.",
            );
          if (!videoReferences.some((item) => item.url === message.url))
            videoReferences.push({
              url: message.url,
              name: "Public image URL",
            });
          await state();
        } else if (message.type === "clearVideoReferences") {
          if (!busy) {
            videoReferences = [];
            await state();
          }
        } else if (message.type === "useGeneratedImage") {
          if (busy)
            throw problem(
              "Wait until the current request is finished before choosing a video preset.",
            );
          const asset = assets.get(message.id);
          if (asset?.kind !== "image" || !asset.sourceUrl)
            throw problem(
              "This result has no reusable public image link. Attach your own public HTTPS image URL instead.",
            );
          const url = validateReferenceUrl(asset.sourceUrl);
          videoReferences = [{ url, name: "Generated image link" }];
          await state();
          await send({
            type: "videoPreset",
            model: "grok-imagine-video-1.5-preview",
          });
        } else if (message.type === "saveAsset") {
          await save(message.id);
        } else {
          await run(message);
        }
      } catch (error) {
        await send({
          type: "error",
          message: `${error.safe ? error.message : "The operation could not complete. No paid request was retried. Check your existing task in Apixly activity before submitting again."}${error.unknownOutcome ? " Submission outcome is unknown. Check Apixly activity before submitting again." : ""}`,
        });
      }
    },
    async dispose() {
      credentialSession?.cancelConnect?.();
      disposed = true;
      catalogEpoch++;
      controller?.abort();
      selected = [];
      videoReferences = [];
      mask = undefined;
      assets.clear();
      await fs.rm(cacheRoot, { recursive: true, force: true });
    },
  };
}

module.exports = { LINKS, validateMessage, renderHtml, createStudio };
