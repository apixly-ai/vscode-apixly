"use strict";

// Native markup adapted from Studixly's lighting-panel, camera-panel,
// PresetSwatchGrid, Stepper and OrbitPicker. Keep model instructions separate.
const lightingSwatches = [
  {
    id: "overexposedFilm",
    label: "Overexposed film",
    gradient: "linear-gradient(135deg, #fef3c7 0%, #fffbeb 55%, #e2e8f0 100%)",
  },
  {
    id: "blueBacklight",
    label: "Blue backlight",
    gradient: "linear-gradient(135deg, #0b1224 0%, #1670f0 70%, #7dd3fc 100%)",
  },
  {
    id: "rembrandt",
    label: "Rembrandt",
    gradient: "linear-gradient(135deg, #b4530a 0%, #451a03 60%, #0c0a09 100%)",
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    gradient: "linear-gradient(135deg, #d946ef 0%, #0b1224 55%, #22d3ee 100%)",
  },
  {
    id: "psychedelicSunset",
    label: "Sunset glow",
    gradient: "linear-gradient(135deg, #f97316 0%, #e11d48 55%, #a21caf 100%)",
  },
  {
    id: "mysteriousDark",
    label: "Low-key / dramatic",
    gradient: "linear-gradient(135deg, #1e293b 0%, #0f172a 55%, #020617 100%)",
  },
  {
    id: "goldenHour",
    label: "Golden hour",
    gradient: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 55%, #b45309 100%)",
  },
  {
    id: "nolanGray",
    label: "Cool cinematic gray",
    gradient: "linear-gradient(135deg, #94a3b8 0%, #475569 55%, #1e293b 100%)",
  },
];
const escaped = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
function orbitGlyph(kind) {
  if (kind === "camera")
    return `<svg viewBox="0 0 32 30" fill="none" aria-hidden="true" class="studixly-camera-glyph"><path d="M6 11 L16 6 L27 10.5 L17 15.5 Z" class="glyph-light" opacity=".95"/><path d="M6 11 L17 15.5 L17 25 L6 20.5 Z" class="glyph-accent"/><path d="M17 15.5 L27 10.5 L27 20 L17 25 Z" class="glyph-dark"/><path d="M11 8.6 L15 7 L18.5 8.4 L14.5 10 Z" class="glyph-light" opacity=".9"/><ellipse cx="22" cy="16.6" rx="2.7" ry="3.4" transform="rotate(-24 22 16.6)" fill="#0b1220"/><ellipse cx="22" cy="16.6" rx="1.4" ry="1.9" transform="rotate(-24 22 16.6)" class="glyph-lens"/><path d="M6 11 L16 6 L27 10.5" stroke="#ffffff8c" stroke-width=".8"/></svg>`;
  if (kind === "light")
    return `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true" class="studixly-light-glyph"><g class="glyph-rays" stroke-linecap="round" stroke-width="1.8"><path d="M16 2.5 L16 6.5"/><path d="M16 25.5 L16 29.5"/><path d="M2.5 16 L6.5 16"/><path d="M25.5 16 L29.5 16"/><path d="M6.4 6.4 L9.2 9.2"/><path d="M22.8 22.8 L25.6 25.6"/><path d="M25.6 6.4 L22.8 9.2"/><path d="M9.2 22.8 L6.4 25.6"/></g><circle cx="16" cy="16" r="6.4" class="glyph-core" stroke-width="1.6"/><circle cx="13.8" cy="13.8" r="1.7" fill="#ffffffbf"/></svg>`;
  throw Error("Unknown orbit glyph.");
}
function presetChoices(id, values, swatches = false) {
  return `<div class="${swatches ? "creative-swatch-grid" : "creative-preset-pills"}" role="group" aria-label="${swatches ? "Lighting looks" : "Viewpoint presets"}">${values.map(([value, label], index) => `<button type="button" data-preset-for="${escaped(id)}" data-preset-value="${escaped(value)}" aria-pressed="${index === 0}">${swatches ? `<span class="creative-swatch swatch-${escaped(value || "none")}" aria-hidden="true"></span>` : ""}<span>${escaped(label)}</span></button>`).join("")}</div><select id="${escaped(id)}" class="sr-only" tabindex="-1" aria-hidden="true">${values.map(([value, label]) => `<option value="${escaped(value)}">${escaped(label)}</option>`).join("")}</select>`;
}
function lensStepper(id, label, values, icon) {
  const glyph =
    icon === "camera"
      ? orbitGlyph("camera")
      : icon === "aperture"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m14.31 8 5.74 9.94"/><path d="M9.69 8h11.48"/><path d="m7.38 12 5.74-9.94"/><path d="M9.69 16 3.95 6.06"/><path d="M14.31 16H2.83"/><path d="m16.62 12-5.74 9.94"/></svg>'
        : "";
  const button = (dir, title, path) =>
    `<button type="button" data-step-for="${escaped(id)}" data-step-dir="${dir}" aria-label="${title} ${escaped(label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="${path}"/></svg></button>`;
  return `<div class="creative-stepper" role="group" aria-label="${escaped(label)}" data-stepper="${escaped(id)}">${button(-1, "Previous", "m6 14 6-6 6 6")}<div class="creative-stepper-tile">${glyph}<span class="creative-stepper-name">${escaped(label)}</span><output id="${escaped(id)}-display" aria-live="polite">${escaped(values[0][1])}</output><select id="${escaped(id)}" class="sr-only" tabindex="-1" aria-hidden="true">${values.map(([value, title]) => `<option value="${escaped(value)}">${escaped(title)}</option>`).join("")}</select></div>${button(1, "Next", "m6 10 6 6 6-6")}</div>`;
}
module.exports = { lightingSwatches, orbitGlyph, presetChoices, lensStepper };
