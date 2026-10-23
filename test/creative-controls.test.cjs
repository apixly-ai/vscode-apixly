"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const fixtures = require("./fixtures/creative-golden-v1.json");
const { composeCreativePrompt } = require("../media/creative-controls.js");

for (const sample of fixtures.valid) {
  test(`creative golden ${sample.id}`, () => {
    const before = JSON.stringify(sample.input);
    assert.deepEqual(composeCreativePrompt(sample.input), sample.expected);
    assert.equal(JSON.stringify(sample.input), before, "input must not mutate");
  });
}
for (const sample of fixtures.invalid) {
  test(`creative rejects ${sample.id}`, () => {
    assert.throws(
      () => composeCreativePrompt(sample.input),
      (error) => {
        assert.equal(error.safe, true);
        assert.equal(error.path, sample.error_path);
        assert(!error.message.includes("secret-value"));
        return true;
      },
    );
  });
}
test("creative accepts only strict plain payload/settings and finite values", () => {
  for (const input of [
    null,
    [],
    Object.create({ prompt: "base" }),
    { prompt: "p", tools: null },
    { prompt: "p", tools: { angle: [] } },
    { prompt: "p", tools: { lighting: { brightness: NaN } } },
    { prompt: "p", tools: { angle: { yaw: Infinity } } },
    { prompt: "p", tools: { camera: { focal: -Infinity } } },
    { prompt: "p", tools: { camera: { enabled: 1 } } },
    { prompt: "p", tools: JSON.parse('{"__proto__":{}}') },
  ])
    assert.throws(() => composeCreativePrompt(input));
});
test("creative UTF-16 length boundaries preserve non-BMP prompt text", () => {
  const prompt = "🚗".repeat(10000);
  assert.equal(composeCreativePrompt({ prompt }).final_prompt, prompt);
  assert.throws(() => composeCreativePrompt({ prompt: prompt + "x" }));
  assert.throws(() =>
    composeCreativePrompt({
      prompt: "p",
      tools: { lighting: { enabled: true, smartText: "🌞".repeat(501) } },
    }),
  );
});
test("creative rejects null mode instead of treating it as an omitted value", () => {
  assert.throws(
    () => composeCreativePrompt({ prompt: "base", mode: null }),
    (error) => error.path === "mode",
  );
});
test("creative root shape errors identify payload without echoing its contents", () => {
  for (const payload of [null, [], Object.create({ prompt: "private" })]) {
    assert.throws(
      () => composeCreativePrompt(payload),
      (error) => {
        assert.equal(error.path, "payload");
        assert(!error.message.includes("private"));
        return true;
      },
    );
  }
});
test("creative errors sanitize malformed unknown field names without echoing data", () => {
  for (const [input, expected] of [
    [{ prompt: "base", ["secret-value\nfield"]: "private" }, "unknown_field"],
    [
      {
        prompt: "base",
        tools: { lighting: { ["sensitive-token/field"]: true } },
      },
      "tools.lighting.unknown_field",
    ],
  ]) {
    assert.throws(
      () => composeCreativePrompt(input),
      (error) => {
        assert.equal(error.path, expected);
        assert(!error.message.includes("secret-value"));
        assert(!error.message.includes("sensitive-token"));
        assert(!error.message.includes("private"));
        return true;
      },
    );
  }
});
test("browser UMD and CommonJS produce the same complete golden results without I/O", () => {
  const context = vm.createContext({});
  const script = fs.readFileSync(
    path.join(__dirname, "../media/creative-controls.js"),
    "utf8",
  );
  vm.runInContext(script, context);
  assert.equal(
    typeof context.ApixlyCreativeControlsV1.composeCreativePrompt,
    "function",
  );
  for (const sample of fixtures.valid) {
    context.payloadJson = JSON.stringify(sample.input);
    const actual = vm.runInContext(
      "ApixlyCreativeControlsV1.composeCreativePrompt(JSON.parse(payloadJson))",
      context,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), sample.expected);
  }
});
