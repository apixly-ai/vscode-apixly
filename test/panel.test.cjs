// biome-ignore-all lint/suspicious/useAwait: Async doubles match VS Code and HTTP interfaces.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  validateMessage,
  renderHtml,
  createStudio,
} = require("../src/panel.cjs");

test("panel protocol rejects unknown commands, extra fields, paths and credential payloads", () => {
  for (const message of [
    null,
    [],
    { type: "execute", command: "rm" },
    { type: "setKey", key: "secret" },
    { type: "saveAsset", id: "a", path: "../escape" },
    { type: "openLink", link: "https://attacker.example" },
    {
      type: "submit",
      kind: "image",
      model: "m",
      prompt: "p",
      params: "{}",
      apiKey: "secret",
    },
  ])
    assert.throws(() => validateMessage(message));
  assert.deepEqual(
    validateMessage({
      type: "submit",
      kind: "edit",
      model: "gemini-3.1-flash-image",
      prompt: "Change color",
      params: "{}",
    }),
    {
      type: "submit",
      kind: "edit",
      model: "gemini-3.1-flash-image",
      prompt: "Change color",
      params: {},
    },
  );
});

test("rendered panel uses restrictive CSP and contains helpful verified Apixly routes", () => {
  const html = renderHtml({
    cspSource: "vscode-resource:",
    scriptUri: "vscode-resource:/studio.js",
    styleUri: "vscode-resource:/studio.css",
    logoUri: "vscode-resource:/icon.png",
    nonce: "randomnonce",
  });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'nonce-randomnonce'/);
  assert.ok(!html.includes("unsafe-inline") && !html.includes("apiKey"));
  assert.match(html, /platform\.apixly\.ai\/models/);
  assert.match(html, /apixly\.ai\/docs/);
  assert.match(html, /Free extension/);
  assert.match(html, /usage/i);
});

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apixly-panel-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const messages = [];
  const errors = [];
  const state = new Map();
  const secret = "actual-secret";
  const context = {
    globalStorageUri: { fsPath: root },
    globalState: {
      get: (key, fallback) => state.get(key) ?? fallback,
      update: async (key, value) => state.set(key, value),
    },
    secrets: { get: async () => secret },
  };
  const webview = {
    postMessage: async (message) => messages.push(message),
    asWebviewUri: (uri) => ({
      toString: () => `vscode-resource:${uri.fsPath}`,
    }),
  };
  const vscode = {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
    env: { openExternal: async () => true },
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ uri: { scheme: "file", fsPath: root } }],
      fs: {
        stat: async () => ({ size: 3 }),
        readFile: async () => Buffer.from([1, 2, 3]),
      },
    },
    window: {
      showOpenDialog: async () => [
        {
          scheme: "file",
          fsPath: path.join(root, "ref.png"),
          path: path.join(root, "ref.png"),
        },
      ],
      showSaveDialog: async () => ({
        scheme: "file",
        fsPath: path.join(root, "saved.png"),
      }),
      showErrorMessage: async (message) => errors.push(message),
      showInformationMessage: async () => undefined,
    },
  };
  const calls = [];
  const client = {
    models: async () => ["grok-imagine-image", "gemini-3.1-flash-image"],
    videoCapabilities: async () => [],
    submitImage: async (request) => {
      calls.push(request);
      return { id: "image-task", status: "queued" };
    },
    status: async () => ({
      status: "succeeded",
      assets: [{ url: "https://cdn.example.com/result" }],
    }),
    download: async () => ({
      bytes: Buffer.from([137, 80, 78, 71]),
      extension: ".png",
    }),
  };
  const studio = createStudio({
    context,
    vscode,
    webview,
    cacheRoot: path.join(root, "previews"),
    clientFactory: (key) => {
      assert.equal(key, secret);
      return client;
    },
    actions: {
      setApiKey: async () => undefined,
      clearApiKey: async () => undefined,
    },
  });
  return { root, messages, errors, state, studio, calls, client, vscode };
}

