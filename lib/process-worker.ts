import OpenAI from "openai";
import { cleanupAnalysisIntermediates, createAnalysisJobFromUpload, finishAnalysisJob, getAnalysisProgress, transcribeAnalysisChunk } from "./analysis-jobs";
import { logEvent } from "./log";
import { requireProcessJob, saveProcessJob } from "./process-jobs";
import { DEFAULT_RENDER_SETTINGS, requireProject, updateProject } from "./projects";
import { PublicError, safeErrorMessage } from "./public-error";
import { processWorkerMediaSource } from "./worker-media";

class ProcessCancelledError extends Error {
  constructor() {
    super("Sermon processing was cancelled.");
    this.name = "ProcessCancelledError";
  }
}

async function assertProcessActive(ownerId: string, projectId: string) {
  const project = await requireProject(ownerId, projectId);
  if (project.status === "cancelled") throw new ProcessCancelledError();
  return project;
}

export async function runProcessJob(input: { projectId: string; token: string }) {
  const job = await requireProcessJob(input.projectId, input.token);
  if (job.status === "ready" || job.status === "cancelled") return;
  const project = await requireProject(job.ownerId, job.projectId);
  if (project.analysis?.clips.length && project.status === "ready") return;
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  await saveProcessJob(job);

  try {
    await assertProcessActive(job.ownerId, job.projectId);
    if (!process.env.OPENAI_API_KEY) throw new PublicError("OpenAI is not configured for this deployment.", 503);
    await updateProject(job.ownerId, job.projectId, { status: "preparing", stage: "Extracting and optimizing audio", progress: 12, error: undefined });
    const prepared = await createAnalysisJobFromUpload({
      jobId: project.id,
      ownerId: job.ownerId,
      title: project.title,
      fileName: project.source.fileName,
      fileSize: project.source.fileSize,
      totalChunks: project.source.totalParts,
      remoteSource: processWorkerMediaSource(project.id, input.token) || undefined,
    });
    await assertProcessActive(job.ownerId, job.projectId);
    await updateProject(job.ownerId, job.projectId, {
      status: "transcribing",
      stage: "Ready to transcribe",
      progress: 18,
      duration: prepared.duration,
      processing: { totalChunks: prepared.totalChunks, completedChunks: project.processing?.completedChunks || [] },
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 4 * 60 * 1000 });
    const concurrency = Math.max(1, Math.min(3, Number(process.env.CIRCUMVISION_TRANSCRIPTION_CONCURRENCY) || 2));
    for (let chunkIndex = 0; chunkIndex < prepared.totalChunks; chunkIndex += concurrency) {
      await assertProcessActive(job.ownerId, job.projectId);
      const batch = Array.from({ length: Math.min(concurrency, prepared.totalChunks - chunkIndex) }, (_, offset) => chunkIndex + offset);
      await Promise.all(batch.map((index) => transcribeAnalysisChunk(project.id, job.ownerId, index, openai)));
      const progress = await getAnalysisProgress(project.id, job.ownerId);
      const ratio = progress.totalDuration ? progress.completedDuration / progress.totalDuration : progress.completedChunks / progress.totalChunks;
      await updateProject(job.ownerId, job.projectId, {
        status: "transcribing",
        stage: `Transcribed ${progress.completedChunks} of ${progress.totalChunks} sections`,
        progress: 18 + Math.round(Math.max(0, Math.min(1, ratio)) * 64),
        processing: { totalChunks: progress.totalChunks, completedChunks: progress.completedIndices },
      });
      job.updatedAt = new Date().toISOString();
      await saveProcessJob(job);
    }

    await assertProcessActive(job.ownerId, job.projectId);
    await updateProject(job.ownerId, job.projectId, { status: "selecting", stage: "Finding strong, complete moments", progress: 84 });
    const result = await finishAnalysisJob(project.id, job.ownerId, openai, project.targetDuration || 30);
    await updateProject(job.ownerId, job.projectId, {
      status: "ready",
      stage: "Ready to edit",
      progress: 100,
      duration: result.duration,
      analysis: result,
      editor: { clips: result.clips, transcript: result.transcript, settings: project.editor?.settings || DEFAULT_RENDER_SETTINGS, selectedClipId: result.clips[0]?.id },
      error: undefined,
    });
    job.status = "ready";
    job.updatedAt = new Date().toISOString();
    await Promise.all([saveProcessJob(job), cleanupAnalysisIntermediates(job.projectId)]);
    logEvent("info", "process.completed", { projectId: job.projectId, ownerId: job.ownerId, attempts: job.attempts });
  } catch (error) {
    if (error instanceof ProcessCancelledError) {
      job.status = "cancelled";
      job.updatedAt = new Date().toISOString();
      await Promise.all([
        saveProcessJob(job),
        updateProject(job.ownerId, job.projectId, { status: "cancelled", stage: "Processing cancelled", error: undefined }),
      ]).catch(() => undefined);
      logEvent("info", "process.cancelled", { projectId: job.projectId, ownerId: job.ownerId });
      return;
    }
    const message = safeErrorMessage(error, "Sermon processing failed. Retry this project; the retained source and completed transcript sections are safe.");
    job.status = "failed";
    job.updatedAt = new Date().toISOString();
    await Promise.all([
      saveProcessJob(job),
      updateProject(job.ownerId, job.projectId, { status: "failed", stage: "Processing failed", error: message }),
    ]).catch(() => undefined);
    logEvent("error", "process.failed", { projectId: job.projectId, ownerId: job.ownerId, attempts: job.attempts }, error);
    throw error;
  }
}
