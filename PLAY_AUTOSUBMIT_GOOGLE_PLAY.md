# Google Play Auto-Submit (Internal Track) — Blyp

This repo is already configured for EAS auto-submit:
- `eas.json` → `submit.production.android.serviceAccountKeyPath = "./android-service-account.json"`
- `eas.json` → `submit.production.android.track = "production" (draft); use submit profile "internal" for internal testing`

Your next job is to enable Google Play Developer API access and generate the service account JSON key.

## 1) Open the correct Play Console area
You are currently on an **Android developer verification** page (your screenshot URL contains `/developers/<DEVELOPER_ID>/android-developer-verification`). That page is informational and not where API access is configured.

Go to **API access** for the same developer account.

### Fastest path (direct URL)
1. Copy the developer id from your browser URL. In your screenshot it is:
   - `5979146102509566368`
2. Open this URL (replace `<DEVELOPER_ID>` with your id):
   - `https://play.google.com/console/u/0/developers/<DEVELOPER_ID>/api-access`

### UI path
In Play Console (left sidebar):
- **Settings** → **Developer account** → **API access**

If you cannot see **API access** or the direct URL redirects away, it means your current Play Console user does not have the required permissions for developer-account settings. The person with **Account owner/Admin** access must perform the next steps.

## 2) Link a Google Cloud project
On **API access**, find **Google Cloud project**.

1. Click **Link project**.
2. Choose an existing project or create a new one.
3. Confirm it shows as **Linked**.

## 3) Enable the Google Play Android Developer API
Still on the **API access** page, enable the API for the linked project.

What you want to see:
- A linked Cloud project
- The Play Developer API enabled (Play Console typically provides a button or takes you to Cloud Console)

## 4) Create a Service Account in Google Cloud
Open Google Cloud Console for the linked project:
- `https://console.cloud.google.com/iam-admin/serviceaccounts`

1. **Create service account**
   - Name: `eas-play-publisher` (any name is fine)
2. Finish creation (no special Cloud roles are required just to create the key; Play permissions are granted inside Play Console).

## 5) Generate the JSON key (this is the file EAS needs)
In Google Cloud Console:
1. Open the service account you created
2. Go to **Keys**
3. **Add key** → **Create new key** → **JSON**
4. Download the JSON

Place it here (repo root):
- `C:\Users\Alex\Blyp26\android-service-account.json`

Important:
- Do not commit this file (it is already gitignored).
- Keep it private; it grants access to your Play Console.

## 6) Grant Play Console permissions to the service account
Back in Play Console → **API access**:
1. In **Service accounts**, click **Grant access** (or **Add service account**)
2. Select the service account email you created (ends with `iam.gserviceaccount.com`)
3. Grant permissions needed to upload to Internal testing.

Minimum permissions to publish to Internal testing:
- **View app information**
- **Manage releases**

(Anything “financial” is not needed for internal-track uploads.)

## 7) Validate the JSON locally (so EAS can’t fail)
Run:
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-play-service-account.ps1`

You should see: `OK: android-service-account.json looks valid.`

## 8) Run canonical build, then submit
From repo root:
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>`
- `eas submit -p android --latest --profile production --non-interactive`

If you already have a completed build you want to submit:
- `eas submit -p android --latest --profile production --non-interactive`

## 9) Confirm it landed in Google Play Internal testing
Play Console:
- Select your app
- **Testing** → **Internal testing** → **Releases**

You should see a new release created by the service account.

## Required: account deletion link (Google Play)
Google Play requires a public URL that explains how users can request account/data deletion.

This repo includes a ready-to-host page:
- `blyp-landing/delete-account.html`

Host it on your site as:
- `https://blyp.world/delete-account`

Then paste that URL into Play Console wherever it asks for **Data deletion** / **Account deletion** link.
