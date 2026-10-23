// biome-ignore-all lint/suspicious/useAwait: Async doubles match fetch and status interfaces.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createClient,
  pollTask,
  parseParameters,
  saveExclusive,
  taskRecord,
} = require("../src/core.cjs");

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

test("account mode uses only the fixed first-party relay and never forwards connection authorization to result URLs", async () => {
  const calls = [];
  const api = createClient(
    "apc_connection_secret",
    async (url, init) => {
      calls.push({ url: String(url), ...init });
      if (String(url).endsWith("/models/list"))
        return json({ data: [{ id: "seedream-5-0", type: "image" }] });
      if (
        String(url).endsWith("/content") ||
        String(url).startsWith("https://cdn.example/")
      )
        return new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "video/mp4" },
        });
      return json({ id: "17", status: "queued" });
    },
    { mode: "account" },
  );
  await api.models();
  await api.submitVideo({
    model: "exact-video",
    prompt: "Keep exact",
    params: { seconds: 1 },
  });
  await api.download({}, { kind: "video", id: "17" });
  await api.download(
    { url: "https://cdn.example/result.mp4" },
    { kind: "video", id: "17" },
  );
  assert.deepEqual(
    calls.slice(0, 3).map((r) => r.url),
    [
      "https://apixly.ai/api/integrations/v1/models/list",
      "https://apixly.ai/api/integrations/v1/videos",
      "https://apixly.ai/api/integrations/v1/videos/17/content",
    ],
  );
  assert(
    calls
      .slice(0, 3)
      .every(
        (r) =>
          r.headers.authorization === "Bearer apc_connection_secret" &&
          r.redirect === "error",
      ),
  );
  assert.equal(calls[3].headers.authorization, undefined);
  assert.equal(calls[3].headers["user-agent"], undefined);
  assert.throws(
    () =>
      createClient("secret", async () => {}, { mode: "https://evil.example" }),
    /credential mode/,
  );
});

test("broker submission_unknown 502 preserves unknown outcome and never retries a paid POST", async () => {
  let calls = 0;
  const api = createClient(
    "apc_private",
    async () => {
      calls++;
      return json(
        {
          error: { code: "submission_unknown", type: "submission_unknown" },
          submission_outcome: "unknown",
          automatic_retry: false,
        },
        502,
      );
    },
    { mode: "account" },
  );
  await assert.rejects(
    api.submitImage({ model: "exact-image", prompt: "one explicit request" }),
    (error) =>
      error.safe &&
      error.unknownOutcome === true &&
      !/change.*parameter|try.*model/i.test(error.message),
  );
  assert.equal(calls, 1);
});

test("image submit preserves exact model and sends one async JSON POST", async () => {
  const calls = [];
  const client = createClient("private-key", async (url, init) => {
    calls.push({ url, init });
    return json({ id: "img-1" });
  });
  assert.equal(
    (
      await client.submitImage({
        model: "gpt-image-1-mini",
        prompt: "A red apple",
        params: { size: "1024x1024" },
      })
    ).id,
    "img-1",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://apixly.ai/v1/images/generations");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: "gpt-image-1-mini",
    prompt: "A red apple",
    size: "1024x1024",
    async: true,
  });
  assert.equal(calls[0].init.headers.authorization, "Bearer private-key");
  assert.equal(calls[0].init.redirect, "error");
});

test("edit sends real reference bytes and optional mask as multipart image[]", async () => {
  let captured;
  const client = createClient("key", async (url, init) => {
    captured = { url, init };
    return json({ id: "edit-1" });
  });
  await client.submitImage({
    model: "exact-image-model",
    prompt: "Change sky",
    refs: [
      { name: "ref.png", type: "image/png", bytes: Buffer.from([1, 2, 3]) },
    ],
    mask: { bytes: Buffer.from([4]), type: "image/png" },
  });
  assert.equal(captured.url, "https://apixly.ai/v1/images/edits");
  assert.equal(captured.init.body.get("async"), "true");
  assert.deepEqual(
    Buffer.from(await captured.init.body.get("image[]").arrayBuffer()),
    Buffer.from([1, 2, 3]),
  );
  assert.equal(captured.init.body.get("mask").type, "image/png");
  assert.equal(captured.init.headers["content-type"], undefined);
});

