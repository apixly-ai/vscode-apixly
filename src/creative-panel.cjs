"use strict";
const {
  orbitGlyph,
  presetChoices,
  lensStepper,
} = require("./creative-presentation.cjs");
const options = (items) =>
  items
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
const anglePresets = [
  ["custom", "Custom"],
  ["fisheye", "Fisheye"],
  ["dutch", "Dutch angle"],
  ["front_high", "Front · high angle"],
  ["front_low", "Front · low angle"],
  ["aerial_top_down", "Aerial / top-down"],
  ["back", "Back view"],
];
const lightPresets = [
  ["", "Unspecified lighting"],
  ["overexposedFilm", "Overexposed film"],
  ["blueBacklight", "Blue backlight"],
  ["rembrandt", "Rembrandt"],
  ["cyberpunk", "Cyberpunk"],
  ["psychedelicSunset", "Sunset glow"],
  ["mysteriousDark", "Low-key / dramatic"],
  ["goldenHour", "Golden hour"],
  ["nolanGray", "Cool cinematic gray"],
];
const shots = [
  ["none", "Keep framing"],
  ["extreme_long", "Extreme long shot"],
  ["long", "Full body / long shot"],
  ["medium", "Medium shot"],
  ["medium_close_up", "Medium close-up"],
  ["close_up", "Close-up"],
];
const bodies = [
  ["", "Unspecified body"],
  ["arri-alexa-35", "ARRI Alexa 35"],
  ["sony-venice", "Sony Venice"],
  ["red-v-raptor", "RED V-Raptor"],
  ["panavision-dxl2", "Panavision Millennium DXL2"],
  ["imax-film", "IMAX 70mm film"],
  ["leica-m11", "Leica M11"],
];
const lenses = [
  ["", "Unspecified lens"],
  ["cooke-anamorphic-sf", "Cooke Anamorphic/i SF"],
  ["panavision-c-series", "Panavision C-Series"],
  ["zeiss-master-prime", "Zeiss Master Prime"],
  ["canon-k35", "Canon K-35"],
  ["helios-44-2", "Helios 44-2"],
  ["lensbaby", "Lensbaby"],
];
function select(id, label, values) {
  return `<label for="${id}">${label}</label><select id="${id}">${options(values)}</select>`;
}
function range(id, label, min, max, value) {
  return `<div class="creative-range"><label for="${id}">${label}</label><input type="number" id="${id}-number" aria-label="${label} value" min="${min}" max="${max}" step="1" value="${value}"><input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}"></div>`;
}
function orbit(group, label, light = false) {
  const glyph = orbitGlyph(light ? "light" : "camera");
  return `<div id="${group}-orbit" class="creative-orbit" role="group" aria-label="${label} direction diagram" tabindex="0"><svg viewBox="0 0 200 200" aria-hidden="true"><defs><radialGradient id="${group}-sphere" cx="32%" cy="25%" r="78%"><stop stop-color="#5aa6ff" stop-opacity=".2"/><stop offset="1" stop-color="#06070a" stop-opacity=".6"/></radialGradient></defs><circle cx="100" cy="100" r="77" fill="url(#${group}-sphere)" stroke="#5aa6ff" stroke-opacity=".4"/><g fill="none" stroke="#94a3b8" stroke-opacity=".25"><ellipse cx="100" cy="100" rx="76" ry="29" transform="rotate(-18 100 100)"/><ellipse cx="100" cy="100" rx="31" ry="76" transform="rotate(-18 100 100)"/><path d="M26 100h148M100 24v152" stroke-dasharray="3 5"/></g><ellipse cx="100" cy="132" rx="26" ry="6" fill="#06070a" fill-opacity=".6"/><g class="creative-subject-placeholder"><path d="m100 71 23 13-23 14-23-14z" fill="#5aa6ff" fill-opacity=".6"/><path d="m77 84 23 14v29l-23-14z" fill="#1670f0" fill-opacity=".4"/><path d="m100 98 23-14v29l-23 14z" fill="#635bff" fill-opacity=".35"/></g><image id="${group}-subject" class="hidden" x="76" y="65" width="48" height="70" preserveAspectRatio="xMidYMid meet"/><line id="${group}-sight" x1="100" y1="100" x2="100" y2="100" stroke="#2e8fff" stroke-dasharray="3 4"/></svg><button id="${group}-marker" type="button" class="creative-marker ${light ? "light-marker" : ""}" aria-label="Drag ${label.toLowerCase()} direction">${glyph}</button>${[
    ["up", "↑", "Raise"],
    ["down", "↓", "Lower"],
    ["left", "←", "Rotate left"],
    ["right", "→", "Rotate right"],
  ]
    .map(
      ([dir, text, verb]) =>
        `<button type="button" class="creative-nudge nudge-${dir}" data-orbit="${group}" data-nudge="${dir}" aria-label="${verb} ${label.toLowerCase()}">${text}</button>`,
    )
    .join(
      "",
    )}</div><p class="creative-diagram-help">Drag the diagram or use arrows. Direction guide, not a rendered result.</p>`;
}
function renderCreativePanel() {
  return `<details id="creative-controls" class="creative-controls"><summary><span>✦ Creative direction</span><span id="creative-status" class="creative-badge">Off</span></summary><div class="creative-body"><p class="field-hint">AI prompt controls for the look you want. These guide the model; they do not operate a physical or precise 3D camera.</p><div class="creative-tabs" role="tablist" aria-label="Creative controls"><button type="button" role="tab" aria-selected="true" data-creative-tab="angle">Viewpoint</button><button type="button" role="tab" aria-selected="false" data-creative-tab="lighting">Lighting</button><button type="button" role="tab" aria-selected="false" data-creative-tab="camera">Lens</button></div>
<section id="angle-panel" role="tabpanel" aria-label="Viewpoint controls"><label class="creative-enable"><input id="angle-enabled" type="checkbox">Use viewpoint instructions</label><fieldset id="angle-fields" disabled><legend class="sr-only">Viewpoint settings</legend><span class="field-label">Viewpoint preset</span>${presetChoices("angle-preset", anglePresets)}<div class="creative-spatial"><div>${orbit("angle", "Viewpoint")}</div><div>${range("angle-yaw", "Azimuth (°)", 0, 359, 0)}${range("angle-pitch", "Elevation (°)", -90, 90, 0)}${select("angle-shot", "Framing", shots)}<p class="field-hint">Positive elevation looks down from above. Moving the diagram returns fixed direction presets to Custom.</p></div></div></fieldset></section>
<section id="lighting-panel" class="hidden" role="tabpanel" aria-label="Lighting controls"><label class="creative-enable"><input id="lighting-enabled" type="checkbox">Use lighting instructions</label><fieldset id="lighting-fields" disabled><legend class="sr-only">Lighting settings</legend><span class="field-label">Lighting look</span>${presetChoices("lighting-preset", lightPresets, true)}<div class="creative-spatial"><div>${orbit("lighting", "Light", true)}${select(
    "lighting-view",
    "Diagram view",
    [
      ["perspective", "Perspective"],
      ["front", "Front"],
    ],
  )}</div><div>${select("lighting-keyLight", "Key light", [
    ["", "Unspecified / custom direction"],
    ["left", "Camera left"],
    ["right", "Camera right"],
    ["top", "Overhead"],
    ["front", "Front"],
    ["bottom", "Below"],
    ["back", "Behind"],
  ])}${range("lighting-lightYaw", "Light azimuth (°)", 0, 359, 0)}${range("lighting-lightPitch", "Light elevation (°)", -90, 90, 0)}</div></div>${range("lighting-brightness", "Brightness", 0, 100, 50)}<div class="creative-color"><label class="creative-check"><input id="lighting-color-enable" type="checkbox">Specify light color</label><input id="lighting-color" type="color" value="#2e8fff" aria-label="Light color" disabled><input id="lighting-color-hex" type="text" value="#2e8fff" maxlength="7" spellcheck="false" aria-label="Light color hex value" placeholder="#RRGGBB" disabled><span id="lighting-color-label">Unspecified</span></div><label class="creative-check"><input id="lighting-rimLight" type="checkbox">Add rim light</label><label for="lighting-smartText">Additional lighting style <span class="label-hint">Optional · 1,000 characters</span></label><textarea id="lighting-smartText" rows="2" maxlength="1000" placeholder="Soft window light, warm highlights…"></textarea></fieldset></section>
<section id="camera-panel" class="hidden" role="tabpanel" aria-label="Camera and lens controls"><label class="creative-enable"><input id="camera-enabled" type="checkbox">Use camera and lens style</label><fieldset id="camera-fields" disabled><legend class="sr-only">Camera and lens settings</legend><div class="creative-lens-steppers">${lensStepper("camera-body", "Camera body", bodies, "camera")}${lensStepper("camera-lens", "Lens", lenses, "aperture")}${lensStepper("camera-focal", "Focal length", [["", "Unspecified"], ...[16, 24, 35, 50, 85, 135].map((mm) => [String(mm), `${mm} mm`]), ["custom", "Custom focal length"]])}${lensStepper("camera-aperture", "Aperture", [["", "Unspecified"], ...["f/1.4", "f/1.8", "f/2.8", "f/4", "f/5.6", "f/8", "f/11", "f/16"].map((f) => [f, f])], "aperture")}</div><div class="creative-custom-focal"><label for="camera-focal-number">Custom focal length (mm)</label><input id="camera-focal-number" type="number" min="8" max="800" step="1" placeholder="Unspecified"></div><p class="field-hint">Unspecified fields add no instructions. With every group off, your original prompt remains unchanged.</p></fieldset></section>
<div class="creative-actions"><button id="creative-off" type="button" class="button ghost compact">Turn all off</button><button id="creative-reset" type="button" class="button secondary compact">Reset controls</button></div><p class="field-hint">Controls and preview are free. Only Generate submits a paid model request.</p></div></details>
<details id="prompt-preview" class="prompt-preview"><summary><span>Final prompt sent to Apixly</span><span id="creative-length">0 / 20,000</span></summary><p id="creative-applied" class="field-hint">Original prompt unchanged.</p><textarea id="final-prompt" rows="5" readonly aria-label="Final prompt sent to Apixly" spellcheck="false"></textarea><div class="prompt-preview-actions"><button id="copy-final-prompt" type="button" class="button secondary compact" disabled>Copy final prompt</button><span id="creative-copy-status" role="status"></span></div><p id="creative-error" class="creative-error hidden" role="status"></p></details>`;
}
module.exports = { renderCreativePanel };
