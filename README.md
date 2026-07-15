# Circumvision

Circumvision is a local-first sermon clip editor built for Tyshone Roland. Upload a full sermon, generate a speaker-aware transcript, surface the strongest short-form moments, format them for social platforms, burn in captions, and export finished MP4 files.

## What works

- Video and audio ingest for MP4, MOV, WebM, MP3, M4A, and WAV files
- Hosting-safe multipart uploads that keep large videos below serverless request limits
- Automatic audio extraction and compression with bundled FFmpeg
- Long-sermon chunking before transcription
- Speaker-aware, timestamped transcription with OpenAI
- AI-ranked clip suggestions with editable start and end times
- 9:16 YouTube Shorts / Reels exports at 1080×1920
- 4:5 Instagram feed exports at 1080×1350
- 1:1 square exports at 1080×1080
- Fill-crop and full-frame blurred-background modes
- Bold, clean, and minimal burned-in caption styles
- Responsive editor with a built-in sample project

## Run it

Requirements: Node.js 20+ and an OpenAI API key. FFmpeg and FFprobe ship with the npm dependencies; no system media tools are required.

```bash
npm install
cp .env.example .env.local
```

Add your key to `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
```

Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click “Explore with a sample sermon” to inspect the editor without a key or source video.

## Workflow

1. Drop in a sermon video or audio file and name the project.
2. Choose **Analyze sermon**. The browser uploads the source in resumable 3 MB sections, then the server extracts a compact mono audio track and splits long recordings into six-minute sections.
3. Each audio section is transcribed in its own timeout-safe request while the interface reports real progress.
4. The clip analyst selects up to six complete moments, favoring a strong opening hook and a clear landing.
5. Pick a moment and adjust the ratio, framing, caption treatment, timing, and transcript range.
6. Choose **Export clip**. The source is rendered into a platform-ready H.264/AAC MP4 with captions burned in.

## Configuration

```bash
OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
OPENAI_ANALYSIS_MODEL=gpt-5.6-luna
```

The defaults favor accurate speaker timing for transcription and a cost-conscious reasoning model for clip selection.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
```

## Production note

In local development, job data uses an isolated temporary directory. On Netlify, upload parts, audio sections, and manifests use site-scoped Netlify Blobs so separate function invocations share the same job. Source upload parts are removed after audio extraction, audio sections are removed after transcription, and completed, cancelled, or 24-hour-old jobs are cleaned up automatically.

Before opening the app to multiple users, add authentication, per-user project records, upload quotas, rate limiting, and a durable background queue for very long media jobs. OpenAI keys must remain server-side and must never be added to browser code or committed to git.
