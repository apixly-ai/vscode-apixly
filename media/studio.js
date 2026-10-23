(() => {
  const host = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const defaults = {
    image: "grok-imagine-image",
    edit: "gemini-3.1-flash-image",
    video: "grok-imagine-video",
  };
  const rememberedModels = { ...defaults };
  let mode = "image";
  let busy = false;
  let hasKey = false;
  let connectionState = {};
  let connecting = false;
  let references = [];
  let videoReferences = [];
  let catalog = [];
  let videos = [];
  let catalogAvailable = false;
  let catalogState = {};
  let selectedVideoCapability;
  let history = [];
  let creativeUI;
  const send = (type, extra = {}) => host.postMessage({ type, ...extra });
  function showMessage(message, kind = "") {
    $("message").textContent = message;
    $("message").className = `message ${kind}`;
  }
  function clearMessage() {
    $("message").className = "message hidden";
    $("message").textContent = "";
  }
  function referenceGeometry() {
    return (
      mode === "video" && $("model").value === "grok-imagine-video-1.5-preview"
    );
  }
  function setBusy(value) {
    busy = value;
    $("generate").disabled = value || !hasKey;
    $("resume-task").disabled = value || !hasKey;
    for (const button of document.querySelectorAll(
      ".mode-tab,#pick-references,#clear-references",
    ))
      button.disabled = value;
    for (const control of document.querySelectorAll(
      "#creation-form input,#creation-form select,#creation-form textarea",
    ))
      control.disabled = value;
    $("aspect-ratio").disabled = value || referenceGeometry();
    $("resolution").disabled = value || referenceGeometry();
    $("refresh-catalog").disabled = value || !hasKey;
    for (const button of document.querySelectorAll(
      '[data-action="connectAccount"],[data-action="setKey"],[data-action="clearKey"],[data-action="useManualKey"],[data-action="disconnectAccount"],[data-action="refreshAccount"]',
    ))
      button.disabled = value || Boolean(connectionState.busy) || connecting;
    $("account-key").disabled =
      value || Boolean(connectionState.busy) || connecting;
    $("refresh-account").disabled ||=
      connectionState.mode !== "account" || !connectionState.hasConnection;
    $("disconnect-account").disabled ||=
      connectionState.mode !== "account" || !connectionState.hasConnection;
    creativeUI?.setBusy(value);
    $("generate").disabled =
      value ||
      connecting ||
      Boolean(connectionState.busy) ||
      !hasKey ||
      (creativeUI && !creativeUI.canSubmit());
    $("generate-label").textContent = value
      ? "Working on your asset…"
      : mode === "video"
        ? "Generate video"
        : mode === "edit"
          ? "Edit image"
          : "Generate image";
  }
  function renderConnection(value) {
    connectionState = value || {};
    connecting = Boolean(connectionState.connecting);
    const account = connectionState.account;
    const bound = connectionState.mode === "account" && account;
    const selectableAccount =
      connectionState.mode === "account" && connectionState.hasConnection;
    $("connection").textContent = connectionState.error
      ? "Connection needs attention"
      : bound
        ? "Apixly account connected"
        : hasKey
          ? "API key saved"
          : "Connect your account";
    $("account-summary").textContent =
      connectionState.error ||
      (bound
        ? `${account.account.name || account.account.email || "Apixly account"} · ${account.selected_key.name} · ${account.selected_key.masked}`
        : hasKey
          ? "Manual API key configured in SecretStorage."
          : "Connect your Apixly account, or configure a manual API key.");
    $("account-summary").classList.toggle(
      "catalog-error",
      Boolean(connectionState.error),
    );
    $("account-key-section").classList.toggle("hidden", !selectableAccount);
    const keys = Array.isArray(connectionState.keys)
      ? connectionState.keys
      : [];
    const selectedId = bound ? String(account.selected_key.id) : "";
    const options = keys.map((key) => {
      const option = document.createElement("option");
      option.value = String(key.id);
      option.textContent = `${key.name}${key.is_default ? " (default)" : ""} · ${key.masked}`;
      return option;
    });
    if (!keys.some((key) => String(key.id) === selectedId)) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose an active API Key";
      options.unshift(placeholder);
    }
    $("account-key").replaceChildren(...options);
    if (bound) $("account-key").value = String(account.selected_key.id);
    $("authorization-progress").classList.toggle("hidden", !connecting);
    $("connection").classList.toggle("connected", hasKey);
    $("onboarding").classList.toggle("hidden", hasKey);
  }
  function renderCatalogStatus(count) {
    $("catalog-status").textContent = catalogState.error
      ? `${catalogAvailable ? "Showing saved models. " : ""}${catalogState.error}`
      : catalogState.capabilitiesError
        ? catalogState.capabilitiesError
        : catalogState.refreshing
          ? `${catalogAvailable ? "Showing saved models. " : ""}Updating model catalog…`
          : catalogAvailable
            ? `${count} ${mode === "video" ? "video" : "image"} models · ${catalogState.stale ? "Saved catalog; refresh when needed" : "Catalog up to date"}${catalogState.updatedAt ? ` · ${new Date(catalogState.updatedAt).toLocaleTimeString()}` : ""}`
            : "Open the picker to load models for your selected key, or enter an exact model ID.";
    $("catalog-status").classList.toggle(
      "catalog-error",
      Boolean(catalogState.error || catalogState.capabilitiesError),
    );
  }
  function modelOptions() {
    $("aspect-ratio-row").classList.toggle("hidden", referenceGeometry());
    $("video-resolution-row").classList.toggle(
      "hidden",
      mode !== "video" || referenceGeometry(),
    );
    const options = catalogAvailable
      ? window.ApixlyModelCatalogV1.buildModelOptions(catalog, videos, mode)
      : [];
    const models = options.map((model) => model.id);
    const manual = document.createElement("option");
    manual.value = "";
    manual.textContent = "Enter an exact model ID";
    $("model-picker").replaceChildren(
      manual,
      ...options.map((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = `${typeof model.name === "string" && model.name ? model.name : model.id}${model.name && model.name !== model.id ? ` · ${model.id}` : ""}${mode === "video" && !model.videoCapability ? " · parameters unavailable" : ""}`;
        return option;
      }),
    );
    $("model-picker").value = models.includes($("model").value)
      ? $("model").value
      : "";
    $("model-options").replaceChildren(
      ...models.map((model) => {
        const option = document.createElement("option");
        option.value = model;
        return option;
      }),
    );
    const capability = videos.find((item) => item.model === $("model").value);
    renderCatalogStatus(options.length);
    selectedVideoCapability = capability;
    if (mode === "video" && !capability) {
      $("video-duration-row").classList.add("hidden");
      $("video-resolution-row").classList.add("hidden");
      $("aspect-ratio-row").classList.add("hidden");
    } else if (mode === "video")
      $("video-duration-row").classList.remove("hidden");
    if (mode === "video" && capability) {
      if (Number.isFinite(capability.seconds?.min))
        $("duration").min = String(capability.seconds.min);
      else $("duration").removeAttribute("min");
      if (Number.isFinite(capability.seconds?.max))
        $("duration").max = String(capability.seconds.max);
      else $("duration").removeAttribute("max");
      const duration = Number($("duration").value);
      if (
        !Number.isFinite(capability.seconds?.min) &&
        !Number.isFinite(capability.seconds?.max)
      )
        $("duration").value = "";
      else if (
        (Number.isFinite(capability.seconds?.min) &&
          duration < capability.seconds.min) ||
        (Number.isFinite(capability.seconds?.max) &&
          duration > capability.seconds.max)
      )
        $("duration").value = Number.isFinite(capability.seconds?.min)
          ? String(capability.seconds.min)
          : "";
      if (Array.isArray(capability.resolutions)) {
        const previous = $("resolution").value;
        $("resolution").replaceChildren(
          ...["", ...capability.resolutions].map((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value || "Model default";
            return option;
          }),
        );
        $("resolution").value = capability.resolutions.includes(previous)
          ? previous
          : "";
      }
      $("model-hint").textContent = referenceGeometry()
        ? `${capability.seconds?.min ?? 1}–${capability.seconds?.max ?? 15} seconds. Framing follows the reference image; final dimensions appear in preview.`
        : `${capability.seconds?.min ?? "?"}–${capability.seconds?.max ?? "?"} seconds · ${(capability.resolutions || []).join(" / ")} · ${(capability.modes || []).join(", ")}${capability.modes?.some((item) => ["image2video", "frames2video"].includes(item)) ? " · Reference images supported." : " · Text prompts only. For image input, explicitly choose grok-imagine-video-1.5-preview or another supported model."}`;
    } else
      $("model-hint").textContent =
        mode === "edit"
          ? "Start with Gemini for reference edits. Grok image editing is not qualified in this release."
          : mode === "video"
            ? "Capability details are unavailable for this exact model. Use documented advanced parameters; reference support is checked before submitting."
            : "Choose an image model available to your Apixly key. No model is silently substituted.";
  }
  function setMode(next) {
    rememberedModels[mode] = $("model").value;
    mode = next;
    $("model").value = rememberedModels[mode];
    for (const tab of document.querySelectorAll(".mode-tab")) {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    $("reference-section").classList.toggle("hidden", mode !== "edit");
    $("video-reference-section").classList.toggle("hidden", mode !== "video");
    $("video-duration-row").classList.toggle("hidden", mode !== "video");
    $("video-resolution-row").classList.toggle("hidden", mode !== "video");
    $("prompt").placeholder =
      mode === "edit"
        ? "What should change? Describe the edit and what to preserve in your reference image…"
        : mode === "video"
          ? "A small red cube gently rotates on a studio floor. Fixed camera, soft light…"
          : "A sculptural glass object, electric blue light, a quiet studio. Describe what you want to see…";
    modelOptions();
    setBusy(busy);
    creativeUI?.refresh();
  }
  function renderHistory() {
    $("task-history").replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose a recent task";
    $("task-history").append(empty);
    for (let index = 0; index < history.length; index++) {
      const job = history[index];
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${job.kind} · ${job.id} · ${job.status || "unknown"}`;
      $("task-history").append(option);
    }
    $("history-count").textContent =
      `${history.length} recent task${history.length === 1 ? "" : "s"}`;
  }
  function renderReferences() {
    $("reference-list").replaceChildren();
    for (const reference of references) {
      const item = document.createElement("div");
      item.className = "reference-item";
      if (reference.previewUri) {
        const image = document.createElement("img");
        image.src = reference.previewUri;
        image.alt = reference.name;
        item.append(image);
      }
      const label = document.createElement("span");
      label.textContent = `${reference.name} · ${(reference.bytes / 1024).toFixed(0)} KB`;
      item.append(label);
      $("reference-list").append(item);
    }
    $("clear-references").classList.toggle("hidden", references.length === 0);
    $("pick-references").querySelector("strong").textContent = references.length
      ? "Add more reference images"
      : "Choose reference images";
  }
  $("settings-toggle").addEventListener("click", () => {
    $("settings").open = !$("settings").open;
    if ($("settings").open)
      $("settings").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  for (const anchor of document.querySelectorAll("[data-link]"))
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      send("openLink", { link: anchor.dataset.link });
    });
  for (const button of document.querySelectorAll("[data-action]"))
    button.addEventListener("click", () => send(button.dataset.action));
  for (const tab of document.querySelectorAll(".mode-tab"))
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  $("model").addEventListener("change", modelOptions);
  $("model").addEventListener("focus", () => send("requestCatalog"));
  $("model-picker").addEventListener("focus", () => send("requestCatalog"));
  $("model-picker").addEventListener("change", () => {
    if ($("model-picker").value) $("model").value = $("model-picker").value;
    else $("model").focus();
    modelOptions();
  });
  $("refresh-catalog").addEventListener("click", () => send("refreshCatalog"));
  $("account-key").addEventListener("change", () => {
    if ($("account-key").value)
      send("selectAccountKey", { keyId: $("account-key").value });
  });
  $("prompt").addEventListener("input", () => {
    $("prompt-count").textContent =
      `${$("prompt").value.length.toLocaleString()} / 20,000`;
    creativeUI?.refresh();
  });
  $("pick-references").addEventListener("click", () =>
    send("selectReferences"),
  );
  $("clear-references").addEventListener("click", () =>
    send("clearReferences"),
  );
  $("cancel-polling").addEventListener("click", () => send("cancelPolling"));
  $("copy-final-prompt").addEventListener("click", () => {
    try {
      creativeUI.refresh();
      send("copyPrompt", {
        kind: mode,
        prompt: $("prompt").value,
        tools: creativeUI.getTools(),
      });
    } catch (error) {
      showMessage(
        error.message || "Check the final prompt before copying.",
        "error",
      );
    }
  });
  $("attach-video-url").addEventListener("click", () => {
    const url = $("video-reference-url").value.trim();
    if (!url) {
      showMessage(
        "Enter a public HTTPS image URL before attaching it.",
        "error",
      );
      return;
    }
    send("addVideoUrl", { url });
    $("video-reference-url").value = "";
  });
  $("clear-video-references").addEventListener("click", () =>
    send("clearVideoReferences"),
  );
  $("task-history").addEventListener("change", () => {
    const job = history[Number($("task-history").value)];
    if ($("task-history").value !== "" && job) {
      $("resume-id").value = job.id;
      $("resume-kind").value = job.kind;
    }
  });
  $("resume-task").addEventListener("click", () => {
    if (busy) return;
    const id = $("resume-id").value.trim();
    if (!id) {
      showMessage("Select a recent task or paste its ID.", "error");
      return;
    }
    clearMessage();
    send("resumeTask", { id, kind: $("resume-kind").value });
  });
  $("creation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    try {
      creativeUI.refresh();
      if (!creativeUI.canSubmit())
        throw new Error(
          "Enter a prompt or enable creative instructions first.",
        );
      if (!hasKey) throw new Error("Connect an Apixly API key first.");
      if (mode === "video" && $("video-reference-url").value.trim())
        throw new Error(
          "Select Attach URL to confirm the video reference, or clear that field before generating.",
        );
      if (mode === "edit" && !references.length)
        throw new Error("Choose a reference image to edit.");
      const advanced = JSON.parse($("advanced-params").value);
      if (!advanced || typeof advanced !== "object" || Array.isArray(advanced))
        throw new Error("Advanced parameters must be a JSON object.");
      const params = {};
      if (
        !referenceGeometry() &&
        (mode !== "video" || selectedVideoCapability) &&
        $("aspect-ratio").value
      )
        params.aspect_ratio = $("aspect-ratio").value;
      if (mode === "video" && selectedVideoCapability) {
        if ($("duration").value) params.seconds = Number($("duration").value);
        if (!referenceGeometry() && $("resolution").value)
          params.resolution = $("resolution").value;
      }
      const merged = { ...params, ...advanced };
      creativeUI.refresh();
      const tools = creativeUI.getTools();
      clearMessage();
      send("submit", {
        kind: mode,
        model: $("model").value,
        prompt: $("prompt").value,
        params: JSON.stringify(merged),
        tools,
      });
    } catch (error) {
      showMessage(
        error instanceof SyntaxError
          ? "Advanced parameters must be valid JSON."
          : error.message || "Check your inputs before submitting.",
        "error",
      );
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.type !== "string") return;
    if (message.type === "state") {
      hasKey = Boolean(message.hasKey);
      history = Array.isArray(message.tasks) ? message.tasks : [];
      references = Array.isArray(message.references) ? message.references : [];
      videoReferences = Array.isArray(message.videoReferences)
        ? message.videoReferences
        : [];
      $("video-reference-list").replaceChildren(
        ...videoReferences.map((item) => {
          const label = document.createElement("div");
          label.className = "reference-item";
          label.textContent = `${item.name} · ${item.origin}`;
          return label;
        }),
      );
      $("clear-video-references").classList.toggle(
        "hidden",
        !videoReferences.length,
      );
      renderConnection(message.connection);
      renderHistory();
      renderReferences();
      creativeUI?.setReference(references[0]?.previewUri);
      setBusy(busy);
    } else if (message.type === "authorization") {
      connecting = true;
      $("settings").open = true;
      $("authorization-code").textContent = message.userCode;
      $("authorization-expiry").textContent =
        `Expires at ${new Date(message.expiresAt).toLocaleTimeString()}. Waiting here does not generate media.`;
      $("authorization-progress").classList.remove("hidden");
      $("authorization-progress").scrollIntoView({ block: "nearest" });
      setBusy(busy);
    } else if (message.type === "videoPreset") {
      setMode("video");
      $("video-reference-url").value = "";
      $("model").value = message.model;
      rememberedModels.video = message.model;
      $("duration").value = "3";
      $("aspect-ratio").value = "";
      $("resolution").value = "";
      modelOptions();
      showMessage(
        "Generated image link attached. Review the explicit video model and parameters, then select Generate video. No video has been submitted.",
      );
    } else if (message.type === "catalog") {
      if (message.available) {
        catalog = Array.isArray(message.models) ? message.models : [];
        videos = Array.isArray(message.videos) ? message.videos : [];
        catalogAvailable = true;
      } else if (message.clear) {
        catalog = [];
        videos = [];
        catalogAvailable = false;
      }
      catalogState = message;
      modelOptions();
    } else if (message.type === "busy") {
      setBusy(Boolean(message.value));
      if (!busy) $("progress-section").classList.add("hidden");
    } else if (message.type === "submitting") {
      $("empty-output").classList.add("hidden");
      $("results").replaceChildren();
      $("progress-section").classList.remove("hidden");
      $("progress-title").textContent = "Sending your request";
      $("progress-detail").textContent =
        "One submission. Your exact model and parameters.";
      $("task-id").textContent = "";
      $("cancel-polling").disabled = true;
      $("output-status").textContent = "Submitting";
    } else if (message.type === "submitted" || message.type === "progress") {
      $("empty-output").classList.add("hidden");
      $("progress-section").classList.remove("hidden");
      $("cancel-polling").disabled = false;
      $("progress-title").textContent = "Bringing your idea to life";
      $("progress-detail").textContent =
        `${message.task.status || "queued"}${typeof message.progress === "number" ? ` · ${message.progress}%` : ""}`;
      $("task-id").textContent = `Task ID: ${message.task.id}`;
      $("output-status").textContent = message.task.status || "Queued";
      $("progress-bar").style.width =
        `${typeof message.progress === "number" ? Math.min(100, Math.max(4, message.progress)) : 25}%`;
    } else if (message.type === "result") {
      $("empty-output").classList.add("hidden");
      $("progress-section").classList.add("hidden");
      $("results").replaceChildren();
      $("output-status").textContent = "Ready to save";
      for (const asset of message.assets || []) {
        const card = document.createElement("article");
        card.className = "result-card";
        card.dataset.assetId = asset.id;
        const media = document.createElement(
          asset.kind === "video" ? "video" : "img",
        );
        media.src = asset.previewUri;
        if (asset.kind === "video") {
          media.controls = true;
          media.preload = "metadata";
        } else media.alt = "Generated Apixly image";
        const actions = document.createElement("div");
        actions.className = "result-actions";
        const meta = document.createElement("span");
        meta.className = "result-meta";
        meta.textContent = `${asset.extension.slice(1).toUpperCase()} · ${(asset.bytes / 1024 / 1024).toFixed(2)} MiB`;
        if (asset.kind === "video") {
          const actualMetadata = () => {
            meta.textContent = `${media.videoWidth} × ${media.videoHeight} · ${Number.isFinite(media.duration) ? media.duration.toFixed(2) : "?"}s · ${(asset.bytes / 1024 / 1024).toFixed(2)} MiB`;
          };
          media.addEventListener("loadedmetadata", actualMetadata);
          if (media.readyState >= 1) actualMetadata();
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button primary compact";
        button.textContent = "Save to project ↓";
        button.addEventListener("click", () =>
          send("saveAsset", { id: asset.id }),
        );
        actions.append(meta);
        if (asset.canUseForVideo) {
          const use = document.createElement("button");
          use.type = "button";
          use.className = "button secondary compact";
          use.textContent = "Use for video";
          use.setAttribute("aria-label", "Use this generated image for video");
          use.addEventListener("click", () =>
            send("useGeneratedImage", { id: asset.id }),
          );
          actions.append(use);
        }
        actions.append(button);
        card.append(media, actions);
        $("results").append(card);
      }
      showMessage(
        `Finished with ${message.task.model || "your selected model"}. Task ${message.task.id} stays available in recent history.`,
      );
    } else if (message.type === "saved")
      showMessage(`Saved ${message.filename} to your project.`, "success");
    else if (message.type === "promptCopied")
      $("creative-copy-status").textContent = "Copied to clipboard.";
    else if (message.type === "error") {
      showMessage(message.message, "error");
      if (!busy) $("output-status").textContent = "Needs attention";
    }
  });
  creativeUI = window.ApixlyCreativeControlsUI.installCreativeControls(
    document,
    {
      getPrompt: () => $("prompt").value,
      getMode: () => (mode === "edit" ? "edit" : "generate"),
      onChange: () => setBusy(busy),
    },
  );
  setMode("image");
  send("ready");
})();
