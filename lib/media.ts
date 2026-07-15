import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import OpenAI from "openai";
import type { AspectRatio, CaptionPreset, CaptionPosition, FrameMode, TranscriptSegment } from "./types";

const execFileAsync = promisify(execFile);

function requireBinary(binary: string | null | undefined, name: string) {
  if (!binary) throw new Error(`${name} binary is unavailable on this platform.`);
  return binary;
}

async function run(binary: string, args: string[]) {
  return execFileAsync(binary, args, {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    killSignal: "SIGKILL",
  });
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

export async function hasVideoStream(inputPath: string) {
  const binary = requireBinary(ffprobeStatic.path, "FFprobe");
  const { stdout } = await run(binary, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_type",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  return stdout.trim() === "video";
}

export interface AudioChunk {
  path: string;
  duration: number;
  offset: number;
}

export function splitTimedTranscriptSegment(segment: TranscriptSegment, maxWords = 12) {
  const words = segment.text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords || segment.end - segment.start <= 2) return [segment];
  const groups: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    const sentenceEnd = /[.!?][”"']?$/.test(word);
    if (current.length >= maxWords || (current.length >= 5 && sentenceEnd)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) {
    if (current.length < 4 && groups.length) groups.at(-1)?.push(...current);
    else groups.push(current);
  }
  const duration = Math.max(0.1, segment.end - segment.start);
  let consumedWords = 0;
  return groups.map((group, index) => {
    const start = segment.start + duration * (consumedWords / words.length);
    consumedWords += group.length;
    const end = segment.start + duration * (consumedWords / words.length);
    return { ...segment, id: `${segment.id}-${index}`, start, end, text: group.join(" ") };
  });
}

export async function extractAudioChunks(inputPath: string, workDir: string, segmentSeconds = 180) {
  const binary = requireBinary(ffmpegPath, "FFmpeg");
  const chunkPattern = path.join(workDir, "chunk-%03d.mp3");
  await run(binary, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
    "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1",
    chunkPattern,
  ]);

  const chunkNames = (await readdir(workDir)).filter((file) => file.endsWith(".mp3")).sort();
  if (!chunkNames.length) throw new Error("No speech track was found in this file.");

  const chunks: AudioChunk[] = [];
  let offset = 0;
  for (const chunkName of chunkNames) {
    const chunkPath = path.join(workDir, chunkName);
    const duration = await getDuration(chunkPath);
    chunks.push({ path: chunkPath, duration, offset });
    offset += duration;
  }

  return chunks;
}

export async function transcribeAudioChunk(chunk: AudioChunk, chunkIndex: number, openai: OpenAI) {
  const transcript = await openai.audio.transcriptions.create({
    file: createReadStream(chunk.path),
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize",
    response_format: "diarized_json",
    chunking_strategy: "auto",
  });

  const response = transcript as unknown as {
    text?: string;
    segments?: Array<{ start: number; end: number; text: string; speaker?: string }>;
  };

  if (response.segments?.length) {
    return response.segments.flatMap((segment, segmentIndex) => {
      if (!segment.text.trim()) return [];
      return splitTimedTranscriptSegment({
        id: `s-${chunkIndex}-${segmentIndex}`,
        start: chunk.offset + Number(segment.start),
        end: chunk.offset + Number(segment.end),
        text: segment.text.trim(),
        speaker: segment.speaker || "Speaker",
      } satisfies TranscriptSegment);
    });
  }

  if (response.text?.trim()) {
    return splitTimedTranscriptSegment({
      id: `s-${chunkIndex}-0`,
      start: chunk.offset,
      end: chunk.offset + chunk.duration,
      text: response.text.trim(),
      speaker: "Speaker",
    } satisfies TranscriptSegment);
  }

  return [];
}

export async function transcribeSermon(inputPath: string, openai: OpenAI) {
  const workDir = await mkdtemp(path.join(tmpdir(), "circumvision-audio-"));

  try {
    const chunks = await extractAudioChunks(inputPath, workDir);
    const segments: TranscriptSegment[] = [];
    for (const [chunkIndex, chunk] of chunks.entries()) {
      segments.push(...await transcribeAudioChunk(chunk, chunkIndex, openai));
    }

    return segments;
  } finally {
    await rm(workDir, { recursive: true, force: true });
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
  frameX: number;
  frameY: number;
  transcript: TranscriptSegment[];
  fallbackCaptionText?: string;
  audioOnly?: boolean;
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
    });
  const fallbackCaption = options.fallbackCaptionText?.trim();
  if (options.captionsEnabled && !events.length && fallbackCaption) {
    events.push(`Dialogue: 0,${assTimestamp(0)},${assTimestamp(Math.max(0.5, options.end - options.start))},Caption,,0,0,0,,${captionLines(fallbackCaption, options.captionPreset, options.highlight)}`);
  }
  await writeFile(options.subtitlePath, header + events.join("\n"), "utf8");

  const escapedSubtitles = options.subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const captionFilter = options.captionsEnabled ? `,ass='${escapedSubtitles}'` : "";
  const frameX = Math.max(0, Math.min(1, 0.5 + options.frameX / 200)).toFixed(3);
  const frameY = Math.max(0, Math.min(1, 0.5 + options.frameY / 200)).toFixed(3);
  let filter: string;

  if (options.audioOnly) {
    filter = `color=c=0x111113:s=${width}x${height}:r=30:d=${Math.max(0.5, options.end - options.start)}${captionFilter}[v]`;
  } else if (options.frameMode === "fit") {
    filter = `[0:v]split=2[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='(iw-ow)*${frameX}':y='(ih-oh)*${frameY}',gblur=sigma=32[back];[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[front];[back][front]overlay=x='(W-w)*${frameX}':y='(H-h)*${frameY}'${captionFilter}[v]`;
  } else {
    filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='(iw-ow)*${frameX}':y='(ih-oh)*${frameY}'${captionFilter}[v]`;
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
    await saveUpload(file, sourcePath);
    return await callback({ dir, sourcePath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function saveUpload(file: File, outputPath: string) {
  await file.stream().pipeTo(Writable.toWeb(createWriteStream(outputPath)));
}
