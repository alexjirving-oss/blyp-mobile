# Blyp social-import worker

Fulfils the in-app **"Bring your content"** feature. The app (Profile → *Bring your
content (TikTok)*, or the sign-up step) writes a `pending` doc to the
`socialImports` Firestore collection. This worker turns those requests into real
posts on the requester's profile.

## What it does
1. Claims the oldest `pending` request (transaction → `running`).
2. Downloads the requester's public TikTok/YouTube videos with `yt-dlp`.
3. Uploads each video + thumbnail to Firebase Storage.
4. Creates a `posts` doc per video. **By default** posts are
   `publishStatus=scheduled` with a staggered `publishAt` (N/day + jitter) so
   a large import does not dump everything live at once. Set
   `STAGGER_FORCE_OFF=1` or `stagger.enabled=false` on the job for instant live.
5. Streams `total` / `done` / `scheduled` / `status` back onto the request doc.
6. A separate **publish sweeper** flips due posts to `live`:
   - `node tools/import/blyp_publish_sweeper.js`, or
   - Cloud Function `blypScheduledPublishSweep` (every 5 minutes).

## Stagger defaults (everyone)
| Setting | Default | Cap (user) | Cap (admin job) |
| --- | --- | --- | --- |
| enabled | on | — | — |
| postsPerDay | 3 | 12 | 48 |
| jitter | ~15m | 30m | 2h |
| min interval | derived | 30m | 5m |

## Prerequisites
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and `ffmpeg` on your `PATH`.
- Admin credentials, either:
  - `GOOGLE_APPLICATION_CREDENTIALS=<path to service-account.json>`, or
  - `gcloud auth application-default login`.
- Node 18+ (uses global `fetch`).

## Run
```bash
# from repo root — import ingest
node tools/import/blyp_import_worker.js

# publish due scheduled posts (run alongside ingest if CF not deployed)
node tools/import/blyp_publish_sweeper.js
```

Useful env vars:

| Var | Default | Meaning |
| --- | --- | --- |
| `PROJECT_ID` | `blyp-master` | Firebase project |
| `STORAGE_BUCKET` | `blyp-master.firebasestorage.app` | Storage bucket |
| `POLL_MS` | `5000` | How often to poll for new jobs |
| `MAX_VIDEOS` | `1000` | Limit videos per import |
| `ONCE` | unset | Set `ONCE=1` to process one job then exit |
| `STAGGER_FORCE_OFF` | unset | Publish live immediately (ignore job.stagger) |

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
# Canonical prod region (us-central1). BOTH flags below are mandatory:
# without them Cloud Run scales to zero after the health check and every
# in-app import sits forever on "Queued — starting shortly…".
gcloud run deploy blyp-import-worker \
  --source tools/import \
  --project blyp-master \
  --region us-central1 \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --no-cpu-throttling \
  --memory 1Gi \
  --max-instances 1

# Or update an existing revision without rebuilding:
gcloud run services update blyp-import-worker \
  --project blyp-master \
  --region us-central1 \
  --min-instances 1 \
  --no-cpu-throttling \
  --max-instances 1
```
On Cloud Run the worker uses the service's runtime service account (give it
Firestore + Storage admin), so no key file is needed. `--min-instances 1` keeps
the poller alive; `--no-cpu-throttling` allocates CPU between HTTP requests
so the Firestore poll loop actually runs.

**Prod check:** if imports stick on `pending`, describe the service and confirm
`autoscaling.knative.dev/minScale=1` and `run.googleapis.com/cpu-throttling=false`.
A cold standby in another region is fine at minScale 0; do **not** run two
always-on pollers unless you want double cost (claim is transactional either way).

## Notes
- Posture: this imports a user's **own** public content onto their **own**
  profile after an in-app ownership attestation. Music-licensing / ToS caveats
  for re-hosting are documented in chat; verified-import (ID + phone) and fraud
  flagging are planned follow-ups.
