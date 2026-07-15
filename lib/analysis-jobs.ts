import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { extractAudioChunks, getDuration, transcribeAudioChunk } from "./media";
import type { WorkerMediaSource } from "./worker-media";
import { findBestClips } from "./clip-selection";
import {
  getJobBytes,
  getJobJson,
  JOB_ID_PATTERN,
  jobKey,
  deleteStoragePrefix,
  deleteStorageKey,
  putJobBytes,
  putJobJson,
} from "./job-storage";
import type { AnalysisResult, ClipTargetDuration, TranscriptSegment } from "./types";
import { projectSourcePartKey } from "./projects";

interface StoredChunk {
  file: string;
  duration: number;
  offset: number;
}

interface AnalysisJobManifest {
  version: 3;
  id: string;
  ownerId: string;
  title: string;
  duration: number;
  createdAt: number;
  chunks: StoredChunk[];
  completedChunks?: number[];
  transcript?: TranscriptSegment[];
}

interface UploadedJobInput {
  jobId: string;
  ownerId: string;
  title: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  remoteSource?: WorkerMediaSource;
}

function manifestKey(jobId: string) {
  return jobKey(jobId, "manifest.json");
}

function transcriptChunkKey(jobId: string, chunkIndex: number) {
  return jobKey(jobId, `transcripts/chunk-${String(chunkIndex).padStart(4, "0")}.json`);
}

async function writeManifest(manifest: AnalysisJobManifest) {
  await putJobJson(manifestKey(manifest.id), manifest);
}

async function readManifest(jobId: string, ownerId: string) {
  const manifest = await getJobJson<AnalysisJobManifest>(manifestKey(jobId));
  if (!manifest) throw new Error("This analysis checkpoint could not be found. Retry processing; the retained source does not need to be uploaded again.");
  if (manifest.ownerId !== ownerId) throw new Error("This analysis job could not be found.");
  return manifest;
}

async function assembleUpload(input: UploadedJobInput, outputPath: string) {
  const output = await open(outputPath, "w");
  let writtenBytes = 0;

  try {
    for (let chunkIndex = 0; chunkIndex < input.totalChunks; chunkIndex += 1) {
      const part = await getJobBytes(projectSourcePartKey(input.jobId, chunkIndex));
      if (!part) throw new Error(`Upload section ${chunkIndex + 1} of ${input.totalChunks} is missing.`);
      await output.write(part);
      writtenBytes += part.byteLength;
    }
  } finally {
    await output.close();
  }

  if (writtenBytes !== input.fileSize) {
    throw new Error("The uploaded file is incomplete. Upload it again.");
  }
}

