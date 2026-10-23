/* Apixly Creative Controls v1.0.0 — canonical dependency-free UMD compiler.
 * Vocabulary source: apixly-ai/studixly b3f80bc5ce935435cf9f28ee079bd77da1868587.
 * Pure prompt composition only: no I/O, inference, storage, or credentials.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ApixlyCreativeControlsV1 = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const catalog = {
    angle: {
      directionalPresets: {
        front_high: "front view, high-angle shot, looking down at the subject",
        front_low: "front view, low-angle shot, looking up from below",
        aerial_top_down: "aerial view, bird's-eye view, top-down shot",
        back: "back view, seen from behind",
      },
      lensPresets: {
        fisheye: "fisheye lens, distorted spherical wide-angle perspective",
        dutch: "Dutch angle, tilted canted camera",
      },
      yawSectors: [
        "",
        "three-quarter front view, from the right",
        "right side profile view",
        "three-quarter back view, from the right",
        "back view, seen from behind",
        "three-quarter back view, from the left",
        "left side profile view",
        "three-quarter front view, from the left",
      ],
      shots: {
        none: "",
        extreme_long: "extreme long shot",
        long: "long shot, full body in frame",
        medium: "medium shot, from the waist up",
        medium_close_up: "medium close-up",
        close_up: "close-up shot",
      },
    },
    lighting: {
      presets: {
        overexposedFilm:
          "overexposed film look, blown-out highlights, dreamy soft glow",
        blueBacklight:
          "blue backlighting, cool blue rim light, glowing silhouette edges",
        rembrandt:
          "Rembrandt lighting, key light at 45 degrees, triangle of light on the shadow-side cheek, chiaroscuro",
        cyberpunk:
          "cyberpunk lighting, neon pink and cyan light sources, high-contrast neon rim lighting",
        psychedelicSunset:
          "psychedelic sunset lighting, saturated magenta and orange glow, low sun backlight",
        mysteriousDark:
          "low-key lighting, deep dramatic shadows, mysterious moody atmosphere",
        goldenHour:
          "golden hour lighting, warm soft low-angle sunlight, long shadows",
        nolanGray:
          "cool desaturated color grade, muted teal and slate gray tones, soft overcast cinematic light",
      },
      keyLights: {
        left: "key light from camera left, dramatic side lighting",
        right: "key light from camera right, dramatic side lighting",
        top: "overhead top lighting",
        front: "frontal lighting, evenly lit",
        bottom: "underlighting, lit from below",
        back: "backlighting, subject lit from behind",
      },
      lightAzNames: [
        "front",
        "front-right",
        "camera right",
        "back-right",
        "behind",
        "back-left",
        "camera left",
        "front-left",
      ],
      hueSectors: [
        [15, "red"],
        [40, "orange"],
        [52, "amber"],
        [70, "yellow"],
        [150, "green"],
        [175, "teal"],
        [200, "cyan"],
        [260, "blue"],
        [300, "purple"],
        [330, "magenta"],
        [345, "pink"],
        [360, "red"],
      ],
    },
    camera: {
      bodies: {
        "arri-alexa-35": "ARRI Alexa 35",
        "sony-venice": "Sony Venice",
        "red-v-raptor": "RED V-Raptor",
        "panavision-dxl2": "Panavision Millennium DXL2",
        "imax-film": "IMAX 70mm film camera",
        "leica-m11": "Leica M11",
      },
      lenses: {
        "cooke-anamorphic-sf": "Cooke Anamorphic/i SF 1.8x lens",
        "panavision-c-series": "Panavision C-Series anamorphic lens",
        "zeiss-master-prime": "Zeiss Master Prime lens",
        "canon-k35": "vintage Canon K-35 lens",
        "helios-44-2": "vintage Helios 44-2 lens",
        lensbaby: "Lensbaby lens",
      },
      apertures: [
        "",
        "f/1.4",
        "f/1.8",
        "f/2.8",
        "f/4",
        "f/5.6",
        "f/8",
        "f/11",
        "f/16",
      ],
    },
  };
  const fields = {
    angle: {
      enabled: "boolean",
      preset: [
        "custom",
        "fisheye",
        "dutch",
        "front_high",
        "front_low",
        "aerial_top_down",
        "back",
      ],
      yaw: "finite number, -360000..360000, wrap modulo360",
      pitch: "finite number -90..90; POSITIVE=above/high-angle",
      shot: [
        "none",
        "extreme_long",
        "long",
        "medium",
        "medium_close_up",
        "close_up",
      ],
      showPrompt: "optional boolean UI-only; ignored",
    },
    lighting: {
      enabled: "boolean",
      preset: [
        "",
        "overexposedFilm",
        "blueBacklight",
        "rembrandt",
        "cyberpunk",
        "psychedelicSunset",
        "mysteriousDark",
        "goldenHour",
        "nolanGray",
      ],
      view: ["perspective", "front"],
      brightness: "finite number 0..100",
      color:
        "empty or #RGB/#RRGGBB; active #000/#000000 rejects (use brightness to darken)",
      keyLight: ["", "left", "top", "right", "front", "bottom", "back"],
      lightYaw:
        "optional finite number -360000..360000; do not fill default0 if omitted",
      lightPitch: "optional finite number -90..90; POSITIVE=above",
      rimLight: "boolean",
      smartText:
        "string <=1000 UTF-16 code units; trim only this free-text field",
    },
    camera: {
      enabled: "boolean",
      body: [
        "",
        "arri-alexa-35",
        "sony-venice",
        "red-v-raptor",
        "panavision-dxl2",
        "imax-film",
        "leica-m11",
      ],
      lens: [
        "",
        "cooke-anamorphic-sf",
        "panavision-c-series",
        "zeiss-master-prime",
        "canon-k35",
        "helios-44-2",
        "lensbaby",
      ],
      focal: "null or integer8..800 (mm)",
      aperture: [
        "",
        "f/1.4",
        "f/1.8",
        "f/2.8",
        "f/4",
        "f/5.6",
        "f/8",
        "f/11",
        "f/16",
      ],
    },
  };
  const guard =
    "Preserve all subject and scene details that are not explicitly requested to change.";

  function invalid(path) {
    const error = new Error(`Invalid creative controls at ${path}.`);
    error.path = path;
    error.safe = true;
    throw error;
  }
  function plain(value, path) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      invalid(path);
  }
  function known(value, keys, path) {
    plain(value, path);
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        const safeKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
          ? key
          : "unknown_field";
        invalid(path ? `${path}.${safeKey}` : safeKey);
      }
    }
  }
  const ranges = {
    yaw: [-360000, 360000],
    pitch: [-90, 90],
    lightYaw: [-360000, 360000],
    lightPitch: [-90, 90],
    brightness: [0, 100],
  };
  function validateGroup(name, value) {
    const path = `tools.${name}`;
    known(value, Object.keys(fields[name]), path);
    for (const [key, item] of Object.entries(value)) {
      const field = `${path}.${key}`;
      if (Array.isArray(fields[name][key])) {
        if (!fields[name][key].includes(item)) invalid(field);
      } else if (["enabled", "showPrompt", "rimLight"].includes(key)) {
        if (typeof item !== "boolean") invalid(field);
      } else if (Object.hasOwn(ranges, key)) {
        const [min, max] = ranges[key];
        if (
          typeof item !== "number" ||
          !Number.isFinite(item) ||
          item < min ||
          item > max
        )
          invalid(field);
      } else if (key === "focal") {
        if (
          item !== null &&
          (typeof item !== "number" ||
            !Number.isInteger(item) ||
            item < 8 ||
            item > 800)
        )
          invalid(field);
      } else if (key === "smartText") {
        if (typeof item !== "string" || item.length > 1000) invalid(field);
      } else if (key === "color") {
        if (
          typeof item !== "string" ||
          (item !== "" && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(item))
        )
          invalid(field);
        if (value.enabled === true && /^#(?:000|000000)$/.test(item))
          invalid(field);
      }
    }
  }
  const wrap = (n) => ((n % 360) + 360) % 360;
  const sector = (n) => Math.floor(((wrap(n) + 22.5) % 360) / 45) % 8;
  function angle(setting) {
    if (setting.enabled !== true) return "";
    const preset = setting.preset ?? "custom";
    const yaw = setting.yaw ?? 0;
    const pitch = setting.pitch ?? 0;
    const parts = [];
    if (catalog.angle.directionalPresets[preset])
      parts.push(catalog.angle.directionalPresets[preset]);
    else {
      parts.push(
        catalog.angle.lensPresets[preset] || "",
        catalog.angle.yawSectors[sector(yaw)],
      );
      parts.push(
        pitch >= 60
          ? "bird's-eye view, top-down shot, directly overhead"
          : pitch > 15
            ? "high-angle shot, looking down at the subject"
            : pitch >= -15
              ? ""
              : pitch > -60
                ? "low-angle shot, looking up from below"
                : "worm's-eye view, extreme low angle",
      );
      const numbers = [];
      const azimuth = wrap(Math.round(yaw));
      const elevation = Math.round(pitch);
      if (azimuth !== 0) numbers.push(`${azimuth}° azimuth`);
      if (elevation !== 0) numbers.push(`${elevation}° elevation`);
      if (numbers.length) parts.push(`(${numbers.join(", ")})`);
    }
    parts.push(catalog.angle.shots[setting.shot ?? "none"]);
    return parts.filter(Boolean).join(", ");
  }
  function colorName(hex) {
    if (!hex) return "";
    const full =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    const [r, g, b] = [1, 3, 5].map(
      (i) => Number.parseInt(full.slice(i, i + 2), 16) / 255,
    );
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    const delta = max - min,
      lightness = (max + min) / 2;
    const saturation =
      delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < 0.15) return "white";
    let hue = 0;
    if (delta > 0)
      hue =
        max === r
          ? 60 * (((g - b) / delta) % 6)
          : max === g
            ? 60 * ((b - r) / delta + 2)
            : 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
    return (
      catalog.lighting.hueSectors.find(([upper]) => hue < upper)?.[1] || "red"
    );
  }
  function lightDirection(yaw, pitch) {
    const azimuth = wrap(Math.round(yaw)),
      elevation = Math.round(pitch);
    if (azimuth === 0 && elevation === 0) return "";
    const index = sector(azimuth);
    const elevationName =
      elevation >= 45
        ? "high above"
        : elevation >= 15
          ? "above"
          : elevation <= -45
            ? "far below"
            : elevation <= -15
              ? "below"
              : "";
    const where =
      [index ? catalog.lighting.lightAzNames[index] : "", elevationName]
        .filter(Boolean)
        .join(" ") || "front";
    return `key light from the ${where} (${azimuth}° azimuth, ${elevation}° elevation)`;
  }
  function lighting(setting) {
    if (setting.enabled !== true) return "";
    const color = colorName(setting.color);
    const direction =
      Object.hasOwn(setting, "lightYaw") || Object.hasOwn(setting, "lightPitch")
        ? lightDirection(setting.lightYaw ?? 0, setting.lightPitch ?? 0)
        : catalog.lighting.keyLights[setting.keyLight] || "";
    const brightness = setting.brightness ?? 50;
    const brightnessText =
      brightness <= 14
        ? "very dim lighting, deep shadows"
        : brightness <= 39
          ? "dim, subdued lighting"
          : brightness <= 60
            ? ""
            : brightness <= 85
              ? "bright, well-lit"
              : "very bright, high-key lighting";
    return [
      catalog.lighting.presets[setting.preset] || "",
      direction ? (color ? `${color} ${direction}` : direction) : "",
      brightnessText,
      !direction && color ? `${color} light` : "",
      setting.rimLight ? "rim lighting outlining the subject's edges" : "",
      setting.smartText?.trim()
        ? `lighting style: ${setting.smartText.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  function camera(setting) {
    if (setting.enabled !== true) return "";
    const body = catalog.camera.bodies[setting.body],
      lens = catalog.camera.lenses[setting.lens];
    const parts = [];
    if (body && lens) parts.push(`shot on ${body} with ${lens}`);
    else if (body) parts.push(`shot on ${body}`);
    else if (lens) parts.push(`shot with ${lens}`);
    const focal = setting.focal;
    if (typeof focal === "number")
      parts.push(
        focal <= 20
          ? `ultra wide-angle ${focal}mm`
          : focal <= 32
            ? `wide-angle ${focal}mm`
            : focal >= 85
              ? `${focal}mm telephoto`
              : `${focal}mm`,
      );
    if (setting.aperture)
      parts.push(
        ["f/1.4", "f/1.8"].includes(setting.aperture)
          ? `${setting.aperture}, shallow depth of field`
          : ["f/8", "f/11", "f/16"].includes(setting.aperture)
            ? `${setting.aperture}, deep focus`
            : setting.aperture,
      );
    return parts.join(", ");
  }
  const builders = { angle, lighting, camera };
  const labels = { angle: "Camera", lighting: "Lighting", camera: "Lens" };
  const wrappers = {
    angle: (text) =>
      `Change the camera angle: re-photograph the exact same subject from ${text}.`,
    lighting: (text) =>
      `Change the lighting: relight the same scene with ${text}.`,
    camera: (text) => `Change the camera and lens style: make it look ${text}.`,
  };
  function composeCreativePrompt(payload) {
    plain(payload, "payload");
    known(payload, ["prompt", "mode", "tools"], "");
    if (typeof payload.prompt !== "string" || payload.prompt.length > 20000)
      invalid("prompt");
    const mode = payload.mode === undefined ? "generate" : payload.mode;
    if (!["generate", "edit"].includes(mode)) invalid("mode");
    const tools = payload.tools === undefined ? {} : payload.tools;
    known(tools, ["angle", "lighting", "camera"], "tools");
    const sections = [];
    for (const tool of ["angle", "lighting", "camera"]) {
      if (!Object.hasOwn(tools, tool)) continue;
      validateGroup(tool, tools[tool]);
      const fragment = builders[tool](tools[tool]);
      if (!fragment) continue;
      const label = labels[tool];
      sections.push({
        tool,
        label,
        text:
          mode === "edit" ? wrappers[tool](fragment) : `${label}: ${fragment}`,
      });
    }
    let final_prompt = payload.prompt;
    if (sections.length) {
      const lines = sections.map((section) => section.text);
      if (mode === "edit") lines.push(guard);
      final_prompt =
        (payload.prompt ? `${payload.prompt}\n\n` : "") + lines.join("\n");
    }
    if (final_prompt.length > 20000) invalid("final_prompt");
    return {
      final_prompt,
      sections,
      applied_tools: sections.map((section) => section.tool),
      changed: final_prompt !== payload.prompt,
    };
  }
  return Object.freeze({ composeCreativePrompt });
});
