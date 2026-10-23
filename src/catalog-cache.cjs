"use strict";
const crypto = require("node:crypto");
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
function catalogIdentity(value) {
  if (value?.mode === "manual" && typeof value.key === "string" && value.key)
    return `manual:${digest(value.key)}`;
  if (
    value?.mode === "account" &&
    value.connectionId !== undefined &&
    value.accountId !== undefined &&
    value.keyId !== undefined &&
    value.revision !== undefined
  )
    return `account:${digest(JSON.stringify([String(value.connectionId), String(value.accountId), String(value.keyId), String(value.revision)]))}`;
  throw Object.assign(
    new Error("Connect an account or configure an API key to load models."),
    { safe: true },
  );
}
function createCatalogResolver({ ttlMs = 600000, now = Date.now } = {}) {
  const entries = new Map();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function entryFor(identity) {
    if (
      typeof identity !== "string" ||
      !/^(manual|account):[0-9a-f]{64}$/.test(identity)
    )
      throw Object.assign(new Error("Invalid catalog identity."), {
        safe: true,
      });
    if (!entries.has(identity))
      entries.set(identity, {
        snapshot: null,
        updatedAt: null,
        error: null,
        inflight: null,
        valid: true,
      });
    return entries.get(identity);
  }
  function status(entry) {
    const available = Boolean(entry?.valid && entry.snapshot);
    return {
      ...(available ? clone(entry.snapshot) : { models: [], videos: [] }),
      available,
      updatedAt: available ? entry.updatedAt : null,
      stale: available
        ? Boolean(
            entry.error ||
              entry.snapshot.capabilitiesError ||
              now() - entry.updatedAt >= ttlMs,
          )
        : true,
      refreshing: Boolean(entry?.valid && entry.inflight),
      error: entry?.valid ? entry.error : null,
    };
  }
  function refresh(entry, load) {
    if (entry.inflight) return entry.inflight;
    entry.inflight = Promise.resolve()
      .then(load)
      .then(
        (snapshot) => {
          if (!entry.valid) return;
          if (
            !snapshot ||
            !Array.isArray(snapshot.models) ||
            !Array.isArray(snapshot.videos)
          )
            throw Error("Invalid snapshot");
          entry.snapshot = clone(snapshot);
          entry.updatedAt = now();
          entry.error = null;
        },
        () => {
          if (entry.valid)
            entry.error =
              "Could not refresh the model catalog. Saved options may be out of date. Try Refresh models.";
        },
      )
      .catch(() => {
        if (entry.valid)
          entry.error =
            "The model catalog response was invalid. Try Refresh models.";
      })
      .then(() => {
        entry.inflight = null;
        return status(entry);
      });
    return entry.inflight;
  }
  return {
    peek(identity) {
      return status(entries.get(identity));
    },
    markAccountError(identity) {
      const entry = entries.get(identity);
      if (entry?.valid)
        entry.error =
          "Could not refresh account information. Saved models may be out of date. Try Refresh account or Refresh models.";
      return status(entry);
    },
    async read(identity, load, { force = false, onUpdate } = {}) {
      const entry = entryFor(identity);
      if (entry.snapshot && !force) {
        const stale = status(entry).stale;
        if (stale || entry.inflight) {
          const pending = entry.inflight || refresh(entry, load);
          if (onUpdate) pending.then(onUpdate).catch(() => undefined);
        }
        return status(entry);
      }
      return refresh(entry, load);
    },
    async settled(identity) {
      const entry = entries.get(identity);
      if (entry?.inflight) await entry.inflight;
      return status(entry);
    },
    invalidate(identity) {
      const entry = entries.get(identity);
      if (entry) {
        entry.valid = false;
        entry.snapshot = null;
        entries.delete(identity);
      }
    },
    clear() {
      for (const entry of entries.values()) {
        entry.valid = false;
        entry.snapshot = null;
      }
      entries.clear();
    },
  };
}
module.exports = { catalogIdentity, createCatalogResolver };
