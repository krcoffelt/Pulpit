# Circumvision

Circumvision is Tyshone Roland's sermon-to-short-form production workspace. It keeps the original sermon, creates a speaker-aware transcript, finds strong faithful moments, lets the editor correct copy and framing, and renders downloadable social MP4s.

AI clip selection uses GPT-6 Luna for first-pass candidates and GPT-6.1 Sol for final editorial review against the full transcript. Speaker-aware audio transcription uses GPT-4o Transcribe Diarize; FFmpeg renders the finished videos. Override the text models with `OPENAI_CANDIDATE_MODEL` and `OPENAI_ANALYSIS_MODEL`.

## Production workflow

- Immediate access with no login, email, or account required in one shared workspace
- MP4, MOV, WebM, MP3, M4A, and WAV ingest up to 2 GB
- Retriable 3 MB section uploads with exact progress, pause, resume, and validation
- Durable project, source, transcript, edit, job, and export persistence
- Background audio preparation, three-minute diarized transcript checkpoints, clip selection, and FFmpeg rendering
- Worker-only ranged source streaming so large sermons are processed without copying the full upload to ephemeral disk
- Transcript checkpoints and safe retries after refreshes or function restarts
- Clip scoring for hook, impact, clarity, completeness, faithfulness, and shareability
- Duplicate/overlap removal and editable 15, 30, 45, or 60 second moments
- Transcript correction, clip-boundary editing, manual clips, and suggestion regeneration without retranscription
- Manual framing plus crop-fill or blurred full-frame output
- Editable caption style, size, position, highlight, and enable/disable controls
- H.264/AAC exports for 9:16 (1080×1920), 4:5 (1080×1350), and 1:1 (1080×1080)
- Range downloads that stay within serverless response limits
- Project dashboard, autosave, return-later workflow, quota/rate limits, cancellation, cleanup, health checks, and structured logs

## Local development

Requirements: Node.js 20+ and an OpenAI API key. Bundled FFmpeg and FFprobe binaries are used; no system media installation is required.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add `OPENAI_API_KEY` to `.env.local`, then open [http://localhost:3000](http://localhost:3000). The shared workspace opens immediately with no login or email required. The sample sermon opens the editor without invoking AI.

## Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
npm run verify
```

The render integration test produces and probes real H.264/AAC output for all ratios and audio-only input. Media tests verify authenticated HTTP range probing and extraction without full-file staging. Browser tests cover desktop/mobile layout, persisted section uploads, pause/resume state, health responses, mutation-origin protection, and readable API failures.

## Production

Deployment uses Next.js on Netlify, Netlify Blobs, an open shared workspace, and token-protected background functions. Source media is retained so rerenders never require another upload. Preview deploys use isolated Blob stores.

See [PRODUCTION.md](./PRODUCTION.md) for environment variables, architecture, cleanup, security notes, and the release smoke-test checklist.
