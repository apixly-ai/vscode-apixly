"use strict";

const crypto = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const BASE = "https://apixly.ai/api/integrations";
const CLIENT_AGENT = `apixly-vscode-media/${require("../package.json").version}`;

function problem(message, code = "invalid_response") {
  return Object.assign(new Error(message), { safe: true, code });
}
function invalid() {
  return problem(
    "Apixly returned an invalid authorization response. Start a new account connection.",
  );
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value;
}
function text(value, maximum = 1000) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw invalid();
  return value;
}
function identity(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return value;
  return text(value, 200);
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid();
  return value;
}
function selectedKey(value) {
  object(value);
  if (typeof value.is_default !== "boolean") throw invalid();
  return {
    id: identity(value.id),
    name: text(value.name, 200),
    masked: text(value.masked, 200),
    is_default: value.is_default,
  };
}
function metadata(value) {
  object(value);
  object(value.account);
  return {
    connection_id: identity(value.connection_id),
    account: {
      id: identity(value.account.id),
      name:
        typeof value.account.name === "string"
          ? value.account.name.slice(0, 200)
          : "",
      email:
        typeof value.account.email === "string"
          ? value.account.email.slice(0, 320)
          : "",
    },
    selected_key: selectedKey(value.selected_key),
    selection_revision: revision(value.selection_revision),
    expires_at: text(value.expires_at, 100),
  };
}
function verificationUrl(value, flowId, userCode) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    url.origin !== "https://apixly.ai" ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/connect\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
    url.pathname !== `/connect/${flowId}` ||
    (userCode === undefined
      ? [...url.searchParams].length !== 0
      : [...url.searchParams].length !== 1 ||
        url.searchParams.get("user_code") !== userCode)
  )
    throw invalid();
  return url.toString();
}
function connectionToken(value) {
  if (typeof value !== "string" || !/^apc_[A-Za-z0-9_-]{43}$/.test(value))
    throw problem("Reconnect your Apixly account.", "unauthorized");
  return value;
}
async function responseJson(response) {
  if (
    Number(response.headers.get("content-length")) > 1024 * 1024 ||
    !response.body
  )
    throw invalid();
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw invalid();
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw invalid();
  }
}