test("video sends flattened options and inline local reference image", async () => {
  let captured;
  const client = createClient("key", async (url, init) => {
    captured = { url, init };
    return json({ id: "vid-1", status: "queued" });
  });
  await client.submitVideo({
    model: "seedance-2.0",
    prompt: "Turn left",
    params: {
      seconds: 5,
      resolution: "720p",
      images: ["data:image/png;base64,AQID"],
      videos: ["https://example.com/a.mp4"],
    },
  });
  assert.equal(captured.url, "https://apixly.ai/v1/videos");
  assert.deepEqual(JSON.parse(captured.init.body), {
    seconds: 5,
    resolution: "720p",
    images: ["data:image/png;base64,AQID"],
    videos: ["https://example.com/a.mp4"],
    model: "seedance-2.0",
    prompt: "Turn left",
  });
});

test("network failure, 5xx and malformed success never repeat a paid POST or expose a key", async () => {
  for (const response of [
    () => {
      throw new Error("private-key upstream error");
    },
    () => json({ error: "private-key" }, 503),
    () => json({}),
  ]) {
    let calls = 0;
    const client = createClient("private-key", async () => {
      calls++;
      return response();
    });
    await assert.rejects(
      client.submitImage({ model: "m", prompt: "p" }),
      (error) =>
        error.unknownOutcome === true && !error.message.includes("private-key"),
    );
    assert.equal(calls, 1);
  }
});

test("advanced parameters cannot replace identity, prompt or async; video arrays remain arrays", () => {
  for (const raw of [
    '{"model":"other"}',
    '{"prompt":"other"}',
    '{"async":false}',
    '{"authorization":"secret"}',
    '{"__proto__":{}}',
  ]) {
    assert.throws(() => parseParameters(raw, "image"));
  }
  assert.throws(() =>
    parseParameters('{"images":"https://example.com/a.png"}', "video"),
  );
  assert.deepEqual(
    parseParameters(
      '{"seconds":5,"videos":["https://example.com/a.mp4"]}',
      "video",
    ),
    { seconds: 5, videos: ["https://example.com/a.mp4"] },
  );
});

test("task identity is URL encoded for status and only explicit success is success", async () => {
  const calls = [];
  const client = createClient("key", async (url) => {
    calls.push(url);
    return json({
      status: "succeeded",
      data: [{ url: "https://apixly.ai/v1/images/content?ref=opaque" }],
    });
  });
  const result = await client.status({
    kind: "image",
    id: "../../foreign?x=1",
  });
  assert.equal(
    calls[0],
    "https://apixly.ai/v1/images/generations/..%2F..%2Fforeign%3Fx%3D1",
  );
  assert.equal(result.status, "succeeded");
  assert.equal(result.assets.length, 1);
});

test("polling cancellation and timeout preserve job and do not invoke upstream cancellation", async () => {
  const job = { id: "vid-1", kind: "video" };
  let calls = 0;
  const client = {
    status: async () => {
      calls++;
      return { status: "queued", assets: [] };
    },
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    pollTask(client, job, { signal: controller.signal }),
    /Polling stopped/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    pollTask(client, job, { timeoutMs: 0 }),
    /Polling timed out/,
  );
  assert.equal(job.id, "vid-1");
});

test("unknown task status is terminal locally and transient status GET may recover", async () => {
  let calls = 0;
  await assert.rejects(
    pollTask(
      { status: async () => ({ status: "mystery" }) },
      { kind: "image", id: "i" },
      { intervalMs: 0 },
    ),
    /Unrecognized/,
  );
  const result = await pollTask(
    {
      status: async () => {
        calls++;
        if (calls === 1) {
          const error = new Error("HTTP 503");
          error.retryable = true;
          throw error;
        }
        return { status: "completed", assets: [] };
      },
    },
    { kind: "video", id: "v" },
    { intervalMs: 0 },
  );
  assert.equal(result.status, "completed");
  assert.equal(calls, 2);
});

