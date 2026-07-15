# Circumvision production runbook

## Required Netlify setup

1. Link the repository `krcoffelt/Pulpit` to the production site.
2. In **Project configuration → Identity**, enable Netlify Identity.
3. Set registration to **Invite only**. Do not enable open signup.
4. Invite Tyshone Roland's email, then use the invite link to set the initial password.
5. Add `OPENAI_API_KEY` as a secret environment variable for the Production deploy context.
6. Set `NEXT_PUBLIC_APP_URL=https://circumvision.netlify.app` (or the final custom domain).
7. Keep the model defaults from `.env.example` unless a tested migration deliberately changes them.

The application denies project, media, processing, and export access unless the Netlify Identity JWT belongs to the project owner. Local development intentionally uses one isolated `local-user` account.

## Media architecture

- The browser sends 3 MB resumable sections, below Netlify's binary request ceiling.
- Project records, original source sections, transcript checkpoints, editor state, and exports are persisted in Netlify Blobs with strong consistency.
- Production analysis and rendering run in token-protected Netlify background functions rather than a browser-held request.
- Each transcript section is checkpointed. If a background function stops, reopening a stale/failed project retries from the first unfinished section.
- Rendering assembles the retained source inside the background function. Exporting another ratio never asks for the source again.
- Finished files are downloaded through authenticated 3 MB byte ranges, avoiding response-size ceilings.
- Production data uses the `circumvision` Blob store. Branch/deploy previews use isolated stores and cannot mutate production sermons.

Netlify background functions have a finite execution window. The current three-minute audio segmentation is designed for the required 35–40 minute sermons and retries safely from checkpoints. If actual sermons regularly exceed that window, point the existing project/storage/job interfaces at a long-running media worker (for example, a container queue worker) rather than moving FFmpeg back into synchronous web requests.

For that external-worker mode, set `CIRCUMVISION_WORKER_URL` and `CIRCUMVISION_WORKER_TOKEN` in the web app. The worker accepts authenticated `POST /v1/jobs/process` and `POST /v1/jobs/render` payloads, then calls `runProcessJob` or `runRenderJob` from this repository. Give the worker `CIRCUMVISION_BLOB_SITE_ID` and a scoped `CIRCUMVISION_BLOB_TOKEN` so the same storage adapter reads the production `circumvision` store. The payload contains only opaque project/export IDs and one-time job tokens; source media stays in Blob storage. These four credentials are required only when moving media execution off Netlify.

## Operations

- `GET /api/health` performs a real persistence round trip and reports degraded status when AI configuration is missing.
- Every failure response is JSON and includes a request ID. Background and API logs use structured metadata without transcript or sermon body content.
- A daily scheduled function marks abandoned jobs retryable, removes expired rate buckets, and deletes failed/cancelled or abandoned-upload projects according to the documented retention variables.
- Successful project source media and exports remain until the owner deletes the project. The workspace enforces a 5 GB quota and 100-project limit.
- Upload, processing, suggestion, and export creation endpoints are authenticated, owner-scoped, rate-limited, origin-checked, and validated.

## Verification before release

```bash
npm ci
npm run verify
npx playwright install chromium
npm run test:e2e
npx netlify build
```

After deployment:

1. Open `/api/health` and confirm `status: ok`, `persistence: ok`, and `storage: durable`.
2. Sign in through an invited account.
3. Upload a small MP4 and confirm analysis, editing, all three ratios, and download.
4. Upload the 119 MB iPhone MOV and confirm progress, pause/resume, refresh, captions, and H.264/AAC output.
5. Run the 200+ MB / 35–40 minute sermon and confirm transcript checkpoints and non-overlapping suggestions.
6. Test MP3 or WAV input and confirm the branded audio-only visual.
7. Check desktop and mobile widths, browser console, Netlify function logs, and Blob storage usage.

## Security maintenance

`npm audit` currently reports only moderate transitive advisories in Netlify/OpenTelemetry and Next/PostCSS dependency trees. Do not use `npm audit fix --force`: its proposed versions are breaking downgrades. Recheck on every dependency update and apply compatible upstream fixes when released.
