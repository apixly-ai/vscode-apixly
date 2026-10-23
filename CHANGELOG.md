# Changelog

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
