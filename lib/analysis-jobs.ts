import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { extractAudioChunks, findBestClips, getDuration, transcribeAudioChunk } from "./media";
import {
  deleteJobPath,
  getJobBytes,
  getJobJson,
  JOB_ID_PATTERN,
  jobKey,
  listJobKeys,
  putJobBytes,
  putJobJson,
} from "./job-storage";
import type { AnalysisResult, TranscriptSegment } from "./types";

const JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

interface UploadManifest {
  createdAt: number;
}

interface UploadedJobInput {
  jobId: string;
  title: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
}

function manifestKey(jobId: string) {
  return jobKey(jobId, "manifest.json");
}

async function writeManifest(manifest: AnalysisJobManifest) {
  await putJobJson(manifestKey(manifest.id), manifest);
}

async function readManifest(jobId: string) {
  const manifest = await getJobJson<AnalysisJobManifest>(manifestKey(jobId));
  if (!manifest) throw new Error("This analysis job expired or could not be found. Upload the sermon again.");
  return manifest;
}

async function cleanupStaleJobs() {
  const keys = await listJobKeys("jobs/");
  const stateKeys = keys.filter((key) => key.endsWith("/manifest.json") || key.endsWith("/upload.json"));
  const jobIds = new Set(stateKeys.map((key) => key.split("/")[1]).filter((jobId) => JOB_ID_PATTERN.test(jobId)));
  const now = Date.now();

  for (const jobId of jobIds) {
    const state = await getJobJson<AnalysisJobManifest | UploadManifest>(manifestKey(jobId))
      || await getJobJson<UploadManifest>(jobKey(jobId, "upload.json"));
    if (state?.createdAt && now - state.createdAt > JOB_MAX_AGE_MS) await deleteJobPath(jobId);
  }
}

async function assembleUpload(input: UploadedJobInput, outputPath: string) {
  const output = await open(outputPath, "w");
  let writtenBytes = 0;

  try {
    for (let chunkIndex = 0; chunkIndex < input.totalChunks; chunkIndex += 1) {
      const part = await getJobBytes(jobKey(input.jobId, `uploads/part-${String(chunkIndex).padStart(4, "0")}`));
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
  await cleanupStaleJobs();
  const directory = await mkdtemp(path.join(tmpdir(), "circumvision-prepare-"));
  const requestedExtension = path.extname(input.fileName).toLowerCase();
  const extension = /^\.[a-z0-9]{1,8}$/.test(requestedExtension) ? requestedExtension : ".mp4";
  const sourcePath = path.join(directory, `source${extension}`);

  try {
    await assembleUpload(input, sourcePath);
    const duration = await getDuration(sourcePath);
    const chunks = await extractAudioChunks(sourcePath, directory);

    const storedChunks: StoredChunk[] = [];
    for (const chunk of chunks) {
      const file = `audio/${path.basename(chunk.path)}`;
      await putJobBytes(jobKey(input.jobId, file), await readFile(chunk.path));
      storedChunks.push({ file, duration: chunk.duration, offset: chunk.offset });
    }

    const manifest: AnalysisJobManifest = {
      id: input.jobId,
      title: input.title,
      duration,
      createdAt: Date.now(),
      chunks: storedChunks,
      completedChunks: [],
      transcript: [],
    };
    await writeManifest(manifest);
    await deleteJobPath(input.jobId, "uploads/");

    return { jobId: input.jobId, title: input.title, duration, totalChunks: chunks.length };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function transcribeAnalysisChunk(jobId: string, chunkIndex: number, openai: OpenAI) {
  const manifest = await readManifest(jobId);
  const chunk = manifest.chunks[chunkIndex];
  if (!chunk) throw new Error("The requested audio section does not exist.");

  if (!manifest.completedChunks.includes(chunkIndex)) {
    const audio = await getJobBytes(jobKey(jobId, chunk.file));
    if (!audio) throw new Error("This audio section expired or could not be found.");
    const directory = await mkdtemp(path.join(tmpdir(), "circumvision-transcribe-"));
    const chunkPath = path.join(directory, path.basename(chunk.file));

    try {
      await writeFile(chunkPath, audio);
      const segments = await transcribeAudioChunk({ path: chunkPath, duration: chunk.duration, offset: chunk.offset }, chunkIndex, openai);
      manifest.transcript.push(...segments);
      manifest.transcript.sort((left, right) => left.start - right.start);
      manifest.completedChunks.push(chunkIndex);
      manifest.completedChunks.sort((left, right) => left - right);
      await writeManifest(manifest);
      await deleteJobPath(jobId, `${chunk.file}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return {
    completedChunks: manifest.completedChunks.length,
    totalChunks: manifest.chunks.length,
    completedDuration: manifest.completedChunks.reduce((total, index) => total + (manifest.chunks[index]?.duration || 0), 0),
    totalDuration: manifest.chunks.reduce((total, storedChunk) => total + storedChunk.duration, 0),
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
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error("The analysis job identifier is invalid.");
  await deleteJobPath(jobId);
}
