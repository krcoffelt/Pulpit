# Circumvision

Circumvision is a local-first sermon clip editor built for Tyshone Roland. Upload a full sermon, generate a speaker-aware transcript, surface the strongest short-form moments, format them for social platforms, burn in captions, and export finished MP4 files.

## What works

- Video and audio ingest for MP4, MOV, WebM, MP3, M4A, and WAV files
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
2. Choose **Analyze sermon**. The server extracts a compact mono audio track, splits long recordings into safe chunks, and transcribes each chunk.
3. The clip analyst selects up to six complete moments, favoring a strong opening hook and a clear landing.
4. Pick a moment and adjust the ratio, framing, caption treatment, timing, and transcript range.
5. Choose **Export clip**. The source is rendered into a platform-ready H.264/AAC MP4 with captions burned in.

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

This build is deliberately local-first: uploaded source files are written to an isolated temporary directory, processed, returned, and deleted. That makes it immediately usable on one machine without accounts, a database, or cloud storage.

For a hosted multi-user deployment, keep the interface and media pipeline but replace request-sized uploads with direct object-storage uploads and run analysis/rendering in durable background jobs. Add authentication, a project database, signed asset URLs, job progress, retries, and lifecycle cleanup before exposing it publicly. OpenAI keys must remain server-side and must never be added to browser code or committed to git.