test("result download never sends authorization, does not follow redirects or accept HTML", async () => {
  const calls = [];
  const client = createClient("private-key", async (url, init) => {
    calls.push({ url, init });
    return new Response(Buffer.from([1, 2]), {
      headers: { "content-type": "image/png" },
    });
  });
  const result = await client.download(
    { url: "https://cdn.example.com/image.png" },
    { kind: "image", id: "i" },
  );
  assert.equal(result.extension, ".png");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].init.redirect, "error");
  await assert.rejects(
    client.download(
      { url: "http://127.0.0.1/private" },
      { kind: "image", id: "i" },
    ),
    /HTTPS/,
  );
  const htmlClient = createClient(
    "key",
    async () =>
      new Response("<script>bad</script>", {
        headers: { "content-type": "text/html" },
      }),
  );
  await assert.rejects(
    htmlClient.download(
      { url: "https://cdn.example.com/a" },
      { kind: "image", id: "i" },
    ),
    /Unsupported/,
  );
});

test("video content fallback authenticates only the fixed Apixly route", async () => {
  let captured;
  const client = createClient("key", async (url, init) => {
    captured = { url, init };
    return new Response(Buffer.from([1]), {
      headers: { "content-type": "video/mp4" },
    });
  });
  await client.download({}, { kind: "video", id: "v?x" });
  assert.equal(captured.url, "https://apixly.ai/v1/videos/v%3Fx/content");
  assert.equal(captured.init.headers.authorization, "Bearer key");
});

