# Blyp canonical brand (admin)

## Source of truth

Locked from tip / mobile (`Blyp26-frenemies-ea-v1`):

| Use | Path |
|-----|------|
| App header wordmark | `src/components/BlypLogo.js` (lowercase **blyp** + `#00D2BE` pulse) |
| Launcher / Play tile | `assets/icon.png`, `assets/adaptive-icon.png` |
| SVG wordmark (light on dark) | `assets/brand/blyp-logo-transparent-light.svg` → `blyp-logo-wordmark.svg` |
| SVG app tile | `assets/brand/blyp-app-tile.svg` |
| Raster tile | `assets/brand/blyp-app-tile-512.png` |

Web corporate chrome on **blyp.world** uses the same mark (Syne display + teal pulse) in `apps/blyp-world/components/SiteChrome.tsx`.

## Admin usage

- Sidebar / login: `BlypWordmark` component (not a capital-B teal pill, not Vite purple).
- Favicon: `/favicon.png` (app tile) + `/favicon.svg` (same mark).

Do not invent alternate logos for admin surfaces.
