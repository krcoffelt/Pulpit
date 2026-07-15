import { randomBytes, timingSafeEqual } from "node:crypto";
import { getJobJson, jobKey, putJobJson } from "./job-storage";
import { requireProject, updateProject } from "./projects";
import { PublicError } from "./public-error";

export interface StoredProcessJob {
  projectId: string;
  ownerId: string;
  token: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  attempts: number;
}

function processJobKey(projectId: string) {
  return jobKey(projectId, "process.json");
}

function verifyToken(actual: string, supplied: string) {
  const actualBytes = Buffer.from(actual);
  const suppliedBytes = Buffer.from(supplied);
  return actualBytes.byteLength === suppliedBytes.byteLength && timingSafeEqual(actualBytes, suppliedBytes);
}

export async function createProcessJob(ownerId: string, projectId: string) {
  const project = await requireProject(ownerId, projectId);
  if (project.source.uploadedParts.length !== project.source.totalParts) throw new PublicError("The source upload is incomplete.", 409);
  const existing = await getJobJson<StoredProcessJob>(processJobKey(projectId));
  const existingIsActive = existing && (existing.status === "queued" || existing.status === "running");
  const existingIsRecent = existing && Date.now() - Date.parse(existing.updatedAt) < 16 * 60 * 1000;
  if (existingIsActive && existingIsRecent) {
    return { job: existing, shouldStart: existing.status === "queued" && !existing.dispatchedAt };
  }
  const now = new Date().toISOString();
  const job: StoredProcessJob = {
    projectId,
    ownerId,
    token: randomBytes(32).toString("hex"),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    attempts: (existing?.attempts || 0) + 1,
  };
  await Promise.all([
    putJobJson(processJobKey(projectId), job),
    updateProject(ownerId, projectId, { status: "preparing", stage: "Queued for media preparation", progress: Math.max(12, project.progress), error: undefined }),
  ]);
  return { job, shouldStart: true };
}

export async function requireProcessJob(projectId: string, token: string) {
  const job = await getJobJson<StoredProcessJob>(processJobKey(projectId));
  if (!job || !verifyToken(job.token, token)) throw new Error("The processing job is invalid or expired.");
  return job;
}

export async function saveProcessJob(job: StoredProcessJob) {
  await putJobJson(processJobKey(job.projectId), job);
}

export async function markProcessJobDispatched(projectId: string, token: string) {
  const job = await getJobJson<StoredProcessJob>(processJobKey(projectId));
  if (!job || !verifyToken(job.token, token)) return;
  job.dispatchedAt = new Date().toISOString();
  job.updatedAt = job.dispatchedAt;
  await saveProcessJob(job);
}

export async function failProcessJobDispatch(
  ownerId: string,
  projectId: string,
  token: string,
  requestId: string,
) {
  const job = await getJobJson<StoredProcessJob>(processJobKey(projectId));
  if (!job || job.ownerId !== ownerId || !verifyToken(job.token, token)) return;
  job.status = "failed";
  job.updatedAt = new Date().toISOString();
  await Promise.all([
    saveProcessJob(job),
    updateProject(ownerId, projectId, {
      status: "failed",
      stage: "Processor could not start",
      error: "Processing could not start. Retry the analysis.",
      requestId,
    }),
  ]);
}

export async function cancelProcessJob(ownerId: string, projectId: string) {
  const project = await requireProject(ownerId, projectId);
  const uploadComplete = project.source.uploadedParts.length === project.source.totalParts;
  const job = await getJobJson<StoredProcessJob>(processJobKey(projectId));
  if (job && job.ownerId === ownerId && (job.status === "queued" || job.status === "running")) {
    job.status = "cancelled";
    job.updatedAt = new Date().toISOString();
    await saveProcessJob(job);
  }
  return updateProject(ownerId, projectId, uploadComplete
    ? { status: "cancelled", stage: "Processing cancelled", error: undefined }
    : { status: "uploading", stage: "Upload paused — resume with the original file", error: undefined });
}
