# Blyp admin console

Vite + React admin UI for `blyp-live-service` admin APIs. Deployed to Netlify (`admin.blyp.world`).

## Commands

```bash
npm ci
npm run lint
npm run build
npm run dev
```

## Deploy

`netlify.toml` uses relative `base` / `publish` paths (no machine-absolute paths).

Auth: password `/admin/auth/login` is disabled in production. Prefer Cognito allowlisted sessions against the live API once the console login path is switched to Bearer tokens.
