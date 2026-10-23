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
  cycleOption,
  installPresetPresentation,
  parseHexColor,
  syncLightColorInputs,
} = require("../media/creative-ui.js");
test("Studixly-style lens steppers wrap both ways, preserve unspecified and accept custom-value fallback", () => {
  const values = ["", "sony-venice", "red-v-raptor"];
  assert.equal(cycleOption(values, "", -1), "red-v-raptor");
  assert.equal(cycleOption(values, "red-v-raptor", 1), "");
  assert.equal(cycleOption(values, "sony-venice", 1), "red-v-raptor");
  assert.equal(cycleOption(["", "16", "24"], "42", 1), "16");
  assert.equal(cycleOption([], "", 1), "");
});

test("preset cards and lens buttons update the existing typed controls exactly once and preserve neutral reset", () => {
  const element = (dataset = {}) => ({
    dataset,
    handlers: {},
    attributes: {},
    value: "",
    textContent: "",
    options: [],
    addEventListener(type, fn) {
      this.handlers[type] = fn;
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    dispatchEvent(event) {
      this.events = [...(this.events || []), event.type];
    },
    focus() {},
    click() {
      this.handlers.click?.({});
    },
  });
  const select = element();
  select.options = [
    { value: "", textContent: "Unspecified body" },
    { value: "sony-venice", textContent: "Sony Venice" },
  ];
  const preset = element({ presetFor: "angle-preset", presetValue: "back" });
  const previous = element({ stepFor: "camera-body", stepDir: "-1" });
  const next = element({ stepFor: "camera-body", stepDir: "1" });
  const stepper = element({ stepper: "camera-body" });
  const angle = element();
  angle.value = "custom";
  const output = element();
  const doc = {
    getElementById: (id) =>
      ({
        "camera-body": select,
        "camera-body-display": output,
        "angle-preset": angle,
      })[id],
    querySelectorAll: (query) =>
      query === "[data-preset-for]"
        ? [preset]
        : query === "[data-step-for]"
          ? [previous, next]
          : query === "[data-stepper]"
            ? [stepper]
            : [],
  };
  const presentation = installPresetPresentation(doc);
  preset.click();
  assert.equal(angle.value, "back");
  assert.deepEqual(angle.events, ["change"]);
  assert.equal(preset.attributes["aria-pressed"], "true");
  next.click();
  assert.equal(select.value, "sony-venice");
  assert.equal(output.textContent, "Sony Venice");
  next.click();
  assert.equal(select.value, "");
  assert.equal(output.textContent, "Unspecified body");
  previous.click();
  assert.equal(select.value, "sony-venice");
  select.value = "";
  angle.value = "custom";
  presentation.refresh();
  assert.equal(output.textContent, "Unspecified body");
  assert.equal(preset.attributes["aria-pressed"], "false");
});

test("a precise text light-color input accepts only complete hex colors and never normalizes user values silently", () => {
  assert.equal(parseHexColor("#FFD66B"), "#FFD66B");
  assert.equal(parseHexColor("#2e8fff"), "#2e8fff");
  for (const value of ["#ff", "red", "#000000<script>", " #ffffff", ""])
    assert.throws(() => parseHexColor(value), /#RRGGBB/);
});

test("reset clears a previously chosen color from both pickers, while an active partial hex input is preserved", () => {
  const native = { value: "#ff00ff" },
    hex = { value: "#ff00ff" },
    label = { textContent: "#ff00ff" };
  const doc = {
    activeElement: null,
    getElementById: (id) =>
      ({
        "lighting-color": native,
        "lighting-color-hex": hex,
        "lighting-color-label": label,
      })[id],
  };
  syncLightColorInputs(doc, "");
  assert.equal(native.value, "#2e8fff");
  assert.equal(hex.value, "#2e8fff");
  assert.equal(label.textContent, "Unspecified");
  hex.value = "#ff";
  doc.activeElement = hex;
  syncLightColorInputs(doc, "#FFD66B");
  assert.equal(hex.value, "#ff");
  assert.equal(native.value, "#FFD66B");
  assert.equal(label.textContent, "#FFD66B");
});
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
