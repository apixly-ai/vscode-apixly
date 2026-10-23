"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  initialTools,
  moveDirection,
  selectAnglePreset,
  disableAll,
  projectPoint,
  showPreview,
  canSubmitPrompt,
} = require("../media/creative-ui.js");
test("creative UI starts neutral, while disabling preserves settings without mutating state", () => {
  const first = initialTools();
  assert.equal(first.angle.enabled, false);
  assert.equal(first.angle.shot, "none");
  assert.equal(first.lighting.color, "");
  assert.equal(first.camera.focal, null);
  first.angle = { enabled: true, yaw: 180, pitch: 30, preset: "back" };
  const disabled = disableAll(first);
  assert.equal(disabled.angle.enabled, false);
  assert.equal(disabled.angle.yaw, 180);
  assert.equal(first.angle.enabled, true);
  assert.equal(disabled.lighting.enabled, false);
});
test("camera/light drag and nudge direction wrap azimuth and clamp positive elevation above", () => {
  assert.deepEqual(moveDirection({ yaw: 359, pitch: 85 }, 10, -20, 1), {
    yaw: 9,
    pitch: 90,
  });
  assert.deepEqual(moveDirection({ yaw: 0, pitch: 0 }, -15, 15, 1), {
    yaw: 345,
    pitch: -15,
  });
  const above = projectPoint(0, 45, 0, 0);
  assert(above.y < 100);
  assert.equal(above.front, true);
});
test("directional presets set exact angles and manual movement returns them to custom", () => {
  const state = selectAnglePreset(
    { enabled: true, yaw: 27, pitch: -2, shot: "none" },
    "front_high",
  );
  assert.equal(state.pitch, 45);
  assert.equal(state.yaw, 0);
  const lens = selectAnglePreset(state, "fisheye");
  assert.equal(lens.yaw, 0);
  assert.equal(lens.pitch, 45);
  assert.equal(lens.preset, "fisheye");
});
test("prompt preview displays HTML-like prompt and style text literally without HTML sinks", () => {
  const nodes = new Map();
  for (const id of [
    "final-prompt",
    "creative-error",
    "creative-status",
    "creative-length",
    "creative-applied",
    "prompt-preview",
  ]) {
    const node = {
      value: "",
      textContent: "",
      open: false,
      classList: { toggle() {} },
    };
    Object.defineProperty(node, "innerHTML", {
      set() {
        throw Error("Unsafe HTML sink");
      },
    });
    nodes.set(id, node);
  }
  const text =
    '</textarea><img src="https://invalid.example/private" onerror="alert(1)">';
  showPreview(
    { getElementById: (id) => nodes.get(id) },
    { final_prompt: text, applied_tools: ["lighting"], changed: true },
    null,
  );
  assert.equal(nodes.get("final-prompt").value, text);
  assert.equal(nodes.get("creative-status").textContent, "1 active");
  showPreview({ getElementById: (id) => nodes.get(id) }, null, new Error(text));
  assert.equal(nodes.get("creative-error").textContent, text);
  assert.equal(nodes.get("prompt-preview").open, true);
});
test("Generate and Copy validity depend on the final prompt, including style-only prompts", () => {
  assert.equal(
    canSubmitPrompt({ final_prompt: "Lens: 85mm telephoto" }, null),
    true,
  );
  assert.equal(canSubmitPrompt({ final_prompt: " \n " }, null), false);
  assert.equal(
    canSubmitPrompt({ final_prompt: "p" }, new Error("Invalid controls")),
    false,
  );
});