export async function createAnalysisJobFromUpload(input: UploadedJobInput) {
  if (!JOB_ID_PATTERN.test(input.jobId)) throw new Error("The analysis job identifier is invalid.");
  const existing = await getJobJson<AnalysisJobManifest>(manifestKey(input.jobId));
  if (existing) {
    if (existing.ownerId !== input.ownerId) throw new Error("This analysis job could not be found.");
    if (existing.version === 3) return { jobId: existing.id, title: existing.title, duration: existing.duration, totalChunks: existing.chunks.length };
    await Promise.all([
      deleteStoragePrefix(jobKey(input.jobId, "audio/")),
      deleteStoragePrefix(jobKey(input.jobId, "transcripts/")),
      deleteStorageKey(manifestKey(input.jobId)),
    ]);
  }
  const directory = await mkdtemp(path.join(tmpdir(), "circumvision-prepare-"));
  const requestedExtension = path.extname(input.fileName).toLowerCase();
  const extension = /^\.[a-z0-9]{1,8}$/.test(requestedExtension) ? requestedExtension : ".mp4";
  const sourcePath = path.join(directory, `source${extension}`);

  try {
    if (!input.remoteSource) await assembleUpload(input, sourcePath);
    const mediaInput = input.remoteSource?.url || sourcePath;
    const mediaHeaders = input.remoteSource?.headers;
    const duration = await getDuration(mediaInput, mediaHeaders);
    const chunks = await extractAudioChunks(mediaInput, directory, 180, mediaHeaders);

    const storedChunks: StoredChunk[] = [];
    for (const chunk of chunks) {
      const file = `audio/${path.basename(chunk.path)}`;
      await putJobBytes(jobKey(input.jobId, file), await readFile(chunk.path));
      storedChunks.push({ file, duration: chunk.duration, offset: chunk.offset });
    }

    const manifest: AnalysisJobManifest = {
      version: 3,
      id: input.jobId,
      ownerId: input.ownerId,
      title: input.title,
      duration,
      createdAt: Date.now(),
      chunks: storedChunks,
    };
    await writeManifest(manifest);
    return { jobId: input.jobId, title: input.title, duration, totalChunks: chunks.length };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function transcribeAnalysisChunk(jobId: string, ownerId: string, chunkIndex: number, openai: OpenAI) {
  const manifest = await readManifest(jobId, ownerId);
  const chunk = manifest.chunks[chunkIndex];
  if (!chunk) throw new Error("The requested audio section does not exist.");

  const existingTranscript = await getJobJson<TranscriptSegment[]>(transcriptChunkKey(jobId, chunkIndex));
  if (!existingTranscript) {
    const audio = await getJobBytes(jobKey(jobId, chunk.file));
    if (!audio) throw new Error("This audio section expired or could not be found.");
    const directory = await mkdtemp(path.join(tmpdir(), "circumvision-transcribe-"));
    const chunkPath = path.join(directory, path.basename(chunk.file));

    try {
      await writeFile(chunkPath, audio);
      const segments = await transcribeAudioChunk({ path: chunkPath, duration: chunk.duration, offset: chunk.offset }, chunkIndex, openai);
      await putJobJson(transcriptChunkKey(jobId, chunkIndex), segments);
      // Keep extracted audio until clip selection finishes so a failed request can retry safely.
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return getAnalysisProgress(jobId, ownerId);
}

export async function getAnalysisProgress(jobId: string, ownerId: string) {
  const manifest = await readManifest(jobId, ownerId);
  const stored = await Promise.all(manifest.chunks.map((_, index) => getJobJson<TranscriptSegment[]>(transcriptChunkKey(jobId, index))));
  const completedIndices = stored.flatMap((segments, index) => segments ? [index] : []);
  return {
    completedChunks: completedIndices.length,
    completedIndices,
    totalChunks: manifest.chunks.length,
    completedDuration: completedIndices.reduce((total, index) => total + (manifest.chunks[index]?.duration || 0), 0),
    totalDuration: manifest.chunks.reduce((total, storedChunk) => total + storedChunk.duration, 0),
    transcriptSegments: stored.reduce((total, segments) => total + (segments?.length || 0), 0),
  };
}

export async function finishAnalysisJob(jobId: string, ownerId: string, openai: OpenAI, targetDuration: ClipTargetDuration = 30): Promise<AnalysisResult> {
  const manifest = await readManifest(jobId, ownerId);
  const stored = await Promise.all(manifest.chunks.map((_, index) => getJobJson<TranscriptSegment[]>(transcriptChunkKey(jobId, index))));
  if (stored.some((segments) => !segments)) {
    throw new Error("The transcript is not complete yet.");
  }
  const transcript = stored.flatMap((segments) => segments || []).sort((left, right) => left.start - right.start);
  const clips = await findBestClips(transcript, openai, targetDuration);
  const result = {
    title: manifest.title,
    duration: manifest.duration,
    transcript,
    clips,
  };
  return result;
}

export async function cleanupAnalysisIntermediates(jobId: string) {
  await Promise.all([
    deleteStoragePrefix(jobKey(jobId, "audio/")),
    deleteStoragePrefix(jobKey(jobId, "transcripts/")),
  ]);
}
