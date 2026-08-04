# Play Store graphics (source)

This folder contains **original SVG sources** you can export to **PNG** for Google Play.

## Files
- `icon-512.svg` → export to **512×512 PNG** (no transparency)
- `feature-graphic-1024x500.svg` → export to **1024×500 PNG**
- `screenshot-frame-template.svg` → optional template to frame **real device screenshots**

## Export (recommended: Inkscape)
1. Install Inkscape: https://inkscape.org/
2. Export icon:
   - Open `icon-512.svg`
   - File → Export
   - Format: PNG
   - Size: 512×512
3. Export feature graphic:
   - Open `feature-graphic-1024x500.svg`
   - File → Export
   - Format: PNG
   - Size: 1024×500

## Export (CLI)
If you have Inkscape installed and on PATH:
- `inkscape assets/play-store/icon-512.svg --export-type=png --export-filename=assets/play-store/icon-512.png`
- `inkscape assets/play-store/feature-graphic-1024x500.svg --export-type=png --export-filename=assets/play-store/feature-graphic-1024x500.png`

## Notes
- Google Play screenshots must be taken from the real app on a real device/emulator.
- Don’t commit keys like `android-service-account.json`.
