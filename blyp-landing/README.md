# Blyp Live – Landing Page

This is a simple static landing page for **Blyp**, the short video & live streaming app.

- Domain: https://blyplive.com
- Entry file: `index.html`
- Assets: `assets/`

## Design Notes

The landing page uses colors synced from the Blyp mobile app's theme:
- **Primary**: `#a855f7` (purple)
- **Accent**: `#ec4899` (pink)
- **Background**: `#0f172a` (dark slate)
- **Muted text**: `#94a3b8` (light slate)

These match exactly with the app's brand colors defined in `src/styles/theme.js`.

## Local Preview

You can open `index.html` directly in a browser, or use the VS Code Live Server extension
to run a local web server for better testing.

## Deployment

This site can be deployed to any static host (Netlify, Vercel, GitHub Pages, etc.).
Once deployed, point the `blyplive.com` DNS records at the hosting provider.

### Quick Deploy Instructions

**Netlify:**
```bash
# Install Netlify CLI globally (one time)
npm install -g netlify-cli

# From the blyp-landing directory:
netlify deploy --prod
```

**Vercel:**
```bash
# Install Vercel CLI globally (one time)
npm install -g vercel

# From the blyp-landing directory:
vercel --prod
```

**GitHub Pages:**
1. Create a new repo or use an existing one
2. Push this folder to the repo
3. Enable GitHub Pages in repo settings, pointing to the main branch

## Assets

The `assets/` folder should contain:
- `screenshot-feed.png` - Main app screenshot for the phone mockup (recommended: 1080x2340px or 9:19.5 aspect ratio)

Replace the placeholder with a real screenshot when available.

## Customization

To update the Play Store link:
- Edit `index.html`
- Find the `<a class="btn btn-primary" href="#playstore">` line
- Replace `#playstore` with your actual Google Play Store URL

To update contact email:
- Find `mailto:hello@blyplive.com`
- Replace with your preferred contact email
