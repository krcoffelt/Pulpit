# Circumvision production runbook

## Required Netlify setup

1. Link the repository `krcoffelt/Pulpit` to the production site.
2. Add `OPENAI_API_KEY` as a secret environment variable for the Production deploy context.
3. Set `NEXT_PUBLIC_APP_URL=https://circumvision.netlify.app` (or the final custom domain).
4. Keep the model defaults from `.env.example` unless a tested migration deliberately changes them.

Netlify Identity is not used. Entering any syntactically valid email immediately creates a one-year, HTTP-only browser cookie; no password, invitation, verification message, or email callback exists. Every admitted email opens the same shared workspace, including projects created under earlier Identity owner IDs.

This flow prioritizes convenience over identity verification. Anyone who can reach the public site can enter an email and access, modify, download, or delete shared projects. The cookie gates accidental unauthenticated requests but is not proof of identity. Reintroduce verified authentication before storing media that should not be publicly accessible to site visitors.

## Media architecture

- The browser sends 3 MB resumable sections, below Netlify's binary request ceiling.
- Project records, original source sections, transcript checkpoints, editor state, and exports are persisted in Netlify Blobs with strong consistency.
- Production analysis and rendering run in token-protected Netlify background functions rather than a browser-held request.
- Each transcript section is checkpointed. If a background function stops, reopening a stale/failed project retries from the first unfinished section.
- Processing and rendering stream authenticated byte ranges from the retained source directly into FFprobe/FFmpeg. Large videos do not consume the function's temporary disk, and exporting another ratio never asks for the source again.
- Finished files are downloaded through session-gated 3 MB byte ranges, avoiding response-size ceilings.
- Production data uses the `circumvision` Blob store. Branch/deploy previews use isolated stores and cannot mutate production sermons.

Netlify background functions have a finite execution window. The current three-minute audio segmentation is designed for the required 35–40 minute sermons and retries safely from checkpoints. If actual sermons regularly exceed that window, point the existing project/storage/job interfaces at a long-running media worker (for example, a container queue worker) rather than moving FFmpeg back into synchronous web requests.

For that external-worker mode, set `CIRCUMVISION_WORKER_URL` and `CIRCUMVISION_WORKER_TOKEN` in the web app. The worker accepts authenticated `POST /v1/jobs/process` and `POST /v1/jobs/render` payloads, then calls `runProcessJob` or `runRenderJob` from this repository. Give the worker `CIRCUMVISION_BLOB_SITE_ID` and a scoped `CIRCUMVISION_BLOB_TOKEN` so the same storage adapter reads the production `circumvision` store. The payload contains only opaque project/export IDs and one-time job tokens; source media stays in Blob storage. These four credentials are required only when moving media execution off Netlify.

## Operations

- `GET /api/health` performs a real persistence round trip and reports degraded status when AI configuration is missing.
- Every failure response is JSON and includes a request ID. Background and API logs use structured metadata without transcript or sermon body content.
- A daily scheduled function marks abandoned jobs retryable, removes expired rate buckets, and deletes failed/cancelled or abandoned-upload projects according to the documented retention variables.
- Successful project source media and exports remain until the owner deletes the project. The workspace enforces a 5 GB quota and 100-project limit.
- Upload, processing, suggestion, and export creation endpoints require the remembered workspace cookie and remain rate-limited, origin-checked, and validated.

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
2. Enter any valid email, confirm no email is sent, refresh, and confirm the remembered session opens immediately.
3. Upload a small MP4 and confirm analysis, editing, all three ratios, and download.
4. Upload the 119 MB iPhone MOV and confirm progress, pause/resume, refresh, captions, and H.264/AAC output.
5. Run the 200+ MB / 35–40 minute sermon and confirm transcript checkpoints and non-overlapping suggestions.
6. Test MP3 or WAV input and confirm the branded audio-only visual.
7. Check desktop and mobile widths, browser console, Netlify function logs, and Blob storage usage.

## Security maintenance

`npm audit` currently reports only moderate transitive advisories in Netlify/OpenTelemetry and Next/PostCSS dependency trees. Do not use `npm audit fix --force`: its proposed versions are breaking downgrades. Recheck on every dependency update and apply compatible upstream fixes when released.