test("save blocks path traversal, symlink escapes and overwrite", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "apixly-media-"));
  const root = path.join(temp, "workspace");
  const outside = path.join(temp, "outside");
  await fs.mkdir(root);
  await fs.mkdir(outside);
  try {
    await assert.rejects(
      saveExclusive(root, path.join(root, "../escape.png"), Buffer.from("x")),
      /workspace/,
    );
    await fs.symlink(outside, path.join(root, "linked"));
    await assert.rejects(
      saveExclusive(
        root,
        path.join(root, "linked/escape.png"),
        Buffer.from("x"),
      ),
      /workspace/,
    );
    const dest = path.join(root, "asset.png");
    await saveExclusive(root, dest, Buffer.from("first"));
    await assert.rejects(
      saveExclusive(root, dest, Buffer.from("second")),
      /exists|EEXIST/,
    );
    assert.equal(await fs.readFile(dest, "utf8"), "first");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("persistent task record excludes prompt, token, URLs and reference content", () => {
  const safe = taskRecord({
    id: "v-1",
    kind: "video",
    model: "exact",
    status: "queued",
    submittedAt: 1,
    key: "secret",
    prompt: "private",
    url: "https://example.com?ref=secret",
    images: ["private"],
  });
  assert.deepEqual(safe, {
    id: "v-1",
    kind: "video",
    model: "exact",
    status: "queued",
    submittedAt: 1,
  });
});

test("invalid JSON does not echo parameter text in an error", () => {
  assert.throws(
    () => parseParameters('{"quality":"private-key"', "image"),
    (error) => !error.message.includes("private-key") && error.safe === true,
  );
});

test("inline images keep their actual file format and reject non-image data", async () => {
  const client = createClient("key", async () => {
    throw new Error("No network expected");
  });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(
    (
      await client.download(
        { b64_json: jpeg.toString("base64") },
        { kind: "image", id: "i" },
      )
    ).extension,
    ".jpg",
  );
  await assert.rejects(
    client.download(
      { b64_json: Buffer.from("not an image").toString("base64") },
      { kind: "image", id: "i" },
    ),
    /image/,
  );
});

test("panel metadata uses authenticated read-only catalog routes", async () => {
  const calls = [];
  const client = createClient("key", async (url, init) => {
    calls.push({ url, init });
    return json({
      data: url.endsWith("/models/list")
        ? [
            {
              id: "seedream-5-0",
              type: "image",
              name: "Seedream",
              pricing: { cost_per_image: 0.02 },
            },
          ]
        : [{ model: "exact-video", seconds: { min: 1, max: 15 } }],
    });
  });
  assert.deepEqual(await client.models(), [
    {
      id: "seedream-5-0",
      type: "image",
      name: "Seedream",
      pricing: { cost_per_image: 0.02 },
    },
  ]);
  assert.equal((await client.videoCapabilities())[0].model, "exact-video");
  assert.deepEqual(
    calls.map((item) => item.url),
    ["https://apixly.ai/v1/models/list", "https://apixly.ai/v1/video/config"],
  );
  assert.ok(
    calls.every(
      (item) =>
        item.init.method === "GET" &&
        item.init.headers.authorization === "Bearer key",
    ),
  );
});

test("support user agent is sent only to Apixly API routes, never result storage", async () => {
  const calls = [];
  const client = createClient("key", async (url, init) => {
    calls.push({ url, init });
    return url.endsWith("/models/list")
      ? json({ data: [] })
      : new Response(Buffer.from([1]), {
          headers: { "content-type": "video/mp4" },
        });
  });
  await client.models();
  await client.download(
    { url: "https://storage.example.com/video.mp4" },
    { kind: "video", id: "v" },
  );
  await client.download({}, { kind: "video", id: "v" });
  assert.equal(
    calls[0].init.headers["user-agent"],
    `apixly-vscode-media/${require("../package.json").version}`,
  );
  assert.equal(calls[1].init.headers["user-agent"], undefined);
  assert.equal(
    calls[2].init.headers["user-agent"],
    `apixly-vscode-media/${require("../package.json").version}`,
  );
});

test("API error details explain invalid input without echoing the key or authorization", async () => {
  const client = createClient("private-key", async () =>
    json(
      {
        error: {
          message:
            "reference media must be publicly accessible URLs; credential private-key; Authorization: Bearer private-key",
        },
      },
      400,
    ),
  );
  await assert.rejects(
    client.submitVideo({ model: "exact", prompt: "p" }),
    (error) =>
      error.message.includes(
        "reference media must be publicly accessible URLs",
      ) &&
      !error.message.includes("private-key") &&
      error.safe === true,
  );
});

test("the current Grok preview URL-only contract rejects inline image data before submission", async () => {
  const { validateVideoReferences } = require("../src/core.cjs");
  const client = {
    videoCapabilities: async () => [
      {
        model: "grok-imagine-video-1.5-preview",
        modes: ["image2video"],
        max_input_images: 1,
      },
    ],
  };
  await assert.rejects(
    validateVideoReferences(client, "grok-imagine-video-1.5-preview", {
      images: ["data:image/png;base64,AAAA"],
    }),
    /public.*URL|HTTPS reference/i,
  );
});

test("reference-mode geometry is explicitly rejected while unqualified fields are never removed silently", async () => {
  const { validateVideoReferences } = require("../src/core.cjs");
  const client = {
    videoCapabilities: async () => [
      {
        model: "grok-imagine-video-1.5-preview",
        modes: ["image2video"],
        max_input_images: 1,
      },
    ],
  };
  const params = {
    images: ["https://example.com/image.png"],
    seconds: 3,
    resolution: "720p",
    aspect_ratio: "16:9",
  };
  await assert.rejects(
    validateVideoReferences(client, "grok-imagine-video-1.5-preview", params),
    /Framing follows|geometry.*not.*qualified/i,
  );
  assert.equal(params.resolution, "720p");
  assert.equal(params.aspect_ratio, "16:9");
  await validateVideoReferences(client, "grok-imagine-video-1.5-preview", {
    images: params.images,
    seconds: 3,
  });
});
