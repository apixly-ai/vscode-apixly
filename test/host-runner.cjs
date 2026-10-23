"use strict";

// Run by the official VS Code ExtensionHost using --extensionTestsPath.
// This opens the real extension. A persistent Playwright/Electron session drives
// its actual DOM and native dialogs. No key or transport fixture is embedded.
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const crypto = require("node:crypto");
const vscode = require("vscode");

async function run() {
  const signalRoot = process.env.APIXLY_HOST_SIGNAL_DIR;
  if (!signalRoot)
    throw new Error("Set an external acceptance signal directory.");
  await fs.mkdir(signalRoot, { recursive: true });
  // Optional acceptance fixture. Only the test runner reads this file. The
  // packaged extension has no transport override or environment-based bypass.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    let control;
    try {
      control = JSON.parse(
        await fs.readFile(
          path.join(signalRoot, "transport-control.json"),
          "utf8",
        ),
      );
    } catch {
      control = { mode: "live" };
    }
    const isApi =
      parsed.origin === "https://apixly.ai" &&
      parsed.pathname.startsWith("/v1/");
    let response;
    if (isApi && control.mode === "unauthorized")
      response = new Response(
        JSON.stringify({
          error: { message: "Controlled unauthorized acceptance fixture" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    else if (
      isApi &&
      control.mode === "queued" &&
      (parsed.pathname.includes("/images/generations") ||
        parsed.pathname.includes("/videos"))
    )
      response = new Response(
        JSON.stringify({
          id: "fixture-cancelled-locally",
          status: "queued",
          progress: 0,
        }),
        {
          status: init.method === "POST" ? 202 : 200,
          headers: { "content-type": "application/json" },
        },
      );
    else response = await nativeFetch(url, init);
    const event = {
      at: new Date().toISOString(),
      mode: control.mode,
      method: init.method || "GET",
      origin: parsed.origin,
      path: parsed.pathname,
      status: response.status,
      authorizationSent: Boolean(init.headers?.authorization),
      requestId: response.headers.get("x-request-id"),
    };
    if (init.method === "POST") {
      if (init.body instanceof FormData) {
        event.model = init.body.get("model");
        event.promptSha256 = crypto
          .createHash("sha256")
          .update(String(init.body.get("prompt")))
          .digest("hex");
        event.references = [];
        for (const file of init.body.getAll("image[]"))
          event.references.push({
            type: file.type,
            size: file.size,
            sha256: crypto
              .createHash("sha256")
              .update(Buffer.from(await file.arrayBuffer()))
              .digest("hex"),
          });
        const mask = init.body.get("mask");
        if (mask)
          event.mask = {
            type: mask.type,
            size: mask.size,
            sha256: crypto
              .createHash("sha256")
              .update(Buffer.from(await mask.arrayBuffer()))
              .digest("hex"),
          };
      } else if (typeof init.body === "string") {
        const body = JSON.parse(init.body);
        event.model = body.model;
        event.parameters = Object.fromEntries(
          Object.entries(body).filter(
            ([name]) =>
              !["prompt", "images", "videos", "audios"].includes(name),
          ),
        );
        event.promptSha256 = crypto
          .createHash("sha256")
          .update(String(body.prompt))
          .digest("hex");
      }
    }
    if (response.headers.get("content-type")?.includes("application/json")) {
      const data = await response
        .clone()
        .json()
        .catch(() => null);
      if (data) {
        event.jobId = data.id;
        event.jobStatus = data.status;
      }
    }
    await fs.appendFile(
      path.join(signalRoot, "transport.ndjson"),
      `${JSON.stringify(event)}\n`,
    );
    return response;
  };
  const extension = vscode.extensions.getExtension("apixly.apixly-media");
  if (!extension)
    throw new Error("Apixly development extension is not registered.");
  await extension.activate();
  const commands = (await vscode.commands.getCommands(true)).filter((name) =>
    name.startsWith("apixlyMedia."),
  );
  if (commands.length !== 8)
    throw new Error("Expected all eight public Apixly commands.");
  await vscode.commands.executeCommand("apixlyMedia.open");
  await fs.writeFile(
    path.join(signalRoot, "host-ready.json"),
    JSON.stringify(
      {
        officialVSCodeVersion: vscode.version,
        extensionVersion: extension.packageJSON.version,
        extensionPath: extension.extensionPath,
        trusted: vscode.workspace.isTrusted,
        commands,
        readyAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  const started = Date.now();
  while (Date.now() - started < 30 * 60 * 1000) {
    try {
      await fs.access(path.join(signalRoot, "finish"));
      globalThis.fetch = nativeFetch;
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error("ExtensionHost acceptance exceeded 30 minutes.");
}

module.exports = { run };
