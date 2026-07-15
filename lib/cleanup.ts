import { deleteProject, saveProject } from "./projects";
import { deleteStorageKey, getJobJson, listJobKeys } from "./job-storage";
import { logEvent } from "./log";
import type { CircumvisionProject } from "./types";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function cleanupExpiredData(now = Date.now()) {
  const failedRetentionMs = positiveNumber(process.env.CIRCUMVISION_FAILED_RETENTION_DAYS, 14) * 24 * 60 * 60 * 1000;
  const abandonedUploadMs = positiveNumber(process.env.CIRCUMVISION_ABANDONED_UPLOAD_DAYS, 7) * 24 * 60 * 60 * 1000;
  const staleJobMs = 20 * 60 * 1000;
  const projectKeys = (await listJobKeys("owners/")).filter((key) => key.endsWith(".json"));
  let deletedProjects = 0;
  let recoveredProjects = 0;

  for (const key of projectKeys) {
    const match = /^owners\/([a-zA-Z0-9_-]+)\/projects\/(job-[a-f0-9-]{36})\.json$/.exec(key);
    if (!match) continue;
    const project = await getJobJson<CircumvisionProject>(key);
    if (!project) continue;
    const age = now - Date.parse(project.updatedAt);
    const shouldDelete = ((project.status === "failed" || project.status === "cancelled") && age > failedRetentionMs)
      || (project.status === "uploading" && age > abandonedUploadMs);
    if (shouldDelete) {
      await deleteProject(match[1], match[2]);
      deletedProjects += 1;
      continue;
    }

    let changed = false;
    if (["preparing", "transcribing", "selecting"].includes(project.status) && age > staleJobMs) {
      project.status = "failed";
      project.stage = "Processing stopped before completion";
      project.error = "The background job stopped responding. Retry this project; the retained source and completed transcript sections are still safe.";
      changed = true;
    }
    for (const item of project.exports) {
      if ((item.status === "queued" || item.status === "rendering") && now - Date.parse(item.createdAt) > staleJobMs) {
        item.status = "failed";
        item.error = "The background renderer stopped responding. Queue the export again.";
        changed = true;
      }
    }
    if (changed) {
      if (project.status === "rendering" && !project.exports.some((item) => item.status === "queued" || item.status === "rendering")) {
        project.status = "ready";
        project.stage = "Ready to edit";
      }
      await saveProject(project);
      recoveredProjects += 1;
    }
  }

  const rateKeys = (await listJobKeys("rate/")).filter((key) => key.endsWith(".json"));
  let deletedRateBuckets = 0;
  for (const key of rateKeys) {
    const record = await getJobJson<{ resetAt?: number }>(key);
    if (record?.resetAt && record.resetAt < now - 24 * 60 * 60 * 1000) {
      await deleteStorageKey(key);
      deletedRateBuckets += 1;
    }
  }

  const result = { scannedProjects: projectKeys.length, deletedProjects, recoveredProjects, deletedRateBuckets };
  logEvent("info", "cleanup.completed", result);
  return result;
}
