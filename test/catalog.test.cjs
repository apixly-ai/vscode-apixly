"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  parseModelList,
  parseVideoConfig,
  buildModelOptions,
} = require("../media/model-catalog.js");
const {
  createCatalogResolver,
  catalogIdentity,
} = require("../src/catalog-cache.cjs");
const models = {
  currency: "USD",
  data: [
    {
      id: "seedream-5-0",
      name: "Seedream 5",
      description: "Image",
      type: "image",
      pricing: { cost_per_image: 0.02 },
      future: { keep: [1, 2] },
    },
    { id: "future-unfamiliar-id", name: "Future image", type: "image" },
    { id: "name-contains-image", type: "chat" },
    { id: "allowed-video", type: "video" },
    { id: "video-without-config", type: "video" },
  ],
};
const videos = {
  data: [
    {
      model: "allowed-video",
      seconds: { min: 1, max: 15 },
      modes: ["text2video"],
      future: { keep: true },
    },
    { model: "not-authorized-video", modes: ["image2video"] },
  ],
};
const snapshot = (id) => ({
  models: [{ id, type: "image", name: id }],
  videos: [],
});
const manual = (key) => catalogIdentity({ mode: "manual", key });
test("typed catalog keeps seedream and future image IDs with all metadata; no name heuristics", () => {
  const parsed = parseModelList(models);
  assert.deepEqual(parsed, models.data);
  assert.notEqual(parsed, models.data);
  assert.notEqual(parsed[0].pricing, models.data[0].pricing);
  const image = buildModelOptions(parsed, parseVideoConfig(videos), "image");
  assert.deepEqual(
    image.map((x) => x.id),
    ["seedream-5-0", "future-unfamiliar-id"],
  );
  assert.deepEqual(image[0].future, { keep: [1, 2] });
  assert.equal(image[0].pricing.cost_per_image, 0.02);
  const video = buildModelOptions(parsed, parseVideoConfig(videos), "video");
  assert.deepEqual(
    video.map((x) => x.id),
    ["allowed-video", "video-without-config"],
  );
  assert.equal(video[1].videoCapability, null);
  assert.equal(video[0].videoCapability.future.keep, true);
});
test("malformed catalogs fail distinctly while an empty successful response is valid", () => {
  for (const value of [
    null,
    {},
    { data: null },
    { data: [{ id: "x" }] },
    { data: [{ id: "", type: "image" }] },
  ])
    assert.throws(() => parseModelList(value));
  assert.deepEqual(parseModelList({ data: [] }), []);
  assert.throws(() => parseVideoConfig({ data: [{ model: 8 }] }));
});
test("browser catalog parser agrees with CommonJS and never requires a network API", () => {
  const c = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(require.resolve("../media/model-catalog.js"), "utf8"),
    c,
  );
  c.input = JSON.stringify(models);
  const output = vm.runInContext(
    "ApixlyModelCatalogV1.parseModelList(JSON.parse(input))",
    c,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(output)), models.data);
});
test("cache is cold single-flight, remains fresh for ten minutes, and force joins an in-flight refresh", async () => {
  let clock = 0,
    calls = 0,
    release;
  const cache = createCatalogResolver({ now: () => clock });
  const id = manual("private-key-a");
  const load = () => {
    calls++;
    return new Promise((resolve) => (release = resolve));
  };
  const a = cache.read(id, load),
    b = cache.read(id, load, { force: true });
  await Promise.resolve();
  assert.equal(calls, 1);
  release(snapshot("first"));
  const [one, two] = await Promise.all([a, b]);
  assert.equal(one.available, true);
  assert.equal(two.models[0].id, "first");
  clock = 599999;
  const fresh = await cache.read(id, () => {
    throw Error("must stay cached");
  });
  assert.equal(fresh.stale, false);
  assert.equal(calls, 1);
});
test("expired cache returns saved options immediately and refreshes in the background exactly once", async () => {
  let clock = 0,
    calls = 0,
    release;
  const cache = createCatalogResolver({ now: () => clock });
  const id = manual("key");
  await cache.read(id, async () => snapshot("old"));
  clock = 600000;
  const updates = [];
  const load = () => {
    calls++;
    return new Promise((resolve) => (release = resolve));
  };
  const saved = await cache.read(id, load, {
    onUpdate: (s) => updates.push(s),
  });
  assert.equal(saved.models[0].id, "old");
  assert.equal(saved.stale, true);
  assert.equal(saved.refreshing, true);
  await cache.read(id, load);
  assert.equal(calls, 1);
  release(snapshot("new"));
  await cache.settled(id);
  assert.equal(updates[0].models[0].id, "new");
  assert.equal(cache.peek(id).stale, false);
});

test("a fresh cache reader joining a forced refresh receives completion instead of staying refreshing", async () => {
  const cache = createCatalogResolver();
  const id = manual("key");
  await cache.read(id, async () => snapshot("old"));
  let release;
  const forced = cache.read(
    id,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    { force: true },
  );
  await Promise.resolve();
  const updates = [];
  const focused = await cache.read(
    id,
    async () => {
      throw Error("must join");
    },
    { onUpdate: (value) => updates.push(value) },
  );
  assert.equal(focused.refreshing, true);
  release(snapshot("new"));
  await forced;
  await Promise.resolve();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].refreshing, false);
  assert.equal(updates[0].models[0].id, "new");
});
test("refresh failure retains same-identity last-known data and redacts transport errors", async () => {
  const cache = createCatalogResolver();
  const id = manual("private-secret");
  await cache.read(id, async () => snapshot("saved"));
  const result = await cache.read(
    id,
    async () => {
      throw Error("Bearer private-secret");
    },
    { force: true },
  );
  assert.equal(result.available, true);
  assert.equal(result.models[0].id, "saved");
  assert.equal(result.stale, true);
  assert(result.error);
  assert(!JSON.stringify(result).includes("private-secret"));
  const empty = await cache.read(manual("empty"), async () => ({
    models: [],
    videos: [],
  }));
  assert.equal(empty.available, true);
  assert.equal(empty.error, null);
  const failure = await cache.read(manual("fail"), async () => {
    throw Error("fail");
  });
  assert.equal(failure.available, false);
});
test("identities isolate keys/accounts/selections and invalidation discards late results", async () => {
  const a = manual("secret-a"),
    b = manual("secret-b");
  assert.notEqual(a, b);
  assert(!a.includes("secret-a"));
  const c = catalogIdentity({
    mode: "account",
    connectionId: "c",
    accountId: "a",
    keyId: 1,
    revision: 1,
  });
  const d = catalogIdentity({
    mode: "account",
    connectionId: "c",
    accountId: "a",
    keyId: 1,
    revision: 2,
  });
  assert.notEqual(c, d);
  let release;
  const cache = createCatalogResolver();
  const pending = cache.read(
    a,
    () => new Promise((resolve) => (release = resolve)),
  );
  await Promise.resolve();
  await cache.read(b, async () => snapshot("key-b"));
  cache.invalidate(a);
  release(snapshot("late-a"));
  await pending;
  assert.equal(cache.peek(a).available, false);
  assert.equal(cache.peek(b).models[0].id, "key-b");
});
