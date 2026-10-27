# Changelog

## 0.2.2 — 2026-10-27

- Clarify the Apixly AI API identity in the extension title, description and relevant Marketplace search tags.
- Add practical model-access, pricing, account, recovery and privacy FAQ with direct Apixly documentation links.
- Link the maintained ComfyUI and Dify integrations without claiming identical capabilities across hosts.
- Keep generation, account authorization, model selection, local creative controls and project-file behavior unchanged. The release User-Agent follows the package version.

## 0.2.1

- Add **Open authorization page** and **Copy authorization link** beside the current authorization code, with 44-pixel controls that wrap in narrow panels.
- Keep the current approval and polling active when opening the browser fails. Reopening uses the same unexpired authorization page and never creates another connection request.
- Keep authorization URLs in the extension host; cancel, expiry and successful approval disable the old actions.

## 0.2.0

- Connect an existing Apixly account through browser approval and PKCE. Keep only a revocable connection token in SecretStorage; choose the default Studixly Key or another active owned Key.
- Load complete typed model catalogs, including Seedream, with ten-minute stale-while-revalidate caching, explicit refresh and authoritative account Key revisions.
- Isolate late metadata/catalog responses across Key changes and shared SecretStorage updates. Keep temporary failures recoverable without a silent credential or model fallback.
- Reuse Apixly's existing viewpoint presets, eight lighting swatches, orbit markers and camera/lens steppers, with readable narrow-panel layouts and typed hex colors.

- Add optional Viewpoint, Lighting and Lens controls with local direction diagrams, presets and synchronized numeric inputs.
- Show the exact final prompt and provide keyless Copy final prompt with authoritative host recomputation.
- Keep every tool off by default; disabling restores the original prompt exactly and reference edits preserve details not requested to change.
- Reject invalid, forged or overlong creative settings before inference. Controls and previews do not make extra model requests or persist prompt data.
- Synchronize the existing Apixly support User-Agent with the release version; third-party downloads still receive neither that header nor the API key.

## 0.1.2 — 2026-10-23

- Use direct image URLs so Marketplace artwork loads without a GitHub web session.
- Add the public Marketplace installation link to the setup guide.

## 0.1.1 — 2026-10-23

- Add an Apixly brand cover, real image/edit/video gallery, and clearer installation and account links.
- Keep the verified Studio behavior and secure task recovery unchanged.

## 0.1.0 — 2026-10-23

- Add a responsive Media Studio panel with image/video previews, reference selection, task recovery, and secure account setup.
- Link to Apixly's site, model prices, API-key console, usage history, and API docs from the panel.
- Generate images and edit one or more reference images.
- Keep mask/inpainting unavailable after visual qualification failed; reject public mask input before submission.
- Submit text or supported HTTPS-reference videos using exact model IDs and model parameters.
- Check or resume existing image and video tasks without submitting them again.
- Save completed assets to a location you choose inside your local workspace.
- Store API keys in VS Code SecretStorage; keep only task metadata in extension state.
- Stop local polling on cancellation or timeout without claiming to cancel the upstream task.
