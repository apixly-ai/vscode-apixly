"use strict";
const CLIENT_AGENT = `apixly-vscode-media/${require("../package.json").version}`;

const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const BASE = "https://apixly.ai/v1";
const SUCCESS = new Set(["succeeded", "completed", "success"]);
const PENDING = new Set([
  "queued",
  "pending",
  "in_progress",
  "running",
  "processing",
]);
const FAILURE = new Set(["failed", "expired", "cancelled", "canceled"]);
const MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

function fail(message, properties = {}) {
  return Object.assign(new Error(message), { safe: true, ...properties });
}

function validateIdentity(value, label) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 200 ||
    value !== value.trim() ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  ) {
    throw fail(`Enter a valid ${label}; its exact value is sent unchanged.`);
  }
  return value;
}

function parseParameters(raw = "{}", kind = "image") {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw fail("Parameters must be valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw fail("Parameters must be a JSON object.");
  }
  const reserved = new Set([
    "model",
    "prompt",
    "async",
    "authorization",
    "api_key",
    "apiKey",
    "key",
    "__proto__",
    "constructor",
    "prototype",
    "callback_url",
  ]);
  if (kind === "image") {
    for (const name of ["image", "images", "mask"]) {
      reserved.add(name);
    }
  }
  for (const [name, parameter] of Object.entries(value)) {
    if (reserved.has(name)) {
      throw fail(`Parameter ${name} is managed by this extension.`);
    }
    if (kind === "video" && ["images", "videos", "audios"].includes(name)) {
      if (
        !Array.isArray(parameter) ||
        !parameter.every((item) => typeof item === "string" && item.length > 0)
      ) {
        throw fail(`${name} must be an array of URL or data URL strings.`);
      }
    } else if (
      !["string", "number", "boolean"].includes(typeof parameter) ||
      (typeof parameter === "number" && !Number.isFinite(parameter))
    ) {
      throw fail(`Parameter ${name} must be a string, number or boolean.`);
    }
  }
  return { ...value };
}

