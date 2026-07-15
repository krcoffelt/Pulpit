import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import OpenAI from "openai";
import type { AspectRatio, CaptionPreset, CaptionPosition, ClipSuggestion, FrameMode, TranscriptSegment } from "./types";

const execFileAsync = promisify(execFile);

function requireBinary(binary: string | null | undefined, name: string) {
  if (!binary) throw new Error(`${name} binary is unavailable on this platform.`);
  return binary;
}

async function run(binary: string, args: string[]) {
  return execFileAsync(binary, args, { maxBuffer: 20 * 1024 * 1024 });
}

export async function getDuration(inputPath: string) {
  const binary = requireBinary(ffprobeStatic.path, "FFprobe");
  const { stdout } = await run(binary, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration)) throw new Error("Could not read the video duration.");
  return duration;
}

export async function transcribeSermon(inputPath: string, openai: OpenAI) {
  const binary = requireBinary(ffmpegPath, "FFmpeg");
  const workDir = await mkdtemp(path.join(tmpdir(), "pulpit-audio-"));

  try {
    const chunkPattern = path.join(workDir, "chunk-%03d.mp3");
    await run(binary, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inputPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
      "-f", "segment", "-segment_time", "600", "-reset_timestamps", "1",
      chunkPattern,
    ]);

    const chunks = (await readdir(workDir)).filter((file) => file.endsWith(".mp3")).sort();
    if (!chunks.length) throw new Error("No speech track was found in this file.");

    const segments: TranscriptSegment[] = [];
    let offset = 0;

    for (const [chunkIndex, chunkName] of chunks.entries()) {
      const chunkPath = path.join(workDir, chunkName);
      const chunkDuration = await getDuration(chunkPath);
      const transcript = await openai.audio.transcriptions.create({
        file: createReadStream(chunkPath),
        model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize",
        response_format: "diarized_json",
        chunking_strategy: "auto",
      });

      const response = transcript as unknown as {
        text?: string;
        segments?: Array<{ start: number; end: number; text: string; speaker?: string }>;
      };

      if (response.segments?.length) {
        response.segments.forEach((segment, segmentIndex) => {
          if (!segment.text.trim()) return;
          segments.push({
            id: `s-${chunkIndex}-${segmentIndex}`,
            start: offset + Number(segment.start),
            end: offset + Number(segment.end),
            text: segment.text.trim(),
            speaker: segment.speaker || "Speaker",
          });
        });
      } else if (response.text?.trim()) {
        segments.push({
          id: `s-${chunkIndex}-0`,
          start: offset,
          end: offset + chunkDuration,
          text: response.text.trim(),
          speaker: "Speaker",
        });
      }

      offset += chunkDuration;
    }

    return segments;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function fallbackClips(segments: TranscriptSegment[]): ClipSuggestion[] {
  if (!segments.length) return [];
  const candidates: ClipSuggestion[] = [];

  for (let index = 0; index < segments.length && candidates.length < 6; index += Math.max(1, Math.floor(segments.length / 8))) {
    const start = segments[index].start;
    let endIndex = index;
    while (endIndex < segments.length - 1 && segments[endIndex].end - start < 24) endIndex += 1;
    const chosen = segments.slice(index, endIndex + 1);
    const text = chosen.map((segment) => segment.text).join(" ");
    if (text.split(/\s+/).length < 12) continue;
    candidates.push({
      id: `clip-${candidates.length + 1}`,
      title: text.split(/\s+/).slice(0, 7).join(" ").replace(/[.,!?]$/, ""),
      start,
      end: Math.min(chosen.at(-1)?.end || start + 30, start + 60),
      hook: chosen[0].text,
      score: 82 - candidates.length * 3,
      reason: "A complete, self-contained section with clear spoken context.",
      platform: "Reels · Shorts",
    });
  }
  return candidates;
}

export async function findBestClips(segments: TranscriptSegment[], openai: OpenAI) {
  if (!segments.length) return [];
  const transcript = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join("\n");

  const response = await openai.responses.create({
    model: process.env.OPENAI_ANALYSIS_MODEL || "gpt-5.6-luna",
    reasoning: { effort: "low" },
    input: [
      {
        role: "system",
        content: "You are a senior short-form video editor specializing in sermons. Find emotionally complete moments with an immediate hook, clear context, and a satisfying landing. Never invent words or timestamps. Favor clips between 15 and 45 seconds; never exceed 60 seconds.",
      },
      {
        role: "user",
        content: `Select the six strongest social clips from this timestamped transcript. Return title, exact start/end timestamps, spoken hook, score from 1-100, why it works, and recommended platform.\n\n${transcript}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "sermon_clips",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["clips"],
          properties: {
            clips: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "start", "end", "hook", "score", "reason", "platform"],
                properties: {
                  title: { type: "string" },
                  start: { type: "number" },
                  end: { type: "number" },
                  hook: { type: "string" },
                  score: { type: "number" },
                  reason: { type: "string" },
                  platform: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  });

  try {
    const parsed = JSON.parse(response.output_text) as { clips: Omit<ClipSuggestion, "id">[] };
    return parsed.clips
      .filter((clip) => clip.end > clip.start && clip.start >= 0)
      .map((clip, index) => ({
        ...clip,
        id: `clip-${index + 1}`,
        end: Math.min(clip.end, clip.start + 60),
        score: Math.max(1, Math.min(100, Math.round(clip.score))),
      }));
  } catch {
    return fallbackClips(segments);
  }
}

function assTimestamp(seconds: number) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe % 1) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAss(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\n/g, "\\N");
}

function captionLines(text: string, preset: CaptionPreset, highlight: boolean, wordsPerLine = 5) {
  const source = preset === "bold" ? text.toUpperCase() : text;
  const words = source.trim().split(/\s+/);
  const highlightStart = highlight ? Math.max(1, words.length - 2) : words.length;
  return words.map((word, index) => {
    const lineBreak = index > 0 && index % wordsPerLine === 0 ? "\\N" : index > 0 ? " " : "";
    const color = index === highlightStart ? "{\\c&H001F5AFF&}" : "";
    return `${lineBreak}${color}${escapeAss(word)}`;
  }).join("");
}

interface RenderClipOptions {
  sourcePath: string;
  outputPath: string;
  subtitlePath: string;
  start: number;
  end: number;
  aspect: AspectRatio;
  captionPreset: CaptionPreset;
  captionPosition: CaptionPosition;
  captionScale: number;
  captionsEnabled: boolean;
  highlight: boolean;
  frameMode: FrameMode;
  transcript: TranscriptSegment[];
}

export async function renderClip(options: RenderClipOptions) {
  const binary = requireBinary(ffmpegPath, "FFmpeg");
  const sizes: Record<AspectRatio, [number, number]> = {
    "9:16": [1080, 1920],
    "4:5": [1080, 1350],
    "1:1": [1080, 1080],
  };
  const [width, height] = sizes[options.aspect];
  const fontSize = Math.round((options.captionPreset === "bold" ? 74 : options.captionPreset === "clean" ? 60 : 52) * options.captionScale);
  const marginV = options.captionPosition === "middle" ? Math.round(height * 0.38) : Math.round(height * 0.12);
  const outline = options.captionPreset === "minimal" ? 1 : 5;
  const backColor = options.captionPreset === "clean" ? "&H99000000" : "&H00000000";
  const borderStyle = options.captionPreset === "clean" ? 3 : 1;
  const primary = "&H00FFFFFF";

  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Arial,${fontSize},${primary},&H00FFFFFF,&H00000000,${backColor},-1,0,0,0,100,100,0,0,${borderStyle},${outline},1,2,70,70,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const events = options.transcript
    .filter((segment) => segment.end > options.start && segment.start < options.end)
    .flatMap((segment) => {
      const words = segment.text.trim().split(/\s+/);
      const cueSize = 8;
      const segmentDuration = Math.max(0.2, segment.end - segment.start);
      const cues: string[] = [];
      for (let index = 0; index < words.length; index += cueSize) {
        const cueStartAbsolute = segment.start + segmentDuration * (index / words.length);
        const cueEndAbsolute = segment.start + segmentDuration * (Math.min(words.length, index + cueSize) / words.length);
        if (cueEndAbsolute <= options.start || cueStartAbsolute >= options.end) continue;
        const start = Math.max(0, cueStartAbsolute - options.start);
        const end = Math.min(options.end - options.start, cueEndAbsolute - options.start);
        const cueText = words.slice(index, index + cueSize).join(" ");
        cues.push(`Dialogue: 0,${assTimestamp(start)},${assTimestamp(end)},Caption,,0,0,0,,${captionLines(cueText, options.captionPreset, options.highlight)}`);
      }
      return cues;
    })
    .join("\n");
  await writeFile(options.subtitlePath, header + events, "utf8");

  const escapedSubtitles = options.subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const captionFilter = options.captionsEnabled ? `,ass='${escapedSubtitles}'` : "";
  let filter: string;

  if (options.frameMode === "fit") {
    filter = `[0:v]split=2[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=32[back];[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[front];[back][front]overlay=(W-w)/2:(H-h)/2${captionFilter}[v]`;
  } else {
    filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${captionFilter}[v]`;
  }

  await run(binary, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(options.start), "-i", options.sourcePath,
    "-t", String(Math.max(0.5, options.end - options.start)),
    "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-r", "30", "-movflags", "+faststart", options.outputPath,
  ]);

  return readFile(options.outputPath);
}

export async function withTempUpload<T>(file: File, prefix: string, callback: (context: { dir: string; sourcePath: string }) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  const extension = path.extname(file.name) || ".mp4";
  const sourcePath = path.join(dir, `source${extension}`);
  try {
    await writeFile(sourcePath, Buffer.from(await file.arrayBuffer()));
    return await callback({ dir, sourcePath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
