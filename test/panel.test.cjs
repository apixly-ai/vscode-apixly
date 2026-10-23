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

test("authorization buttons accept only host-owned actions and reject injected URLs", async (t) => {
  for (const type of ["openAuthorization", "copyAuthorization"]) {
    assert.deepEqual(validateMessage({ type }), { type });
    for (const field of ["url", "verificationUri", "expiresAt"])
      assert.throws(() =>
        validateMessage({ type, [field]: "https://attacker.example" }),
      );
  }
  const opened = [],
    copied = [];
  const uri = "https://apixly.ai/connect/current?user_code=ABCD-EF12";
  const f = await setup(t, {
    credentialSession: {
      view: async () => ({ mode: "manual", hasCredential: false }),
      openAuthorization: async ({ openExternal }) => openExternal(uri),
      copyAuthorization: async ({ writeText }) => writeText(uri),
      connect: async ({ onPending }) =>
        onPending({
          userCode: "ABCD-EF12",
          expiresAt: 10000,
          verificationUri: uri,
        }),
    },
  });
  f.vscode.env.openExternal = async (value) => opened.push(String(value));
  f.vscode.env.clipboard = { writeText: async (value) => copied.push(value) };
  await f.studio.handle({ type: "openAuthorization" });
  await f.studio.handle({ type: "copyAuthorization" });
  await f.studio.handle({ type: "connectAccount" });
  assert.deepEqual(opened, [uri]);
  assert.deepEqual(copied, [uri]);
  assert.equal(f.calls.length, 0);
  assert(!JSON.stringify(f.messages).includes(uri));
  const html = renderHtml({
    cspSource: "resource:",
    scriptUri: "studio.js",
    styleUri: "studio.css",
    nonce: "n",
  });
  assert(html.includes('data-action="openAuthorization"'));
  assert(html.includes('data-action="copyAuthorization"'));
  assert(html.includes("Open authorization page"));
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

async function setup(t, options = {}) {
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
    models: async () => [
      { id: "grok-imagine-image", type: "image" },
      { id: "gemini-3.1-flash-image", type: "image" },
    ],
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
    clientFactory:
      options.clientFactory ||
      ((key) => {
        assert.equal(key, secret);
        return client;
      }),
    catalogResolver: options.catalogResolver,
    credentialSession: options.credentialSession,
    actions: {
      setApiKey: async () => undefined,
      clearApiKey: async () => undefined,
    },
  });
  return {
    root,
    messages,
    errors,
    state,
    studio,
    calls,
    client,
    vscode,
    context,
  };
}

test("host recomputes typed creative controls for image, edit and video without adding vendor parameters", async (t) => {
  const { composeCreativePrompt } = require("../media/creative-controls.js");
  for (const kind of ["image", "edit", "video"]) {
    const f = await setup(t);
    const tools = {
      angle: { enabled: true, yaw: 180, pitch: 30 },
      lighting: { enabled: true, preset: "goldenHour", rimLight: true },
      camera: { enabled: true, focal: 85, aperture: "f/1.8" },
    };
    const prompt = "  Keep my toy car.\n Original details.  ";
    if (kind === "edit") await f.studio.handle({ type: "selectReferences" });
    f.client.submitVideo = async (request) => {
      f.calls.push(request);
      return { id: "video-task", status: "queued" };
    };
    await f.studio.handle({
      type: "submit",
      kind,
      model: "exact-model",
      prompt,
      params: '{"seed":7}',
      tools,
    });
    assert.equal(f.calls.length, 1);
    assert.equal(
      f.calls[0].prompt,
      composeCreativePrompt({
        prompt,
        mode: kind === "edit" ? "edit" : "generate",
        tools,
      }).final_prompt,
    );
    assert.equal(f.calls[0].model, "exact-model");
    assert.deepEqual(f.calls[0].params, { seed: 7 });
    assert(!Object.hasOwn(f.calls[0], "tools"));
    assert(!JSON.stringify([...f.state]).includes("Keep my toy car"));
    assert(!JSON.stringify([...f.state]).includes("goldenHour"));
    if (kind === "edit")
      assert.deepEqual(f.calls[0].refs[0].bytes, Buffer.from([1, 2, 3]));
    await f.studio.dispose();
  }
});

