# Visual assets

The README artwork uses Apixly's existing brand mark and the same dark, electric-blue palette as Media Studio. Decorative artwork is identified separately from native interface captures below.

## Files

- `media/hero.png`: raster rendering of the native vector cover in `media/source/hero.svg`. Its glass media stack is decorative artwork.
- `media/social-preview.png`: a 1280 × 640 version for the GitHub repository's social preview; the source is `media/source/social-preview.svg`. It is excluded from the VSIX.
- `media/workflow.png`: raster rendering of `media/source/workflow.svg`; contains actual acceptance media plus a labeled recovery diagram.
- `media/studio-preview.png`: original unedited native VS Code compositor capture of Media Studio with a finished reference video.
- `media/creative-preview.png`: unedited native VS Code capture of the 0.2.0 camera/lens controls. It shows locally selected creative instructions with no connected account or generation output.

The SVG sources are standalone, with embedded image bytes and no external resource loads. PNGs were rendered with Sharp 0.35.5 and visually reviewed. README references use PNG because [VS Code Marketplace does not allow arbitrary SVG images in extension READMEs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publishing-extensions). SVG sources and this provenance document are excluded from the VSIX.

## Real media in the workflow gallery

Samples were produced during release acceptance on October 23, 2026. The gallery preserves each image's aspect ratio, with no retouching or content replacement. The video is represented by an extracted frame, not a simulated player.

| Sample | Exact model | Dimensions | Source SHA256 |
| --- | --- | --- | --- |
| Generated image | `grok-imagine-image` | 960 × 960 | `af90fac072a7d79d07394c51b3a349fe6c526285d24f0247316416ec0a3fbff0` |
| Single-reference edit | `gemini-3.1-flash-image` | 1024 × 1024 | `0ed9295efec8e1c96a708c234745658612512400332ab12245de47c311c5b4a1` |
| Two-reference edit | `gemini-3.1-flash-image` | 1024 × 1024 | `b3197569fa1ef797c7caaf2df9ba819c0314307cebb46480e1e1e23534bfca34` |
| Video frame at 0.5 seconds | `grok-imagine-video` | 1280 × 720 | `59eca87f5988ca66749658ce3edc4332ab8a8dfd0ea87939dca59f915ceb3a17` |

The first sample was edited from red to blue with one reference. The multi-reference sample combines those two reference images. The mountain-lake frame comes from a separate text-video sample. These examples show bounded acceptance results, not guarantees for every prompt or model.

The recovery strip is a conceptual sequence: keep a task ID → resume the existing task → preview and save. It is not a screenshot. Actual task recovery, local cancellation, previews, and saves were separately exercised in official VS Code.

Masked editing remains unavailable. Reference-video framing follows the input image; the native screenshot shows actual decoded dimensions. The artwork introduces no stronger model claims.

## Creative controls capture

`media/creative-preview.png` was captured directly from official VS Code 1.143.1 on macOS on October 23, 2026, using runtime source `c5eaf1a47f64b62c3b1c56a7ab6be04cd7638c72`. The later `2dd4ab2` commit adds tests only. No pixel edits, cropping, generated interface elements, or content replacement were applied. Its dimensions are 2880 × 1910 and its SHA256 is `5f3e9866fddf6e17dbecf112b6d5f15403ba9330fdc73a1e52c4e13947d8da5a`. The image contains no API key, connection token, account identity, private file path, task ID or diagnostic attack prompt.
