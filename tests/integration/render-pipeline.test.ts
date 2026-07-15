import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobBytes, putJobBytes } from "@/lib/job-storage";
import { createProject, deleteProject, projectSourcePartKey, recordUploadedPart, requireProject } from "@/lib/projects";
import { createRenderJob, exportMediaKey } from "@/lib/render-jobs";
import { runRenderJob } from "@/lib/render-worker";
import type { AspectRatio, RenderSettings } from "@/lib/types";

const execFileAsync = promisify(execFile);
const ownerId = "render-test-owner";
let directory = "";
let videoBytes: Uint8Array;
let audioBytes: Uint8Array;

async function makeFixture(outputPath: string, audioOnly = false) {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable.");
  const args = audioOnly
    ? ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-c:a", "libmp3lame", "-y", outputPath]
    : ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x24130f:s=320x180:d=1.2", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-y", outputPath];
  await execFileAsync(ffmpegPath, args);
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "circumvision-tests-"));
  const videoPath = path.join(directory, "fixture.mp4");
  const audioPath = path.join(directory, "fixture.mp3");
  await makeFixture(videoPath);
  await makeFixture(audioPath, true);
  videoBytes = await readFile(videoPath);
  audioBytes = await readFile(audioPath);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const settings = (aspect: AspectRatio): RenderSettings => ({
  aspect,
  captionPreset: "bold",
  captionPosition: "bottom",
  captionScale: 1,
  captionsEnabled: true,
      highlight: true,
      frameMode: "fit",
      frameX: 25,
      frameY: -20,
});

async function createStoredProject(fileName: string, fileType: string, bytes: Uint8Array) {
  const project = await createProject({ ownerId, fileName, fileType, fileSize: bytes.byteLength, totalParts: 1, targetDuration: 30 });
  await putJobBytes(projectSourcePartKey(project.id, 0), bytes);
  await recordUploadedPart(ownerId, project.id, 0);
  return project;
}

async function assertRendered(projectId: string, aspect: AspectRatio) {
  const { job } = await createRenderJob({
    ownerId,
    projectId,
    clip: { id: "clip-1", title: "Verified Moment", start: 0, end: 1, hook: "Faith keeps moving", score: 90, reason: "Complete", platform: "Reels" },
    transcript: [{ id: "s-1", start: 0, end: 1, text: "Faith keeps moving when the road gets difficult", speaker: "Tyshone" }],
    settings: settings(aspect),
  });
  await runRenderJob({ projectId, exportId: job.id, token: job.token });
  const output = await getJobBytes(exportMediaKey(projectId, job.id));
  expect(output?.byteLength).toBeGreaterThan(1_000);
  const outputPath = path.join(directory, `${job.id}.mp4`);
  await writeFile(outputPath, output!);
  const { stdout } = await execFileAsync(ffprobeStatic.path, ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", outputPath]);
  const probe = JSON.parse(stdout) as { streams: Array<{ codec_name: string; width?: number; height?: number }> };
  expect(probe.streams.map((stream) => stream.codec_name)).toEqual(expect.arrayContaining(["h264", "aac"]));
  const dimensions: Record<AspectRatio, [number, number]> = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080] };
  expect([probe.streams[0].width, probe.streams[0].height]).toEqual(dimensions[aspect]);
}

describe("durable render pipeline", () => {
  it.each(["9:16", "4:5", "1:1"] as AspectRatio[])("renders retained video as %s H.264/AAC", async (aspect) => {
    const project = await createStoredProject("fixture.mp4", "video/mp4", videoBytes);
    try {
      await assertRendered(project.id, aspect);
      expect((await requireProject(ownerId, project.id)).exports[0].status).toBe("ready");
    } finally {
      await deleteProject(ownerId, project.id);
    }
  });

  it("renders audio-only input without requiring a video stream", async () => {
    const project = await createStoredProject("fixture.mp3", "audio/mpeg", audioBytes);
    try {
      await assertRendered(project.id, "1:1");
    } finally {
      await deleteProject(ownerId, project.id);
    }
  });
});