async function limitedBytes(response, maximum) {
  if (Number(response.headers.get("content-length")) > maximum) {
    throw fail("Response exceeds the download limit.");
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maximum) {
        throw fail("Response exceeds the download limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total);
}

function createClient(key, fetcher = globalThis.fetch) {
  if (typeof key !== "string" || !key.trim() || /[\r\n]/.test(key)) {
    throw fail("Set an Apixly API key first.");
  }
  async function request(url, init, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 120_000,
    );
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      controller.abort();
    }
    try {
      const response = await fetcher(url, {
        ...init,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        let detail = "";
        if (
          String(url).startsWith(`${BASE}/`) &&
          response.headers.get("content-type")?.includes("json")
        ) {
          try {
            const errorBody = JSON.parse(
              (await limitedBytes(response, 65536)).toString("utf8"),
            );
            const message = errorBody.error?.message ?? errorBody.message;
            if (typeof message === "string")
              detail = message
                .replaceAll(key, "[redacted]")
                .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
                .replace(/\s+/g, " ")
                .slice(0, 500);
          } catch {
            /* Error details are optional; preserve the HTTP outcome. */
          }
        }
        throw fail(
          `Apixly request returned HTTP ${response.status}.${detail ? ` ${detail}` : ""}`,
          {
            retryable: response.status === 429 || response.status >= 500,
            unknownOutcome:
              init.method === "POST" &&
              (response.status >= 500 || response.status === 408),
          },
        );
      }
      const bytes = await limitedBytes(
        response,
        options.maximum ?? 1024 * 1024,
      );
      return {
        bytes,
        type: response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase(),
      };
    } catch (error) {
      if (
        error.retryable !== undefined ||
        error.message === "Response exceeds the download limit."
      ) {
        throw error;
      }
      throw fail(
        init.method === "POST"
          ? "Submission outcome unknown. Do not submit again automatically; check your Apixly activity first."
          : "Request failed or timed out. Resume the existing task; no new generation was submitted.",
        {
          unknownOutcome: init.method === "POST",
          retryable: init.method !== "POST" && !options.signal?.aborted,
        },
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  async function api(route, method, body, signal) {
    const headers = {
      authorization: `Bearer ${key}`,
      "user-agent": CLIENT_AGENT,
    };
    const form = body instanceof FormData;
    if (body && !form) {
      headers["content-type"] = "application/json";
    }
    const result = await request(
      `${BASE}${route}`,
      {
        method,
        headers,
        ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
      },
      { signal },
    );
    try {
      return JSON.parse(result.bytes.toString("utf8"));
    } catch {
      throw fail(
        method === "POST"
          ? "Submission returned no usable task ID. Outcome unknown; check Apixly activity before submitting again."
          : "Status response was invalid. Resume the existing task later.",
        { unknownOutcome: method === "POST", retryable: method === "GET" },
      );
    }
  }
  async function submit(route, body) {
    const result = await api(route, "POST", body);
    if (typeof result.id !== "string" || !result.id) {
      throw fail(
        "Submission returned no usable task ID. Outcome unknown; check Apixly activity before submitting again.",
        { unknownOutcome: true },
      );
    }
    return {
      id: result.id,
      status: typeof result.status === "string" ? result.status : "queued",
    };
  }
  return {
    async models() {
      const result = await api("/models", "GET");
      return Array.isArray(result.data)
        ? result.data
            .filter((item) => typeof item?.id === "string")
            .map((item) => item.id)
        : [];
    },
    async videoCapabilities() {
      const result = await api("/video/config", "GET");
      return Array.isArray(result.data) ? result.data : [];
    },
    async submitImage({ model, prompt, params = {}, refs = [], mask }) {
      validateIdentity(model, "model ID");
      if (typeof prompt !== "string" || !prompt.trim()) {
        throw fail("Enter a prompt.");
      }
      params = parseParameters(params, "image");
      if (!refs.length && mask) {
        throw fail("A mask requires a reference image.");
      }
      if (!refs.length) {
        return await submit("/images/generations", {
          ...params,
          model,
          prompt,
          async: true,
        });
      }
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      form.set("async", "true");
      for (const [name, value] of Object.entries(params)) {
        form.set(name, String(value));
      }
      for (const reference of refs) {
        if (
          !reference.bytes?.length ||
          !MIME[reference.type]?.match(/^\.(png|jpg|webp|gif|avif)$/)
        ) {
          throw fail("References must contain supported image bytes.");
        }
        form.append(
          "image[]",
          new Blob([reference.bytes], { type: reference.type }),
          reference.name || "reference.png",
        );
      }
      if (mask) {
        if (!mask.bytes?.length || mask.type !== "image/png") {
          throw fail("The mask must be a PNG file.");
        }
        form.set(
          "mask",
          new Blob([mask.bytes], { type: "image/png" }),
          "mask.png",
        );
      }
      return await submit("/images/edits", form);
    },
    async submitVideo({ model, prompt, params = {} }) {
      validateIdentity(model, "model ID");
      if (typeof prompt !== "string" || !prompt.trim()) {
        throw fail("Enter a prompt.");
      }
      return await submit("/videos", {
        ...parseParameters(params, "video"),
        model,
        prompt,
      });
    },
    async status(job, signal) {
      const route =
        job.kind === "image"
          ? "/images/generations/"
          : job.kind === "video"
            ? "/videos/"
            : null;
      if (!route) {
        throw fail("Unknown task type.");
      }
      const result = await api(
        `${route}${encodeURIComponent(validateIdentity(job.id, "task ID"))}`,
        "GET",
        undefined,
        signal,
      );
      const assets =
        job.kind === "image"
          ? Array.isArray(result.data)
            ? result.data.filter(
                (item) =>
                  item &&
                  (typeof item.url === "string" ||
                    typeof item.b64_json === "string"),
              )
            : []
          : typeof result.url === "string"
            ? [{ url: result.url }]
            : SUCCESS.has(result.status)
              ? [{}]
              : [];
      return {
        status: result.status,
        progress:
          typeof result.progress === "number" ? result.progress : undefined,
        assets,
      };
    },
    async download(asset, job, signal) {
      if (asset.b64_json) {
        if (
          job.kind !== "image" ||
          asset.b64_json.length > 32 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/=\r\n]+$/.test(asset.b64_json)
        ) {
          throw fail("Invalid inline image result.");
        }
        const bytes = Buffer.from(asset.b64_json, "base64");
        const extension = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? ".png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? ".jpg"
            : bytes.toString("ascii", 0, 4) === "RIFF" &&
                bytes.toString("ascii", 8, 12) === "WEBP"
              ? ".webp"
              : bytes.toString("ascii", 0, 4) === "GIF8"
                ? ".gif"
                : bytes.toString("ascii", 4, 8) === "ftyp" &&
                    ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))
                  ? ".avif"
                  : null;
        if (!extension) {
          throw fail("Unsupported inline image format; no file was saved.");
        }
        return { bytes, extension };
      }
      let url;
      const headers = {};
      if (!asset.url && job.kind === "video") {
        url = `${BASE}/videos/${encodeURIComponent(validateIdentity(job.id, "task ID"))}/content`;
        headers.authorization = `Bearer ${key}`;
        headers["user-agent"] = CLIENT_AGENT;
      } else {
        try {
          url = new URL(asset.url);
        } catch {
          throw fail("No downloadable result URL was returned.");
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(
            url.hostname,
          )
        ) {
          throw fail(
            "Result downloads require a public HTTPS URL without credentials.",
          );
        }
        url = url.toString();
      }
      const result = await request(
        url,
        { method: "GET", headers },
        {
          maximum: job.kind === "image" ? 32 * 1024 * 1024 : 256 * 1024 * 1024,
          timeoutMs: 180_000,
          signal,
        },
      );
      const extension = MIME[result.type];
      if (
        !extension ||
        (job.kind === "image"
          ? !result.type?.startsWith("image/")
          : !result.type?.startsWith("video/"))
      ) {
        throw fail("Unsupported result content type; no file was saved.");
      }
      return { bytes: result.bytes, extension };
    },
  };
}

async function pollTask(client, job, options = {}) {
  const started = Date.now();
  const timeout = options.timeoutMs ?? 30 * 60 * 1000;
  for (;;) {
    if (options.signal?.aborted) {
      throw fail(
        "Polling stopped locally. The upstream task may still run and incur charges. Resume by task ID.",
      );
    }
    if (Date.now() - started >= timeout) {
      throw fail(
        "Polling timed out locally. The upstream task may still run and incur charges. Resume by task ID.",
      );
    }
    try {
      const result = await client.status(job, options.signal);
      await options.onStatus?.(result);
      if (SUCCESS.has(result.status)) {
        return result;
      }
      if (FAILURE.has(result.status)) {
        throw fail(
          `Task ${result.status}. Check Apixly activity for details; no replacement was submitted.`,
        );
      }
      if (!PENDING.has(result.status)) {
        throw fail(
          "Unrecognized task status. Polling stopped; check the existing task later.",
        );
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw fail(
          "Polling stopped locally. The upstream task may still run and incur charges. Resume by task ID.",
        );
      }
      if (!error.retryable) {
        throw error;
      }
    }
    try {
      await delay(options.intervalMs ?? 3000, undefined, {
        signal: options.signal,
      });
    } catch {
      throw fail(
        "Polling stopped locally. The upstream task may still run and incur charges. Resume by task ID.",
      );
    }
  }
}

function within(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function saveExclusive(workspaceRoot, destination, bytes) {
  const root = await fs.realpath(workspaceRoot);
  const target = path.resolve(destination);
  if (!within(path.resolve(workspaceRoot), target)) {
    throw fail("Choose a file inside the selected workspace folder.");
  }
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== root && !within(root, parent)) {
    throw fail(
      "The destination escapes the workspace through a symbolic link.",
    );
  }
  const handle = await fs.open(
    path.join(parent, path.basename(target)),
    "wx",
    0o600,
  );
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

function taskRecord(job) {
  return {
    id: job.id,
    kind: job.kind,
    model: job.model,
    status: job.status,
    submittedAt: job.submittedAt,
  };
}

async function validateVideoReferences(client, model, params) {
  const imageCount = params.images?.length || 0;
  const videoCount = params.videos?.length || 0;
  const audioCount = params.audios?.length || 0;
  if (model === "grok-imagine-video-1.5-preview") {
    if (!imageCount)
      throw fail(
        "Choose a public HTTPS image URL or a generated image before using this image-to-video model. No generation was submitted.",
      );
    if (
      Object.hasOwn(params, "resolution") ||
      Object.hasOwn(params, "aspect_ratio")
    )
      throw fail(
        "Framing follows the reference image; geometry controls are not qualified for this model. Remove resolution and aspect_ratio from advanced parameters. No generation was submitted.",
      );
  }
  if (!imageCount && !videoCount && !audioCount) return;
  let capabilities;
  try {
    capabilities = await client.videoCapabilities();
  } catch {
    throw fail(
      "Reference support could not be verified. No generation was submitted; check the model capabilities and try again.",
    );
  }
  const capability = capabilities.find((item) => item.model === model);
  if (!capability)
    throw fail(
      "Reference support could not be verified for this exact model. Choose a listed reference-capable model or clear the references.",
    );
  if (
    imageCount &&
    !capability.modes?.some((mode) =>
      ["image2video", "frames2video"].includes(mode),
    )
  )
    throw fail(
      "This model accepts text prompts only. Choose an image2video-capable model, such as grok-imagine-video-1.5-preview, or clear the references. No generation was submitted.",
    );
  if (
    model === "grok-imagine-video-1.5-preview" &&
    (params.images || []).some((value) => !isReferenceUrl(value))
  )
    throw fail(
      "This model currently requires a public HTTPS reference URL. Local image files are not uploaded or hosted. Attach a URL or use a generated image in Media Studio; no generation was submitted.",
    );
  if (
    imageCount &&
    typeof capability.max_input_images === "number" &&
    imageCount > capability.max_input_images
  )
    throw fail(
      `This model accepts at most ${capability.max_input_images} reference image(s). No generation was submitted.`,
    );
  if (videoCount && !capability.supports_reference_video)
    throw fail(
      "This model does not advertise reference-video support. No generation was submitted.",
    );
  if (audioCount && !capability.supports_reference_audio)
    throw fail(
      "This model does not advertise reference-audio support. No generation was submitted.",
    );
}

function isReferenceUrl(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 8192 ||
    value !== value.trim()
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !/^(localhost\.?$|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

function validateReferenceUrl(value) {
  if (!isReferenceUrl(value))
    throw fail(
      "Enter a public HTTPS image URL without embedded credentials. Local files and data URLs are not hosted by this extension.",
    );
  return value;
}

function parseStudioParameters(raw, kind) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw fail("Parameters must be valid JSON.");
  }
  if (
    value &&
    typeof value === "object" &&
    Object.keys(value).some((key) => /mask/i.test(key))
  )
    throw fail(
      "Mask edits are not available in this release because no model passed visual qualification. No generation was submitted.",
    );
  return parseParameters(value, kind);
}

module.exports = {
  BASE,
  SUCCESS,
  MIME,
  createClient,
  pollTask,
  parseParameters,
  saveExclusive,
  taskRecord,
  validateVideoReferences,
  parseStudioParameters,
  validateReferenceUrl,
};
