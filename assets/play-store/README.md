# Play Store graphics (source)

## Files
- `icon-512.png` — **512×512** app icon (no transparency)
- `feature-graphic-1024x500.png` — **1024×500** feature graphic (final listing art)

## Regenerate
```bash
node scripts/make-icons.js
node scripts/make-feature-graphic.js
```

`make-feature-graphic.js` builds the final banner (no testing badges). Optional atmosphere source:
`_agent/play-store/feature-graphic-bg.png`