test("invalid creative settings and forged final prompt fail before a client or paid POST", async (t) => {
  const f = await setup(t);
  let secretReads = 0;
  f.context.secrets.get = async () => {
    secretReads++;
    return "actual-secret";
  };
  for (const extra of [
    { tools: { angle: { enabled: true, pitch: 91 } } },
    { tools: { camera: { enabled: "yes" } } },
    { final_prompt: "forged" },
    {
      prompt: "x".repeat(20000),
      tools: { camera: { enabled: true, focal: 85 } },
    },
  ]) {
    await f.studio.handle({
      type: "submit",
      kind: "image",
      model: "m",
      prompt: "p",
      params: "{}",
      ...extra,
    });
  }
  assert.equal(secretReads, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.messages.filter((m) => m.type === "error").length, 4);
});

test("the creative interface has accessible controls and loads the same compiler before its controller", () => {
  const html = renderHtml({
    cspSource: "vscode-resource:",
    scriptUri: "vscode-resource:/studio.js",
    styleUri: "vscode-resource:/studio.css",
    logoUri: "vscode-resource:/icon.png",
    creativeUri: "vscode-resource:/creative-controls.js",
    creativeUiUri: "vscode-resource:/creative-ui.js",
    nonce: "nonce",
  });
  assert.match(html, /id="creative-controls"/);
  assert.match(html, /id="final-prompt"[^>]*readonly/);
  assert.match(html, /AI prompt controls/);
  assert.match(html, /id="angle-enabled"/);
  assert.match(html, /id="lighting-enabled"/);
  assert.match(html, /id="camera-enabled"/);
  assert(
    html.indexOf('src="vscode-resource:/creative-controls.js"') <
      html.indexOf('src="vscode-resource:/creative-ui.js"'),
  );
  assert(
    html.indexOf('src="vscode-resource:/creative-ui.js"') <
      html.indexOf('src="vscode-resource:/studio.js"'),
  );
});

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

