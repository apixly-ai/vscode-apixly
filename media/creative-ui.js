(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(root);
  else root.ApixlyCreativeControlsUI = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const defaults = {
    angle: { enabled: false, preset: "custom", yaw: 0, pitch: 0, shot: "none" },
    lighting: {
      enabled: false,
      preset: "",
      brightness: 50,
      color: "",
      rimLight: false,
      smartText: "",
    },
    camera: { enabled: false, body: "", lens: "", focal: null, aperture: "" },
  };
  const directions = {
    front_high: { yaw: 0, pitch: 45 },
    front_low: { yaw: 0, pitch: -45 },
    aerial_top_down: { yaw: 0, pitch: 80 },
    back: { yaw: 180, pitch: 0 },
  };
  const keyDirections = {
    left: { yaw: 270, pitch: 0 },
    right: { yaw: 90, pitch: 0 },
    top: { yaw: 0, pitch: 90 },
    front: { yaw: 0, pitch: 0 },
    bottom: { yaw: 0, pitch: -90 },
    back: { yaw: 180, pitch: 0 },
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const wrap = (value) => ((value % 360) + 360) % 360;
  const clamp = (value) => Math.max(-90, Math.min(90, value));
  const initialTools = () => clone(defaults);
  function disableAll(tools) {
    const copy = clone(tools);
    for (const group of Object.values(copy)) group.enabled = false;
    return copy;
  }
  function moveDirection(start, dx, dy, sensitivity = 0.6) {
    return {
      yaw: wrap(Math.round(start.yaw + dx * sensitivity)),
      pitch: clamp(Math.round(start.pitch - dy * sensitivity)),
    };
  }
  function selectAnglePreset(setting, preset) {
    return { ...setting, preset, ...(directions[preset] || {}) };
  }
  function projectPoint(lon, lat, yaw = 24, pitch = -16) {
    const deg = Math.PI / 180,
      lambda = (lon - yaw) * deg,
      phi = lat * deg,
      phi0 = pitch * deg;
    return {
      x: 100 + 78 * Math.cos(phi) * Math.sin(lambda),
      y:
        100 -
        78 *
          (Math.cos(phi0) * Math.sin(phi) -
            Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda)),
      front:
        Math.sin(phi0) * Math.sin(phi) +
          Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda) >=
        0,
    };
  }
  function showPreview(doc, result, error) {
    const $ = (id) => doc.getElementById(id);
    $("final-prompt").value = result?.final_prompt || "";
    $("creative-error").textContent = error?.message || "";
    $("creative-error").classList.toggle("hidden", !error);
    $("creative-status").textContent = error
      ? "Check settings"
      : result?.applied_tools.length
        ? `${result.applied_tools.length} active`
        : "Original prompt";
    $("creative-length").textContent =
      `${(result?.final_prompt.length || 0).toLocaleString()} / 20,000`;
    $("creative-applied").textContent = result?.applied_tools.length
      ? `Added instructions: ${result.applied_tools.map((tool) => ({ angle: "Viewpoint", lighting: "Lighting", camera: "Lens" })[tool]).join(" · ")}. The editable prompt above is unchanged.`
      : "Original prompt unchanged. No creative instructions are added.";
    if (error) $("prompt-preview").open = true;
  }
  function canSubmitPrompt(result, error) {
    return (
      !error &&
      typeof result?.final_prompt === "string" &&
      Boolean(result.final_prompt.trim())
    );
  }
  function installCreativeControls(doc, { getPrompt, getMode, onChange }) {
    const $ = (id) => doc.getElementById(id);
    let tools = initialTools(),
      busy = false,
      valid = true;
    let lastResult, lastError;
    const errors = new Map();
    const setValue = (id, value) => {
      const node = $(id);
      if (doc.activeElement !== node) node.value = String(value ?? "");
    };
    const groupFor = (id) => id.split("-")[0];
    const effectiveLight = () =>
      Object.hasOwn(tools.lighting, "lightYaw") ||
      Object.hasOwn(tools.lighting, "lightPitch")
        ? {
            yaw: tools.lighting.lightYaw ?? 0,
            pitch: tools.lighting.lightPitch ?? 0,
          }
        : keyDirections[tools.lighting.keyLight] || { yaw: 0, pitch: 0 };
    function draw(group) {
      const angles = group === "angle" ? tools.angle : effectiveLight();
      const point = projectPoint(
        Number.isFinite(angles.yaw) ? angles.yaw : 0,
        Number.isFinite(angles.pitch) ? angles.pitch : 0,
        tools.lighting.view === "front" && group === "lighting" ? 0 : 24,
        tools.lighting.view === "front" && group === "lighting" ? 0 : -16,
      );
      $(group + "-marker").style.left = `${point.x / 2}%`;
      $(group + "-marker").style.top = `${point.y / 2}%`;
      $(group + "-marker").classList.toggle("behind", !point.front);
      $(group + "-sight").setAttribute("x1", String(point.x));
      $(group + "-sight").setAttribute("y1", String(point.y));
    }
    function updateDisabled() {
      for (const group of ["angle", "lighting", "camera"]) {
        $(group + "-enabled").disabled = busy;
        $(group + "-fields").disabled = busy || !tools[group].enabled;
      }
      $("lighting-color").disabled =
        busy || !tools.lighting.enabled || !tools.lighting.color;
      for (const node of doc.querySelectorAll(
        "[data-creative-tab],#creative-off,#creative-reset",
      ))
        node.disabled = busy;
      $("copy-final-prompt").disabled =
        busy || !canSubmitPrompt(lastResult, lastError);
    }
    function refresh() {
      for (const group of ["angle", "lighting", "camera"])
        $(group + "-enabled").checked = tools[group].enabled;
      setValue("angle-preset", tools.angle.preset);
      setValue("angle-shot", tools.angle.shot);
      for (const key of ["yaw", "pitch"]) {
        setValue("angle-" + key, tools.angle[key]);
        setValue("angle-" + key + "-number", tools.angle[key]);
      }
      setValue("lighting-preset", tools.lighting.preset);
      setValue("lighting-keyLight", tools.lighting.keyLight || "");
      setValue("lighting-view", tools.lighting.view || "perspective");
      const light = effectiveLight();
      for (const [key, value] of [
        ["lightYaw", light.yaw],
        ["lightPitch", light.pitch],
        ["brightness", tools.lighting.brightness],
      ]) {
        setValue("lighting-" + key, value);
        setValue("lighting-" + key + "-number", value);
      }
      $("lighting-color-enable").checked = Boolean(tools.lighting.color);
      if (tools.lighting.color)
        setValue("lighting-color", tools.lighting.color);
      $("lighting-color-label").textContent =
        tools.lighting.color || "Unspecified";
      $("lighting-rimLight").checked = tools.lighting.rimLight;
      setValue("lighting-smartText", tools.lighting.smartText);
      for (const key of ["body", "lens", "aperture"])
        setValue("camera-" + key, tools.camera[key]);
      setValue("camera-focal-number", tools.camera.focal);
      setValue(
        "camera-focal",
        tools.camera.focal === null
          ? ""
          : [16, 24, 35, 50, 85, 135].includes(tools.camera.focal)
            ? String(tools.camera.focal)
            : "custom",
      );
      updateDisabled();
      draw("angle");
      draw("lighting");
      let result, error;
      try {
        const bad = [...errors].find(([id]) => tools[groupFor(id)]?.enabled);
        if (bad) throw new Error(bad[1]);
        result = root.ApixlyCreativeControlsV1.composeCreativePrompt({
          prompt: getPrompt(),
          mode: getMode(),
          tools,
        });
        valid = true;
      } catch (cause) {
        valid = false;
        error =
          cause.path === "final_prompt"
            ? new Error(
                "Final prompt exceeds 20,000 characters. Shorten your prompt or creative instructions.",
              )
            : cause.path === "tools.lighting.color"
              ? new Error(
                  "Choose a light color. Use Brightness to darken the scene.",
                )
              : cause;
      }
      lastResult = result;
      lastError = error;
      showPreview(doc, result, error);
      $("copy-final-prompt").disabled = busy || !canSubmitPrompt(result, error);
      $("creative-copy-status").textContent = "";
      if (result?.applied_tools.length) $("prompt-preview").open = true;
      onChange?.();
    }
    const on = (id, type, handler) => $(id).addEventListener(type, handler);
    function direction(group, next) {
      if (group === "angle")
        tools.angle = {
          ...tools.angle,
          ...next,
          preset: directions[tools.angle.preset]
            ? "custom"
            : tools.angle.preset,
        };
      else
        tools.lighting = {
          ...tools.lighting,
          lightYaw: next.yaw,
          lightPitch: next.pitch,
          keyLight: "",
        };
    }
    for (const group of ["angle", "lighting", "camera"]) {
      on(group + "-enabled", "change", (event) => {
        tools[group].enabled = event.target.checked;
        for (const id of errors.keys())
          if (groupFor(id) === group) errors.delete(id);
        refresh();
      });
    }
    for (const button of doc.querySelectorAll("[data-creative-tab]"))
      button.addEventListener("click", () => {
        for (const tab of doc.querySelectorAll("[data-creative-tab]")) {
          const active = tab === button;
          tab.setAttribute("aria-selected", String(active));
          $(tab.dataset.creativeTab + "-panel").classList.toggle(
            "hidden",
            !active,
          );
        }
      });
    on("angle-preset", "change", (event) => {
      tools.angle = selectAnglePreset(tools.angle, event.target.value);
      refresh();
    });
    for (const [group, key] of [
      ["angle", "shot"],
      ["lighting", "preset"],
      ["lighting", "view"],
      ["camera", "body"],
      ["camera", "lens"],
      ["camera", "aperture"],
    ])
      on(group + "-" + key, "change", (event) => {
        tools[group][key] = event.target.value;
        refresh();
      });
    on("lighting-keyLight", "change", (event) => {
      tools.lighting.keyLight = event.target.value;
      delete tools.lighting.lightYaw;
      delete tools.lighting.lightPitch;
      refresh();
    });
    const numbers = [
      ["angle", "yaw", 0, 359],
      ["angle", "pitch", -90, 90],
      ["lighting", "lightYaw", 0, 359],
      ["lighting", "lightPitch", -90, 90],
      ["lighting", "brightness", 0, 100],
    ];
    for (const [group, key, min, max] of numbers)
      for (const suffix of ["", "-number"]) {
        const id = group + "-" + key + suffix;
        on(id, "input", (event) => {
          const value =
            event.target.value === "" ? NaN : Number(event.target.value);
          if (!Number.isFinite(value) || value < min || value > max) {
            errors.set(id, `Enter a ${key} value between ${min} and ${max}.`);
          } else {
            errors.delete(id);
            if (group === "angle")
              direction(group, {
                yaw: tools.angle.yaw,
                pitch: tools.angle.pitch,
                [key]: value,
              });
            else if (key === "brightness") tools.lighting.brightness = value;
            else
              direction(group, {
                ...effectiveLight(),
                [key === "lightYaw" ? "yaw" : "pitch"]: value,
              });
          }
          refresh();
        });
      }
    on("lighting-color-enable", "change", (event) => {
      tools.lighting.color = event.target.checked
        ? $("lighting-color").value
        : "";
      refresh();
    });
    on("lighting-color", "input", (event) => {
      tools.lighting.color = event.target.value;
      refresh();
    });
    on("lighting-rimLight", "change", (event) => {
      tools.lighting.rimLight = event.target.checked;
      refresh();
    });
    on("lighting-smartText", "input", (event) => {
      tools.lighting.smartText = event.target.value;
      refresh();
    });
    on("camera-focal", "change", (event) => {
      tools.camera.focal =
        event.target.value === ""
          ? null
          : event.target.value === "custom"
            ? tools.camera.focal || 50
            : Number(event.target.value);
      errors.delete("camera-focal-number");
      refresh();
    });
    on("camera-focal-number", "input", (event) => {
      const value =
        event.target.value === "" ? null : Number(event.target.value);
      if (
        value !== null &&
        (!Number.isInteger(value) || value < 8 || value > 800)
      )
        errors.set(
          "camera-focal-number",
          "Enter a whole focal length between 8 and 800 mm.",
        );
      else {
        errors.delete("camera-focal-number");
        tools.camera.focal = value;
      }
      refresh();
    });
    for (const group of ["angle", "lighting"]) {
      const orb = $(group + "-orbit");
      let drag;
      const move = (dx, dy, sensitivity) => {
        if (busy || !tools[group].enabled) return;
        direction(
          group,
          moveDirection(
            group === "angle" ? tools.angle : effectiveLight(),
            dx,
            dy,
            sensitivity,
          ),
        );
        refresh();
      };
      orb.addEventListener("pointerdown", (event) => {
        if (
          busy ||
          !tools[group].enabled ||
          event.target.closest("[data-nudge]")
        )
          return;
        event.preventDefault();
        drag = { x: event.clientX, y: event.clientY };
        orb.setPointerCapture(event.pointerId);
      });
      orb.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x,
          dy = event.clientY - drag.y;
        drag = { x: event.clientX, y: event.clientY };
        move(dx, dy);
      });
      const end = (event) => {
        drag = undefined;
        if (orb.hasPointerCapture(event.pointerId))
          orb.releasePointerCapture(event.pointerId);
      };
      orb.addEventListener("pointerup", end);
      orb.addEventListener("pointercancel", end);
      orb.addEventListener("keydown", (event) => {
        const offsets = {
          ArrowLeft: [-15, 0],
          ArrowRight: [15, 0],
          ArrowUp: [0, -15],
          ArrowDown: [0, 15],
        };
        if (offsets[event.key]) {
          event.preventDefault();
          move(...offsets[event.key], 1);
        }
      });
      for (const button of orb.querySelectorAll("[data-nudge]"))
        button.addEventListener("click", () => {
          const delta = {
            left: [-15, 0],
            right: [15, 0],
            up: [0, -15],
            down: [0, 15],
          }[button.dataset.nudge];
          move(...delta, 1);
        });
    }
    on("creative-off", "click", () => {
      tools = disableAll(tools);
      errors.clear();
      refresh();
    });
    on("creative-reset", "click", () => {
      tools = initialTools();
      errors.clear();
      refresh();
    });
    refresh();
    return {
      refresh,
      isValid: () => valid,
      getTools: () => {
        if (!valid)
          throw new Error("Check creative controls before generating.");
        if (!canSubmitPrompt(lastResult, lastError))
          throw new Error(
            "Enter a prompt or enable creative instructions first.",
          );
        return clone(tools);
      },
      canSubmit: () => canSubmitPrompt(lastResult, lastError),
      setBusy: (value) => {
        busy = value;
        updateDisabled();
      },
      setReference: (uri) => {
        for (const group of ["angle", "lighting"]) {
          const image = $(group + "-subject");
          if (uri) image.setAttribute("href", uri);
          else image.removeAttribute("href");
          image.classList.toggle("hidden", !uri);
        }
      },
    };
  }
  return {
    initialTools,
    moveDirection,
    selectAnglePreset,
    disableAll,
    projectPoint,
    showPreview,
    canSubmitPrompt,
    installCreativeControls,
  };
});
