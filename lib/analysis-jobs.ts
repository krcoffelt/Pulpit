import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { extractAudioChunks, findBestClips, getDuration, saveUpload, transcribeAudioChunk } from "./media";
import type { AnalysisResult, TranscriptSegment } from "./types";

const JOB_ROOT = path.join(tmpdir(), "circumvision-analysis-jobs");
const JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const JOB_ID_PATTERN = /^job-[a-zA-Z0-9_-]+$/;

interface StoredChunk {
  file: string;
  duration: number;
  offset: number;
}

interface AnalysisJobManifest {
  id: string;
  title: string;
  duration: number;
  createdAt: number;
  chunks: StoredChunk[];
  completedChunks: number[];
  transcript: TranscriptSegment[];
}

function jobDir(jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error("The analysis job identifier is invalid.");
  return path.join(JOB_ROOT, jobId);
}

function manifestPath(jobId: string) {
  return path.join(jobDir(jobId), "manifest.json");
}

async function writeManifest(manifest: AnalysisJobManifest) {
  const target = manifestPath(manifest.id);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), "utf8");
  await rename(temporary, target);
}

async function readManifest(jobId: string) {
  try {
    return JSON.parse(await readFile(manifestPath(jobId), "utf8")) as AnalysisJobManifest;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("This analysis job expired or could not be found. Upload the sermon again.");
    }
    throw error;
  }
}

async function cleanupStaleJobs() {
  await mkdir(JOB_ROOT, { recursive: true });
  const entries = await readdir(JOB_ROOT, { withFileTypes: true });
  const now = Date.now();
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(JOB_ROOT, entry.name);
    const details = await stat(directory).catch(() => null);
    if (details && now - details.mtimeMs > JOB_MAX_AGE_MS) {
      await rm(directory, { recursive: true, force: true });
    }
  }));
}

export async function createAnalysisJob(file: File, title: string) {
  await cleanupStaleJobs();
  const directory = await mkdtemp(path.join(JOB_ROOT, "job-"));
  const id = path.basename(directory);
  const extension = path.extname(file.name) || ".mp4";
  const sourcePath = path.join(directory, `source${extension}`);

  try {
    await saveUpload(file, sourcePath);
    const duration = await getDuration(sourcePath);
    const chunks = await extractAudioChunks(sourcePath, directory);
    await rm(sourcePath, { force: true });

    const manifest: AnalysisJobManifest = {
      id,
      title,
      duration,
      createdAt: Date.now(),
      chunks: chunks.map((chunk) => ({ file: path.basename(chunk.path), duration: chunk.duration, offset: chunk.offset })),
      completedChunks: [],
      transcript: [],
    };
    await writeManifest(manifest);
    return { jobId: id, title, duration, totalChunks: chunks.length };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function transcribeAnalysisChunk(jobId: string, chunkIndex: number, openai: OpenAI) {
  const manifest = await readManifest(jobId);
  const chunk = manifest.chunks[chunkIndex];
  if (!chunk) throw new Error("The requested audio section does not exist.");

  if (!manifest.completedChunks.includes(chunkIndex)) {
    const segments = await transcribeAudioChunk({
      path: path.join(jobDir(jobId), chunk.file),
      duration: chunk.duration,
      offset: chunk.offset,
    }, chunkIndex, openai);
    manifest.transcript.push(...segments);
    manifest.transcript.sort((left, right) => left.start - right.start);
    manifest.completedChunks.push(chunkIndex);
    manifest.completedChunks.sort((left, right) => left - right);
    await writeManifest(manifest);
  }

  return {
    completedChunks: manifest.completedChunks.length,
    totalChunks: manifest.chunks.length,
    transcriptSegments: manifest.transcript.length,
  };
}

export async function finishAnalysisJob(jobId: string, openai: OpenAI): Promise<AnalysisResult> {
  const manifest = await readManifest(jobId);
  if (manifest.completedChunks.length !== manifest.chunks.length) {
    throw new Error("The transcript is not complete yet.");
  }

  const clips = await findBestClips(manifest.transcript, openai);
  const result = {
    title: manifest.title,
    duration: manifest.duration,
    transcript: manifest.transcript,
    clips,
  };
  await removeAnalysisJob(jobId);
  return result;
}

export async function removeAnalysisJob(jobId: string) {
  await rm(jobDir(jobId), { recursive: true, force: true });
}