test("saving a key prepares lazy catalog loading without exposing a credential", async (t) => {
  const f = await setup(t);
  let reads = 0;
  f.client.models = async () => {
    reads++;
    return [{ id: "available-image", type: "image" }];
  };
  await f.studio.handle({ type: "setKey" });
  assert.equal(reads, 0);
  await f.studio.handle({ type: "requestCatalog" });
  assert.equal(reads, 1);
  assert.ok(
    f.messages.some(
      (message) =>
        message.type === "catalog" &&
        message.models.some((model) => model.id === "available-image"),
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

test("empty base with enabled style is valid but an empty final prompt is rejected before inference", () => {
  const result = validateMessage({
    type: "submit",
    kind: "image",
    model: "m",
    prompt: "",
    params: "{}",
    tools: { camera: { enabled: true, focal: 85 } },
  });
  assert.equal(result.prompt, "Lens: 85mm telephoto");
  assert.throws(() =>
    validateMessage({
      type: "submit",
      kind: "image",
      model: "m",
      prompt: "  ",
      params: "{}",
    }),
  );
  const html = renderHtml({
    cspSource: "vscode-resource:",
    scriptUri: "studio.js",
    styleUri: "studio.css",
    logoUri: "icon.png",
    nonce: "n",
  });
  assert.doesNotMatch(html, /<textarea id="prompt"[^>]*\brequired\b/);
});

test("Copy final prompt recomputes typed settings without a key, HTTP or task persistence", async (t) => {
  const f = await setup(t);
  const copied = [];
  f.context.secrets.get = async () => {
    throw Error("Copy must not read a key");
  };
  f.vscode.env.clipboard = { writeText: async (value) => copied.push(value) };
  const payload = {
    type: "copyPrompt",
    kind: "edit",
    prompt: "Keep car",
    tools: { lighting: { enabled: true, preset: "goldenHour" } },
  };
  await f.studio.handle(payload);
  assert.equal(copied.length, 1);
  assert(copied[0].includes("Change the lighting"));
  assert(
    copied[0].endsWith(
      "Preserve all subject and scene details that are not explicitly requested to change.",
    ),
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.size, 0);
  assert(f.messages.some((m) => m.type === "promptCopied"));
  await f.studio.handle({ ...payload, final_prompt: "forged" });
  assert.equal(copied.length, 1);
});

test("catalog is lazy, de-duplicates concurrent picker loads, and preserves complete typed image IDs", async (t) => {
  const f = await setup(t);
  let calls = 0;
  f.client.models = async () => {
    calls++;
    return [
      {
        id: "seedream-5-0",
        type: "image",
        name: "Seedream",
        future: { keep: true },
      },
      { id: "future-x", type: "image" },
    ];
  };
  await f.studio.handle({ type: "ready" });
  assert.equal(calls, 0);
  await Promise.all([
    f.studio.handle({ type: "requestCatalog" }),
    f.studio.handle({ type: "requestCatalog" }),
  ]);
  assert.equal(calls, 1);
  const catalog = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(catalog.available, true);
  assert.equal(catalog.models[0].id, "seedream-5-0");
  assert.equal(catalog.models[0].future.keep, true);
  await f.studio.handle({ type: "requestCatalog" });
  assert.equal(calls, 1);
  await f.studio.handle({ type: "refreshCatalog" });
  assert.equal(calls, 2);
});

test("a late catalog response from an old key cannot overwrite a newer selected identity", async (t) => {
  let current = "old-key",
    releaseOld,
    oldStarted = false;
  const factory = (key) => ({
    models: async () =>
      key === "old-key"
        ? ((oldStarted = true),
          await new Promise((resolve) => (releaseOld = resolve)))
        : [{ id: "new-only", type: "image" }],
    videoCapabilities: async () => [],
  });
  const f = await setup(t, { clientFactory: factory });
  f.context.secrets.get = async () => current;
  const old = f.studio.handle({ type: "requestCatalog" });
  for (let i = 0; i < 20 && !oldStarted; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert(oldStarted);
  current = "new-key";
  await f.studio.handle({ type: "ready" });
  await f.studio.handle({ type: "requestCatalog" });
  releaseOld([{ id: "old-only", type: "image" }]);
  await old;
  const last = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(last.models[0].id, "new-only");
  assert(!JSON.stringify(f.messages).includes("old-key"));
  assert(!JSON.stringify(f.messages).includes("new-key"));
});

test("model interface offers a complete picker, exact manual ID, refresh and catalog state", () => {
  const html = renderHtml({
    cspSource: "vscode-resource:",
    scriptUri: "studio.js",
    styleUri: "studio.css",
    logoUri: "icon.png",
    catalogUri: "model-catalog.js",
    nonce: "n",
  });
  assert.match(html, /id="model-picker"/);
  assert.match(html, /id="refresh-catalog"/);
  assert.match(html, /id="catalog-status"/);
  assert.match(html, /src="model-catalog.js"/);
});

test("a delayed old credential read cannot invalidate or fetch after a newer key is active", async (t) => {
  let read = 0,
    releaseOld;
  const loads = [];
  const f = await setup(t, {
    clientFactory: (key) => ({
      models: async () => {
        loads.push(key);
        return [
          { id: key === "new-key" ? "new-only" : "old-only", type: "image" },
        ];
      },
      videoCapabilities: async () => [],
    }),
  });
  f.context.secrets.get = async () =>
    read++ === 0
      ? await new Promise((resolve) => (releaseOld = resolve))
      : "new-key";
  const old = f.studio.handle({ type: "requestCatalog" });
  await new Promise((resolve) => setImmediate(resolve));
  await f.studio.handle({ type: "requestCatalog" });
  releaseOld("old-key");
  await old;
  assert.deepEqual(loads, ["new-key"]);
});

test("video configuration failure keeps authoritative images and same-identity last-known capabilities", async (t) => {
  const f = await setup(t);
  const models = [
    { id: "seedream-5-0", type: "image" },
    { id: "video-owned", type: "video" },
  ];
  f.client.models = async () => models;
  f.client.videoCapabilities = async () => {
    throw Error("private upstream failure");
  };
  await f.studio.handle({ type: "requestCatalog" });
  let catalog = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(catalog.available, true);
  assert.deepEqual(catalog.models, models);
  assert.deepEqual(catalog.videos, []);
  assert.match(catalog.capabilitiesError, /Video parameters are unavailable/);
  assert(!JSON.stringify(catalog).includes("private upstream"));
  const cap = {
    model: "video-owned",
    modes: ["text2video"],
    seconds: { min: 1, max: 10 },
  };
  f.client.videoCapabilities = async () => [
    cap,
    { model: "removed-video", modes: [] },
  ];
  await f.studio.handle({ type: "refreshCatalog" });
  f.client.videoCapabilities = async () => {
    throw Error("private");
  };
  await f.studio.handle({ type: "refreshCatalog" });
  catalog = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.deepEqual(catalog.videos, [cap]);
  assert.equal(catalog.stale, true);
  assert.match(catalog.capabilitiesError, /saved video parameters/);
  f.client.models = async () => {
    throw Error("permission list unavailable");
  };
  f.client.videoCapabilities = async () => [
    { model: "not-authorized", modes: ["text2video"] },
  ];
  await f.studio.handle({ type: "refreshCatalog" });
  catalog = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.deepEqual(catalog.models, models);
  assert.deepEqual(catalog.videos, [cap]);
  assert(catalog.error);
});

test("account panel accepts only typed metadata actions, reuses the active provider, and never receives credentials", async (t) => {
  const actions = [],
    copied = [],
    keys = [
      { id: "7", name: "Owned quota", masked: "sk…7", is_default: false },
    ];
  const connection = {
    connection_id: "c",
    account: { id: "42", name: "QA", email: "qa@example.test" },
    selected_key: keys[0],
    selection_revision: 2,
    expires_at: "2027-01-01",
  };
  let selected = 0;
  const session = {
    view: async () => ({
      mode: "account",
      hasConnection: true,
      hasCredential: true,
      account: connection,
      keys,
    }),
    resolve: async () => ({
      identity: `account:${"a".repeat(64)}`,
      client: {
        models: async () => [{ id: "seedream-5-0", type: "image" }],
        videoCapabilities: async () => [],
      },
    }),
    selectKey: async (id) => {
      selected++;
      actions.push(["select", id]);
    },
    refresh: async () => {
      actions.push(["refresh"]);
    },
    disconnect: async () => {
      actions.push(["disconnect"]);
    },
    connect: async ({ openExternal, onPending }) => {
      await onPending({
        userCode: "ABCD",
        verificationUri: "https://apixly.ai/connect/a",
        expiresAt: 10000,
        intervalMs: 5000,
      });
      await openExternal("https://apixly.ai/connect/a");
    },
    cancelConnect: () => {
      actions.push(["cancel"]);
    },
    useManual: async () => {
      actions.push(["manual"]);
    },
  };
  const f = await setup(t, { credentialSession: session });
  f.context.secrets.get = async () => {
    throw Error("panel must not read raw account secrets");
  };
  f.vscode.env.openExternal = async (url) => {
    copied.push(String(url));
    return true;
  };
  await f.studio.handle({ type: "ready" });
  const state = f.messages.filter((m) => m.type === "state").at(-1);
  assert.deepEqual(state.connection.account, connection);
  assert.equal(state.hasKey, true);
  await f.studio.handle({ type: "selectAccountKey", keyId: "7" });
  assert.equal(selected, 1);
  for (const type of [
    "refreshAccount",
    "connectAccount",
    "cancelConnection",
    "disconnectAccount",
    "useManualKey",
  ])
    await f.studio.handle({ type });
  assert(copied.includes("https://apixly.ai/connect/a"));
  assert(
    f.messages.some((m) => m.type === "authorization" && m.userCode === "ABCD"),
  );
  await f.studio.handle({ type: "requestCatalog" });
  assert.equal(
    f.messages.filter((m) => m.type === "catalog").at(-1).models[0].id,
    "seedream-5-0",
  );
  for (const bad of [
    { type: "connectAccount", password: "secret" },
    { type: "selectAccountKey", keyId: "7", token: "secret" },
    { type: "selectAccountKey", keyId: "../foreign" },
  ])
    assert.throws(() => validateMessage(bad));
  assert(!JSON.stringify(f.messages).includes("Bearer"));
  const html = renderHtml({
    cspSource: "resource:",
    scriptUri: "studio.js",
    styleUri: "studio.css",
    nonce: "n",
  });
  for (const id of [
    "account-key",
    "account-summary",
    "authorization-code",
    "authorization-progress",
  ])
    assert(html.includes(`id="${id}"`));
  assert(html.includes('data-action="connectAccount"'));
  assert(html.includes('data-action="cancelConnection"'));
  assert(html.includes('data-action="disconnectAccount"'));
  assert(html.includes('data-action="useManualKey"'));
  assert(!html.includes('type="password"'));
});

test("failed account Key selection restores authoritative metadata instead of leaving a phantom UI choice", async (t) => {
  let reads = 0;
  const f = await setup(t, {
    credentialSession: {
      view: async () => {
        reads++;
        return {
          mode: "account",
          hasCredential: true,
          account: { selected_key: { id: "studixly" } },
          keys: [],
        };
      },
      selectKey: async () => {
        throw Object.assign(Error("Key unavailable"), { safe: true });
      },
      resolve: async () => ({
        identity: `account:${"a".repeat(64)}`,
        client: {},
      }),
    },
  });
  await f.studio.handle({ type: "selectAccountKey", keyId: "7" });
  assert(reads > 0);
  assert.equal(
    f.messages.filter((m) => m.type === "state").at(-1).connection.account
      .selected_key.id,
    "studixly",
  );
  assert(f.messages.some((m) => m.type === "error"));
});

test("closing Studio cancels only its pending local account authorization", async (t) => {
  let cancelled = 0;
  const f = await setup(t, {
    credentialSession: {
      cancelConnect: () => {
        cancelled++;
      },
    },
  });
  await f.studio.dispose();
  assert.equal(cancelled, 1);
});

test("each account picker refresh resolves authoritative revision before choosing the cached identity; cached-only does no metadata I/O", async (t) => {
  let authoritative = 1,
    observed = 1;
  const resolutions = [],
    loads = [];
  const account = () => ({
    connection_id: "c",
    account: { id: "42" },
    selected_key: { id: "studixly" },
    selection_revision: observed,
  });
  const session = {
    view: async () => ({
      mode: "account",
      hasConnection: true,
      hasCredential: true,
      account: account(),
      keys: [],
    }),
    resolve: async (options) => {
      resolutions.push(options);
      if (options.refreshAccount) observed = authoritative;
      const revision = observed;
      return {
        identity: `account:${String(revision).repeat(64)}`,
        client: {
          models: async () => {
            loads.push(revision);
            return [{ id: `revision-${revision}`, type: "image" }];
          },
          videoCapabilities: async () => [],
        },
      };
    },
  };
  const f = await setup(t, { credentialSession: session });
  await f.studio.handle({ type: "ready" });
  assert.equal(resolutions.length, 0);
  await f.studio.handle({ type: "requestCatalog" });
  assert.equal(resolutions[0].refreshAccount, true);
  authoritative = 2;
  await f.studio.handle({ type: "requestCatalog" });
  assert.deepEqual(loads, [1, 2]);
  assert.equal(
    f.messages.filter((m) => m.type === "catalog").at(-1).models[0].id,
    "revision-2",
  );
});

test("transient account metadata errors retain stale same-identity models; invalid connection clears them", async (t) => {
  let failure;
  const account = {
    connection_id: "c",
    account: { id: "42" },
    selected_key: { id: "studixly" },
    selection_revision: 1,
  };
  const session = {
    view: async () => ({
      mode: "account",
      hasConnection: true,
      hasCredential: failure?.code !== "unauthorized",
      account,
      keys: [],
      error: failure ? "Account unavailable" : null,
    }),
    resolve: async () => {
      if (failure) throw failure;
      return {
        identity: require("../src/catalog-cache.cjs").catalogIdentity({
          mode: "account",
          connectionId: "c",
          accountId: "42",
          keyId: "studixly",
          revision: 1,
        }),
        client: {
          models: async () => [{ id: "saved-image", type: "image" }],
          videoCapabilities: async () => [],
        },
      };
    },
  };
  const f = await setup(t, { credentialSession: session });
  await f.studio.handle({ type: "requestCatalog" });
  failure = Error("private transport details");
  await f.studio.handle({ type: "requestCatalog" });
  let last = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(last.available, true);
  assert.equal(last.stale, true);
  assert(last.error);
  assert.equal(last.models[0].id, "saved-image");
  assert(!JSON.stringify(last).includes("private transport"));
  await f.studio.handle({ type: "ready" });
  last = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(last.available, true);
  assert.equal(last.stale, true);
  failure = Object.assign(Error("Choose another active Key."), {
    safe: true,
    code: "selected_key_unavailable",
  });
  await f.studio.handle({ type: "requestCatalog" });
  last = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(last.available, true);
  assert.equal(last.stale, true);
  assert.equal(last.models[0].id, "saved-image");
  failure = Object.assign(Error("Reconnect account."), {
    safe: true,
    code: "unauthorized",
  });
  await f.studio.handle({ type: "requestCatalog" });
  last = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(last.available, false);
  assert.equal(last.clear, true);
});

test("an unidentified replacement connection cannot recover the previous account's stale catalog after metadata failure", async (t) => {
  let metadata = {
    connection_id: "A",
    account: { id: "A" },
    selected_key: { id: "studixly" },
    selection_revision: 1,
  };
  let failure = false;
  const session = {
    view: async () => ({
      mode: "account",
      hasConnection: true,
      hasCredential: true,
      account: metadata,
      keys: [],
    }),
    resolve: async () => {
      if (failure) throw Error("new account metadata unavailable");
      return {
        identity: require("../src/catalog-cache.cjs").catalogIdentity({
          mode: "account",
          connectionId: "A",
          accountId: "A",
          keyId: "studixly",
          revision: 1,
        }),
        client: {
          models: async () => [{ id: "only-account-A", type: "image" }],
          videoCapabilities: async () => [],
        },
      };
    },
  };
  const f = await setup(t, { credentialSession: session });
  await f.studio.handle({ type: "requestCatalog" });
  assert.equal(
    f.messages.filter((m) => m.type === "catalog").at(-1).models[0].id,
    "only-account-A",
  );
  metadata = null;
  failure = true;
  await f.studio.handle({ type: "requestCatalog" });
  const last = f.messages.filter((m) => m.type === "catalog").at(-1);
  assert.equal(last.available, false);
  assert.equal(last.clear, true);
  assert.deepEqual(last.models, []);
});
