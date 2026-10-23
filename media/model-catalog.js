/* Apixly typed model catalog v1. Shared browser/CommonJS parser; no I/O. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ApixlyModelCatalogV1 = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const identifier = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !/[\u0000-\u001f]/.test(value);
  function invalid() {
    throw Object.assign(
      new Error(
        "The model catalog response was invalid. Refresh models or enter an exact model ID.",
      ),
      { safe: true },
    );
  }
  function parseModelCatalog(payload) {
    if (!object(payload) || !Array.isArray(payload.data)) invalid();
    const seen = new Set();
    for (const row of payload.data) {
      if (
        !object(row) ||
        !identifier(row.id) ||
        typeof row.type !== "string" ||
        !row.type ||
        seen.has(row.id)
      )
        invalid();
      seen.add(row.id);
    }
    return clone(payload);
  }
  function parseModelList(payload) {
    return parseModelCatalog(payload).data;
  }
  function parseVideoConfig(payload) {
    if (!object(payload) || !Array.isArray(payload.data)) invalid();
    const seen = new Set();
    for (const row of payload.data) {
      if (!object(row) || !identifier(row.model) || seen.has(row.model))
        invalid();
      seen.add(row.model);
      for (const key of ["modes", "resolutions", "aspect_ratios"])
        if (
          row[key] !== undefined &&
          (!Array.isArray(row[key]) ||
            row[key].some((value) => typeof value !== "string"))
        )
          invalid();
    }
    return clone(payload.data);
  }
  function buildModelOptions(models, configs, kind) {
    const rows = parseModelList({ data: models });
    const capabilities = parseVideoConfig({ data: configs });
    const lookup = new Map(capabilities.map((row) => [row.model, row]));
    return rows
      .filter((row) =>
        kind === "video"
          ? row.type === "video" || lookup.has(row.id)
          : row.type === "image",
      )
      .map((row) => ({
        ...row,
        videoCapability: kind === "video" ? lookup.get(row.id) || null : null,
      }));
  }
  return Object.freeze({
    parseModelCatalog,
    parseModelList,
    parseVideoConfig,
    buildModelOptions,
  });
});