test("panel uses host-owned references, emits previews without secrets and saves only a selected asset", async (t) => {
  const f = await setup(t);
  await f.studio.handle({ type: "ready" });
  await f.studio.handle({ type: "selectReferences" });
  await f.studio.handle({
    type: "submit",
    kind: "edit",
    model: "gemini-3.1-flash-image",
    prompt: "Change to blue",
    params: "{}",
  });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].refs[0].bytes, Buffer.from([1, 2, 3]));
  const completed = f.messages.find((message) => message.type === "result");
  assert.equal(completed.assets.length, 1);
  assert.ok(completed.assets[0].previewUri.startsWith("vscode-resource:"));
  assert.ok(!JSON.stringify(f.messages).includes("actual-secret"));
  assert.ok(
    !JSON.stringify(f.state.get("apixlyMedia.tasks")).includes(
      "Change to blue",
    ),
  );
  await f.studio.handle({ type: "saveAsset", id: completed.assets[0].id });
  assert.deepEqual(
    await fs.readFile(path.join(f.root, "saved.png")),
    Buffer.from([137, 80, 78, 71]),
  );
  await f.studio.dispose();
  await assert.rejects(fs.access(path.join(f.root, "previews")));
});

test("panel refuses duplicate submissions while a request is unresolved", async (t) => {
  const f = await setup(t);
  let finish;
  f.client.submitImage = async (request) => {
    f.calls.push(request);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const first = f.studio.handle({
    type: "submit",
    kind: "image",
    model: "m",
    prompt: "p",
    params: "{}",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await f.studio.handle({
    type: "submit",
    kind: "image",
    model: "m",
    prompt: "p",
    params: "{}",
  });
  assert.equal(f.calls.length, 1);
  finish({ id: "i", status: "queued" });
  await first;
  assert.ok(
    f.messages.some(
      (message) => message.type === "error" && /already/i.test(message.message),
    ),
  );
  await f.studio.dispose();
});

test("saving a key refreshes authenticated model metadata without exposing a credential", async (t) => {
  const f = await setup(t);
  let reads = 0;
  f.client.models = async () => {
    reads++;
    return ["available-image"];
  };
  await f.studio.handle({ type: "setKey" });
  assert.equal(reads, 1);
  assert.ok(
    f.messages.some(
      (message) =>
        message.type === "catalog" &&
        message.models.includes("available-image"),
    ),
  );
  assert.ok(!JSON.stringify(f.messages).includes("actual-secret"));
  await f.studio.dispose();
});

test("stopping panel polling preserves the task and resuming does not repeat its POST", async (t) => {
  const f = await setup(t);
  f.client.status = async () => ({ status: "queued", assets: [] });
  const pending = f.studio.handle({
    type: "submit",
    kind: "image",
    model: "exact",
    prompt: "p",
    params: "{}",
  });
  for (
    let attempt = 0;
    attempt < 20 && !f.messages.some((message) => message.type === "progress");
    attempt++
  )
    await new Promise((resolve) => setImmediate(resolve));
  await f.studio.handle({ type: "cancelPolling" });
  await pending;
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.get("apixlyMedia.tasks")[0].id, "image-task");
  assert.ok(
    f.messages.some(
      (message) =>
        message.type === "error" &&
        /upstream task may still run/.test(message.message),
    ),
  );
  f.client.status = async () => ({
    status: "succeeded",
    assets: [{ url: "https://cdn.example.com/recovered" }],
  });
  await f.studio.handle({
    type: "resumeTask",
    kind: "image",
    id: "image-task",
  });
  assert.equal(f.calls.length, 1);
  assert.ok(f.messages.some((message) => message.type === "result"));
  await f.studio.dispose();
});

test("reference selection can add images incrementally without losing earlier choices", async (t) => {
  const f = await setup(t);
  await f.studio.handle({ type: "selectReferences" });
  await f.studio.handle({ type: "selectReferences" });
  await f.studio.handle({
    type: "submit",
    kind: "edit",
    model: "gemini-3.1-flash-image",
    prompt: "Combine the references",
    params: "{}",
  });
  assert.equal(f.calls[0].refs.length, 2);
  await f.studio.dispose();
});

test("video references require confirmed model support before a paid POST and are never dropped", async (t) => {
  const f = await setup(t);
  f.client.submitVideo = async (request) => {
    f.calls.push(request);
    return { id: "video-task", status: "queued" };
  };
  f.client.videoCapabilities = async () => [
    { model: "grok-imagine-video", modes: ["text2video"], max_input_images: 1 },
    {
      model: "grok-imagine-video-1.5-preview",
      modes: ["image2video"],
      max_input_images: 1,
    },
  ];
  await f.studio.handle({
    type: "addVideoUrl",
    url: "https://example.com/reference.png",
  });
  await f.studio.handle({
    type: "submit",
    kind: "video",
    model: "grok-imagine-video",
    prompt: "Animate this image",
    params: "{}",
  });
  assert.equal(f.calls.length, 0);
  assert.ok(
    f.messages.some(
      (message) =>
        message.type === "error" && /text prompts only/.test(message.message),
    ),
  );
  await f.studio.handle({
    type: "submit",
    kind: "video",
    model: "grok-imagine-video-1.5-preview",
    prompt: "Animate this image",
    params: '{"seconds":3}',
  });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].params.images, [
    "https://example.com/reference.png",
  ]);
  await f.studio.dispose();
});

