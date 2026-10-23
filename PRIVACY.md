# Privacy

Apixly Media is a client for the paid [Apixly API](https://apixly.ai). An Apixly account, a standard API key, and sufficient balance are required. The extension itself is open source under the MIT license.

## Credentials and local state

The API key is stored through VS Code's `ExtensionContext.secrets` (SecretStorage). It is not written to workspace settings, project files, logs, task history, or Settings Sync by this extension. The operating system and VS Code control the underlying secret storage. Clear it with **Apixly Media: Clear API Key**.

The extension retains up to 100 task records in VS Code extension global state: task ID, image/video kind, exact model ID, last observed status, and submission time. It does not retain prompts, reference files, result URLs, or API keys there. Task records may remain after a key is removed. This release does not register those records for Settings Sync.

Selected-key model metadata is cached in host memory for ten minutes and refreshed lazily when you open the model picker, or explicitly choose Refresh models. Cache identities use a manual-key SHA256 digest or account/connection/key-selection metadata, never a raw key. Catalog requests are read-only and do not submit inference. Old identities cannot overwrite a new selection with a late response.

The Media Studio Webview receives whether a key is stored, never the key itself. It cannot make network requests directly. Selected reference thumbnails and completed previews are copied to a private, per-panel cache under VS Code extension storage. Closing the panel removes its cache; explicitly saved project files remain. In the event of a force-quit or system crash, a stale cache can remain until VS Code's extension storage is removed. The extension does not persist your prompt or advanced form values.

Viewpoint, lighting, camera/lens settings and additional lighting text remain in panel memory. Their final-prompt preview is computed locally without a model request. Closing the panel clears those values; they are not added to workspace configuration, task history, or Settings Sync. On an explicit generation submission, the host validates the settings and composes the displayed instructions into the prompt. **Copy final prompt** writes that host-recomputed text to your system clipboard only when you select the button; it does not read a key or call the API.

## Network requests

Only your prompt (including enabled creative instructions shown in the final-prompt preview), selected reference image bytes, model ID, and model parameters are submitted to `https://apixly.ai/v1`. Apixly and the upstream provider process these inputs. Creative-control settings do not create extra vendor API fields or separate inference calls. Review the current policies and pricing on [Apixly](https://apixly.ai) before uploading private or regulated material. The extension does not inspect or upload other project files.

If you attach a public reference image URL or explicitly enter reference video/audio/image URLs in advanced video parameters, those URLs are sent to Apixly for processing. Local reference images are sent as multipart bytes for image edits. Local files are not silently uploaded to obtain public video-reference URLs. **Use for video** retains the original generated-image URL in host memory and shows its origin in the Webview; it does not write the signed URL to task history or logs, and it does not submit a video automatically.

Completed media is downloaded from the HTTPS URL returned by the API. Such URLs may point to third-party storage; requests to them do not carry your Apixly API key. A video without a returned URL can be downloaded through the fixed authenticated Apixly `/videos/{id}/content` route. Redirects are refused on authenticated requests and result downloads. Signed result URLs are processed in memory and never logged by the extension.

## Files, telemetry, and cancellation

Files are saved only after you choose a destination inside a local workspace. Existing files are never overwritten. The extension has no analytics, advertising, telemetry, custom output log, or background requests when idle.

Cancelling or timing out polling stops local waiting only. The upstream job may continue and incur charges. Failed or ambiguous submissions are never automatically repeated. Check your Apixly activity before manually submitting again.

Contact: [support@apixly.ai](mailto:support@apixly.ai).
