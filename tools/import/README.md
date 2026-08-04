# Blyp social-import worker

Fulfils the in-app **"Bring your content"** feature. The app (Profile → *Bring your
content (TikTok)*, or the sign-up step) writes a `pending` doc to the
`socialImports` Firestore collection. This worker turns those requests into real
posts on the requester's profile.

## What it does
1. Claims the oldest `pending` request (transaction → `running`).
2. Downloads the requester's public TikTok videos with `yt-dlp`.
3. Uploads each video + thumbnail to Firebase Storage.
4. Creates a `posts` doc per video on the requester's profile (same schema the
   seed scripts use), with caption, hashtags, inferred category and the original
   TikTok date. Idempotent — already-imported `sourceId`s are skipped.
5. Streams `total` / `done` / `status` back onto the request doc so the app shows
   live progress, then marks it `done`.

## Prerequisites
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and `ffmpeg` on your `PATH`.
- Admin credentials, either:
  - `GOOGLE_APPLICATION_CREDENTIALS=<path to service-account.json>`, or
  - `gcloud auth application-default login`.
- Node 18+ (uses global `fetch`).

## Run
```bash
# from repo root
node tools/import/blyp_import_worker.js
```

Useful env vars:

| Var | Default | Meaning |
| --- | --- | --- |
| `PROJECT_ID` | `blyp-master` | Firebase project |
| `STORAGE_BUCKET` | `blyp-master.firebasestorage.app` | Storage bucket |
| `POLL_MS` | `5000` | How often to poll for new jobs |
| `MAX_VIDEOS` | `0` (no cap) | Limit videos per import (testing) |
| `ONCE` | unset | Set `ONCE=1` to process one job then exit |

## Run hands-free (container)

The worker is a standalone poller (not a Cloud Function) because it shells out to
`yt-dlp` and needs disk. A `Dockerfile` is included so it runs anywhere with one
command — no code changes needed.

```bash
# Build the image (bundles node + ffmpeg + yt-dlp)
docker build -t blyp-import-worker tools/import

# Run on any always-on host (your PC, a VM, etc.)
docker run -d --restart unless-stopped \
  -e PROJECT_ID=blyp-master \
  -e GOOGLE_APPLICATION_CREDENTIALS=/svc/sa.json \
  -v /abs/path/service-account.json:/svc/sa.json:ro \
  blyp-import-worker
```

### Fully-managed (Google Cloud Run)
```bash
gcloud run deploy blyp-import-worker \
  --source tools/import \
  --project blyp-master \
  --region europe-west2 \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --no-cpu-throttling \
  --memory 1Gi
```
On Cloud Run the worker uses the service's runtime service account (give it
Firestore + Storage admin), so no key file is needed. `--min-instances 1` keeps
the poller alive; `--no-cpu-throttling` lets it work between requests.

> Decision needed before this goes live in production: where to host (their PC /
> a VM / Cloud Run) and which service account/credentials to use. Everything
> above is ready; it just needs a `docker`/`gcloud` run with real credentials.

## Notes
- Posture: this imports a user's **own** public content onto their **own**
  profile after an in-app ownership attestation. Music-licensing / ToS caveats
  for re-hosting are documented in chat; verified-import (ID + phone) and fraud
  flagging are planned follow-ups.