function createAccountClient({
  fetcher = globalThis.fetch,
  now = Date.now,
  wait = (ms, signal) => delay(ms, undefined, { signal }),
} = {}) {
  const pending = new WeakMap();
  async function request(route, method, body, token, signal, oauth = false) {
    if (signal?.aborted)
      throw problem(
        "Account connection cancelled. No generation was submitted.",
        "cancelled",
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const headers = {
        "cache-control": "no-store",
        "user-agent": CLIENT_AGENT,
        accept: "application/json",
      };
      if (token) headers.authorization = `Bearer ${connectionToken(token)}`;
      if (body) headers["content-type"] = "application/json";
      const response = await fetcher(`${BASE}/${route}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: controller.signal,
      });
      if (method === "DELETE" && response.ok) return;
      const value = await responseJson(response);
      if (
        response.status === 401 &&
        [
          "invalid_connection",
          "expired_connection",
          "revoked_connection",
        ].includes(value.error)
      )
        throw problem(
          "Your Apixly account connection expired or was revoked. Reconnect your account.",
          "unauthorized",
        );
      if (!response.ok) {
        if (
          [401, 403].includes(response.status) &&
          value.error === "selected_key_rejected"
        )
          throw problem(
            "The selected API Key was rejected. Choose another active Key from your account.",
            "selected_key_rejected",
          );
        if (
          response.status === 409 &&
          value.error === "selected_key_unavailable"
        )
          throw problem(
            "The selected API Key is unavailable. Choose another active Key from your account.",
            "selected_key_unavailable",
          );
        if (
          oauth &&
          [
            "authorization_pending",
            "slow_down",
            "access_denied",
            "expired_token",
          ].includes(value.error)
        )
          return { oauthError: value.error };
        throw problem(
          response.status === 403
            ? "This account connection cannot access the selected Key. Choose an active Key you own."
            : `Apixly account request returned HTTP ${response.status}. Try again explicitly.`,
          "request_failed",
        );
      }
      return value;
    } catch (error) {
      if (error.safe) throw error;
      throw problem(
        signal?.aborted
          ? "Account connection cancelled. No generation was submitted."
          : "Account request failed or timed out. Try connecting again explicitly.",
        signal?.aborted ? "cancelled" : "request_failed",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return {
    async begin(signal) {
      const verifier = crypto.randomBytes(32).toString("base64url");
      const value = await request(
        "connect",
        "POST",
        {
          client_id: "vscode",
          flow: "device",
          code_challenge: crypto
            .createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
        },
        undefined,
        signal,
      );
      text(value.flow_id, 200);
      text(value.device_code, 1000);
      if (
        !Number.isFinite(value.expires_in) ||
        value.expires_in <= 0 ||
        value.expires_in > 600 ||
        !Number.isFinite(value.interval) ||
        value.interval <= 0 ||
        value.interval > 600
      )
        throw invalid();
      verificationUrl(value.verification_uri, value.flow_id);
      const flow = Object.freeze({
        userCode: text(value.user_code, 100),
        verificationUri: verificationUrl(
          value.verification_uri_complete,
          value.flow_id,
          value.user_code,
        ),
        expiresAt: now() + value.expires_in * 1000,
        intervalMs: value.interval * 1000,
      });
      pending.set(flow, { verifier, deviceCode: value.device_code });
      return flow;
    },
    async poll(flow, { signal, onStatus = () => undefined } = {}) {
      const proof = pending.get(flow);
      if (!proof) throw problem("Start a new account connection.");
      pending.delete(flow);
      let interval = flow.intervalMs;
      for (;;) {
        if (signal?.aborted)
          throw problem(
            "Account connection cancelled. No generation was submitted.",
            "cancelled",
          );
        if (now() + interval >= flow.expiresAt)
          throw problem(
            "Account authorization expired. Start a new connection.",
            "expired",
          );
        try {
          await wait(interval, signal);
        } catch {
          throw problem(
            "Account connection cancelled. No generation was submitted.",
            "cancelled",
          );
        }
        if (now() >= flow.expiresAt)
          throw problem(
            "Account authorization expired. Start a new connection.",
            "expired",
          );
        const value = await request(
          "token",
          "POST",
          {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            client_id: "vscode",
            device_code: proof.deviceCode,
            code_verifier: proof.verifier,
          },
          undefined,
          signal,
          true,
        );
        if (value.oauthError === "authorization_pending") {
          onStatus("pending");
          continue;
        }
        if (value.oauthError === "slow_down") {
          interval += 5000;
          onStatus("slow_down");
          continue;
        }
        if (value.oauthError === "access_denied")
          throw problem(
            "Account authorization was denied. No generation was submitted.",
            "denied",
          );
        if (value.oauthError === "expired_token")
          throw problem(
            "Account authorization expired. Start a new connection.",
            "expired",
          );
        if (
          value.token_type !== "Bearer" ||
          !Number.isFinite(value.expires_in) ||
          value.expires_in <= 0
        )
          throw invalid();
        return {
          token: connectionToken(value.access_token),
          metadata: metadata({
            ...value,
            expires_at:
              value.expires_at ??
              new Date(now() + value.expires_in * 1000).toISOString(),
          }),
        };
      }
    },
    cancel(flow) {
      pending.delete(flow);
    },
    async account(token) {
      return metadata(await request("account", "GET", undefined, token));
    },
    async keys(token) {
      const value = await request("keys", "GET", undefined, token);
      if (!Array.isArray(value.data)) throw invalid();
      return {
        data: value.data.map((item) => ({
          ...selectedKey(item),
          status: text(item.status, 100),
          expires_at:
            item.expires_at === null ? null : text(item.expires_at, 100),
        })),
        selected_key_id: identity(value.selected_key_id),
        selection_revision: revision(value.selection_revision),
      };
    },
    async selectKey(token, keyId) {
      if (!(keyId === "studixly" || /^(?:0|[1-9]\d*)$/.test(String(keyId))))
        throw problem("Choose an active API Key you own.");
      return metadata(
        await request("key", "PUT", { key_id: String(keyId) }, token),
      );
    },
    async disconnect(token) {
      await request("connection", "DELETE", undefined, token);
    },
  };
}

module.exports = { createAccountClient };