test("public panel rejects unqualified mask edits and does not advertise a mask control", () => {
  for (const message of [
    { type: "selectMask" },
    {
      type: "submit",
      kind: "edit",
      model: "m",
      prompt: "p",
      params: '{"mask":"data:image/png;base64,AAAA"}',
    },
    {
      type: "submit",
      kind: "edit",
      model: "m",
      prompt: "p",
      params: "{}",
      mask: "x",
    },
  ])
    assert.throws(
      () => validateMessage(message),
      /not available|not qualified/i,
    );
  const html = renderHtml({
    cspSource: "source",
    scriptUri: "script",
    styleUri: "style",
    logoUri: "logo",
    nonce: "nonce",
  });
  assert.ok(!html.includes('id="pick-mask"'));
  assert.match(html, /<option value="1:1">1:1<\/option>/);
});

test("video URL selection is explicit and generated-image preset never submits a generation", async (t) => {
  assert.throws(() =>
    validateMessage({ type: "addVideoUrl", url: "file:///private/a.png" }),
  );
  assert.equal(
    validateMessage({ type: "addVideoUrl", url: "https://example.com/ref.png" })
      .url,
    "https://example.com/ref.png",
  );
  const f = await setup(t);
  await f.studio.handle({
    type: "submit",
    kind: "image",
    model: "grok-imagine-image",
    prompt: "p",
    params: "{}",
  });
  const result = f.messages.find((message) => message.type === "result");
  await f.studio.handle({ type: "useGeneratedImage", id: result.assets[0].id });
  assert.equal(f.calls.length, 1);
  assert.ok(
    f.messages.some(
      (message) =>
        message.type === "videoPreset" &&
        message.model === "grok-imagine-video-1.5-preview",
    ),
  );
  f.client.videoCapabilities = async () => [
    {
      model: "grok-imagine-video-1.5-preview",
      modes: ["image2video"],
      max_input_images: 1,
    },
  ];
  f.client.submitVideo = async (request) => {
    f.calls.push(request);
    return { id: "v", status: "queued" };
  };
  await f.studio.handle({
    type: "submit",
    kind: "video",
    model: "grok-imagine-video-1.5-preview",
    prompt: "animate",
    params: "{}",
  });
  assert.deepEqual(f.calls[1].params.images, [
    "https://cdn.example.com/result",
  ]);
  await f.studio.dispose();
});

test("a local capability rejection preserves the existing paid preview instead of clearing it", async (t) => {
  const f = await setup(t);
  await f.studio.handle({
    type: "submit",
    kind: "image",
    model: "grok-imagine-image",
    prompt: "p",
    params: "{}",
  });
  await f.studio.handle({
    type: "addVideoUrl",
    url: "https://example.com/reference.png",
  });
  f.client.videoCapabilities = async () => [
    { model: "text-only", modes: ["text2video"] },
  ];
  const before = f.messages.length;
  await f.studio.handle({
    type: "submit",
    kind: "video",
    model: "text-only",
    prompt: "animate",
    params: "{}",
  });
  assert.ok(
    !f.messages.slice(before).some((message) => message.type === "submitting"),
  );
  assert.equal(f.calls.length, 1);
  await f.studio.dispose();
});
