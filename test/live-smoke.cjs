"use strict";

// Manual, billable acceptance runner. Only the VS Code UI/storage surface is
// adapted; createCommands, HTTP, task polling, downloads and filesystem are real.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("../src/core.cjs");
const { createCommands } = require("../src/extension.cjs");

async function main() {
  if (process.env.APIXLY_LIVE_ACCEPT_CHARGES !== "yes") {
    throw new Error("Explicit live billing authorization is required.");
  }
  const keyFile = process.env.APIXLY_LIVE_KEY_FILE;
  const outputRoot = process.env.APIXLY_LIVE_OUTPUT;
  if (!keyFile || !outputRoot) {
    throw new Error("Provide key fixture and output paths.");
  }
  const { key } = JSON.parse(await fs.readFile(keyFile, "utf8"));
  if (!key) {
    throw new Error("Key fixture has no key.");
  }
  await fs.mkdir(outputRoot, { recursive: true });
  const events = [];
  const tasks = new Map();
  const registered = new Map();
  const files = [];
  const input = [];
  let operation;
  let failed = false;
  const uri = (file) => ({ scheme: "file", fsPath: file, path: file });
  const context = {
    subscriptions: [],
    secrets: { get: () => key },
    globalState: {
      get: (name, fallback) => tasks.get(name) ?? fallback,
      update: (name, value) => {
        tasks.set(name, value);
      },
    },
  };
  const vscode = {
    Uri: { file: uri },
    ProgressLocation: { Notification: 15 },
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ uri: uri(outputRoot) }],
      fs: {
        stat: (file) => fs.stat(file.fsPath),
        readFile: (file) => fs.readFile(file.fsPath),
      },
    },
    commands: {
      registerCommand: (name, callback) => {
        registered.set(name, callback);
        return {
          dispose() {
            /* Adapter has no native subscription. */
          },
        };
      },
    },
    window: {
      showInputBox: () => input.shift(),
      showWarningMessage: () => "Submit paid request",
      showInformationMessage: (message) => {
        events.push({ type: "notice", operation, message });
        console.log(message);
      },
      showErrorMessage: (message) => {
        failed = true;
        events.push({ type: "error", operation, message });
        console.error(message);
      },
      showOpenDialog: (options) =>
        operation === "editImage" &&
        !options.title.startsWith("Choose an optional")
          ? [uri(process.env.APIXLY_LIVE_REFERENCE ?? files[0])]
          : undefined,
      showSaveDialog: ({ defaultUri }) => {
        const destination = path.join(
          outputRoot,
          `${operation}${path.extname(defaultUri.fsPath)}`,
        );
        files.push(destination);
        return uri(destination);
      },
      withProgress: (_options, callback) =>
        callback(
          {
            report: (value) => {
              if (value.message) {
                console.log(`${operation}: ${value.message}`);
              }
            },
          },
          {
            onCancellationRequested: () => ({
              dispose() {
                /* Adapter has no native subscription. */
              },
            }),
          },
        ),
    },
  };
  const realFetch = globalThis.fetch;
  const recordedFetch = async (url, init) => {
    const response = await realFetch(url, init);
    const route = new URL(url);
    const event = {
      type: "http",
      operation,
      method: init.method,
      origin: route.origin,
      path: route.pathname,
      status: response.status,
      requestId:
        response.headers.get("x-request-id") ||
        response.headers.get("x-requestid"),
    };
    if (
      init.method === "POST" ||
      route.pathname.match(/\/videos\/[^/]+$|\/images\/generations\/[^/]+$/)
    ) {
      const body = await response
        .clone()
        .json()
        .catch(() => null);
      if (body) {
        event.taskId = body.id;
        event.taskStatus = body.status;
      }
    }
    events.push(event);
    await fs.writeFile(
      path.join(outputRoot, "receipt.json"),
      JSON.stringify(
        { events, tasks: tasks.get("apixlyMedia.tasks"), files },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(event));
    return response;
  };
  const capsResponse = await realFetch("https://apixly.ai/v1/video/config", {
    headers: { authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const caps = await capsResponse.json();
  const video = caps.data?.find((item) => item.model === "grok-imagine-video");
  if (
    !capsResponse.ok ||
    !video?.seconds?.min ||
    !video.resolutions.includes("720p")
  ) {
    throw new Error("Could not verify shortest allowed video parameters.");
  }
  await fs.writeFile(
    path.join(outputRoot, "video-capability.json"),
    JSON.stringify(video, null, 2),
  );
  createCommands(context, vscode, {
    clientFactory: (credential) => createClient(credential, recordedFetch),
  });
  const runs = [
    {
      command: "generateImage",
      model: "grok-imagine-image",
      prompt:
        "A single glossy red cube on a clean pale gray studio floor, soft natural light, no text, square composition.",
      params: {},
    },
    {
      command: "editImage",
      model: process.env.APIXLY_LIVE_EDIT_MODEL ?? "gemini-3.1-flash-image",
      prompt:
        "Change the red cube to blue. Preserve the cube shape, camera position, floor and lighting. No text.",
      params: {},
    },
    {
      command: "generateVideo",
      model: "grok-imagine-video",
      prompt:
        "A small red cube gently rotates on a pale gray studio floor. Fixed camera, soft light, no text.",
      params: {
        seconds: video.seconds.min,
        resolution: "720p",
        aspect_ratio: "16:9",
      },
    },
  ];
  for (const run of runs.filter(
    (candidate) =>
      !process.env.APIXLY_LIVE_ONLY ||
      candidate.command === process.env.APIXLY_LIVE_ONLY,
  )) {
    operation = run.command;
    events.push({ type: "intent", ...run });
    input.push(run.model, run.prompt, JSON.stringify(run.params));
    if (run.command === "generateVideo") input.push("");
    await registered.get(`apixlyMedia.${run.command}`)();
    if (failed) {
      break;
    }
  }
  const artifacts = [];
  for (const file of files) {
    const bytes = await fs.readFile(file);
    artifacts.push({
      file,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const receipt = {
    executedAt: new Date().toISOString(),
    mode: "VS Code surface adapter; production commands, HTTP, polling and files",
    failed,
    events,
    tasks: tasks.get("apixlyMedia.tasks"),
    artifacts,
  };
  await fs.writeFile(
    path.join(outputRoot, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({ failed, artifacts, tasks: receipt.tasks }, null, 2),
  );
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error(
    "Live smoke failed; inspect the sanitized receipt. No POST is retried.",
  );
  process.exitCode = 1;
});
