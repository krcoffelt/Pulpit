import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getJobBytes, putJobBytes } from "./job-storage";
import { hasVideoStream, renderClip } from "./media";
import { projectSourcePartKey, requireProject } from "./projects";
import { exportMediaKey, readRenderJob, requireRenderJob, saveRenderJob, updateProjectExport } from "./render-jobs";
import { safeErrorMessage } from "./public-error";
import { logEvent } from "./log";

async function assembleSource(projectId: string, totalParts: number, fileSize: number, outputPath: string) {
  const output = await open(outputPath, "w");
  let written = 0;
  try {
    for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
      const bytes = await getJobBytes(projectSourcePartKey(projectId, partIndex));
      if (!bytes) throw new Error(`Source section ${partIndex + 1} is missing.`);
      await output.write(bytes);
      written += bytes.byteLength;
    }
  } finally {
    await output.close();
  }
  if (written !== fileSize) throw new Error("The retained source file is incomplete.");
}

export async function runRenderJob(input: { projectId: string; exportId: string; token: string }) {
  const job = await requireRenderJob(input.projectId, input.exportId, input.token);
  if (job.status === "ready" || job.status === "cancelled") return;
  const project = await requireProject(job.ownerId, job.projectId);
  job.status = "rendering";
  await Promise.all([
    saveRenderJob(job),
    updateProjectExport(job.ownerId, job.projectId, job.id, { status: "rendering", error: undefined }),
  ]);

  const directory = await mkdtemp(path.join(tmpdir(), "circumvision-render-"));
  const extension = path.extname(project.source.fileName).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".mp4";
  const sourcePath = path.join(directory, `source${safeExtension}`);
  const outputPath = path.join(directory, "short.mp4");
  try {
    await assembleSource(project.id, project.source.totalParts, project.source.fileSize, sourcePath);
    if ((await readRenderJob(job.projectId, job.id))?.status === "cancelled") return;
    const rendered = await renderClip({
      sourcePath,
      outputPath,
      subtitlePath: path.join(directory, "captions.ass"),
      start: job.clip.start,
      end: job.clip.end,
      transcript: job.transcript,
      fallbackCaptionText: job.clip.hook || job.clip.title,
      ...job.settings,
      audioOnly: !(await hasVideoStream(sourcePath)),
    });
    logEvent("info", "render.captions_verified", {
      projectId: job.projectId,
      exportId: job.id,
      captionsEnabled: job.settings.captionsEnabled,
      captionsApplied: rendered.captionsApplied,
      captionCueCount: rendered.captionCueCount,
    });
    if ((await readRenderJob(job.projectId, job.id))?.status === "cancelled") return;
    await putJobBytes(exportMediaKey(project.id, job.id), rendered.bytes);
    job.status = "ready";
    await Promise.all([
      saveRenderJob(job),
      updateProjectExport(job.ownerId, job.projectId, job.id, {
        status: "ready",
        completedAt: new Date().toISOString(),
        fileSize: rendered.bytes.byteLength,
        captionsEnabled: job.settings.captionsEnabled,
        captionsApplied: rendered.captionsApplied,
        captionCueCount: rendered.captionCueCount,
        error: undefined,
      }),
    ]);
  } catch (error) {
    const message = safeErrorMessage(error, "The clip could not be rendered. Retry the export; the source sermon is still stored safely.");
    job.status = "failed";
    await Promise.all([
      saveRenderJob(job),
      updateProjectExport(job.ownerId, job.projectId, job.id, { status: "failed", error: message }),
    ]).catch(() => undefined);
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
