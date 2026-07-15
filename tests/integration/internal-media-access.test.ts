import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/projects/[projectId]/media/route";
import { putJobBytes } from "@/lib/job-storage";
import { createProcessJob } from "@/lib/process-jobs";
import { createProject, deleteProject, projectSourcePartKey, recordUploadedPart } from "@/lib/projects";
import { createRenderJob } from "@/lib/render-jobs";

const ownerId = "internal-media-test-owner";
const projects: string[] = [];

afterEach(async () => {
  await Promise.all(projects.splice(0).map((projectId) => deleteProject(ownerId, projectId)));
});

async function storedProject() {
  const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const project = await createProject({ ownerId, fileName: "sermon.mp4", fileType: "video/mp4", fileSize: bytes.byteLength, totalParts: 1, targetDuration: 30 });
  projects.push(project.id);
  await putJobBytes(projectSourcePartKey(project.id, 0), bytes);
  await recordUploadedPart(ownerId, project.id, 0);
  return { project, bytes };
}

describe("internal ranged media access", () => {
  it("serves retained source sections to an authenticated process worker", async () => {
    const { project, bytes } = await storedProject();
    const { job } = await createProcessJob(ownerId, project.id);
    const response = await GET(new Request(`http://localhost/api/projects/${project.id}/media`, {
      headers: {
        Range: "bytes=4-11",
        "X-Circumvision-Process-Token": job.token,
      },
    }), { params: Promise.resolve({ projectId: project.id }) });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 4-11/${bytes.byteLength}`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(4, 12));
  });

  it("does not fall back to public session auth when worker credentials are invalid", async () => {
    const { project } = await storedProject();
    const response = await GET(new Request(`http://localhost/api/projects/${project.id}/media`, {
      headers: { "X-Circumvision-Process-Token": "0".repeat(64) },
    }), { params: Promise.resolve({ projectId: project.id }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Media access was denied." });
  });

  it("serves the same retained source to an authenticated render worker", async () => {
    const { project, bytes } = await storedProject();
    const { job } = await createRenderJob({
      ownerId,
      projectId: project.id,
      clip: { id: "clip-1", title: "Moment", start: 0, end: 1, hook: "Keep the faith", score: 90, reason: "Complete", platform: "Reels" },
      transcript: [{ id: "segment-1", start: 0, end: 1, text: "Keep the faith", speaker: "Tyshone" }],
      settings: { aspect: "9:16", captionPreset: "bold", captionPosition: "bottom", captionScale: 1, captionsEnabled: true, highlight: true, frameMode: "fill", frameX: 0, frameY: 0 },
    });
    const response = await GET(new Request(`http://localhost/api/projects/${project.id}/media`, {
      headers: {
        Range: "bytes=0-7",
        "X-Circumvision-Render-Token": job.token,
        "X-Circumvision-Export-Id": job.id,
      },
    }), { params: Promise.resolve({ projectId: project.id }) });

    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(0, 8));
  });
});
