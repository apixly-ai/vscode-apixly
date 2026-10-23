"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  lightingSwatches,
  orbitGlyph,
  presetChoices,
  lensStepper,
} = require("../src/creative-presentation.cjs");
const { renderCreativePanel } = require("../src/creative-panel.cjs");
test("Studixly lighting swatches retain its eight exact styles and an explicit unspecified choice", () => {
  assert.equal(lightingSwatches.length, 8);
  assert.equal(
    lightingSwatches.find((x) => x.id === "blueBacklight").gradient,
    "linear-gradient(135deg, #0b1224 0%, #1670f0 70%, #7dd3fc 100%)",
  );
  const html = presetChoices(
    "lighting-preset",
    [
      ["", "Unspecified lighting"],
      ...lightingSwatches.map((x) => [x.id, x.label]),
    ],
    true,
  );
  assert.equal(
    (html.match(/data-preset-for="lighting-preset"/g) || []).length,
    9,
  );
  assert(html.includes('data-preset-value=""'));
  assert(html.includes('aria-pressed="true"'));
  assert(!html.includes("style="));
  assert(!html.includes("https://"));
});
test("orbit markers reuse the existing Studixly camera faces and eight light rays without external media", () => {
  const camera = orbitGlyph("camera"),
    light = orbitGlyph("light");
  assert(camera.includes('d="M6 11 L16 6 L27 10.5 L17 15.5 Z"'));
  assert(camera.includes('transform="rotate(-24 22 16.6)"'));
  assert(light.includes('r="6.4"'));
  assert.equal((light.match(/<path /g) || []).length, 8);
  assert(!`${camera}${light}`.includes("<image"));
  assert.throws(() => orbitGlyph("unknown"));
});
test("lens steppers retain exact options, accessible previous/next controls and neutral defaults", () => {
  const html = lensStepper(
    "camera-body",
    "Camera body",
    [
      ["", "Unspecified body"],
      ["sony-venice", "Sony Venice"],
    ],
    "camera",
  );
  assert.equal((html.match(/data-step-for="camera-body"/g) || []).length, 2);
  assert(html.includes('data-step-dir="-1"'));
  assert(html.includes('data-step-dir="1"'));
  assert(html.includes('aria-label="Previous Camera body"'));
  assert(html.includes('aria-label="Next Camera body"'));
  assert(html.includes('<option value="sony-venice">Sony Venice</option>'));
  assert(html.includes('id="camera-body-display"'));
  assert(!html.includes('selected="sony-venice"'));
});

test("the packaged preset stylesheet renders every source swatch without remote assets or hover-only targets", () => {
  const css = fs.readFileSync(
    require.resolve("../media/creative-presets.css"),
    "utf8",
  );
  for (const { id, gradient } of lightingSwatches) {
    assert(css.includes(`.swatch-${id}`));
    assert(css.includes(gradient));
  }
  assert(css.includes("min-height: 44px"));
  assert(!css.includes("url("));
});

test("the actual creative panel exposes source preset pills, look swatches and all four lens steppers", () => {
  const html = renderCreativePanel();
  assert.equal((html.match(/data-preset-for="angle-preset"/g) || []).length, 7);
  assert.equal(
    (html.match(/data-preset-for="lighting-preset"/g) || []).length,
    9,
  );
  for (const field of ["body", "lens", "focal", "aperture"])
    assert(html.includes(`data-stepper="camera-${field}"`));
  assert(html.includes('id="camera-focal-number"'));
  assert(html.includes('id="lighting-color-hex"'));
  assert(html.includes('class="studixly-camera-glyph"'));
  assert(html.includes('class="studixly-light-glyph"'));
});

test("Studio loads the packaged preset stylesheet through its permitted local stylesheet", () => {
  const css = fs.readFileSync(require.resolve("../media/studio.css"), "utf8");
  assert(css.startsWith('@import "./creative-presets.css";'));
});
