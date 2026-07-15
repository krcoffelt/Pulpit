import { describe, expect, it } from "vitest";
import { OPEN_WORKSPACE_OWNER_ID } from "@/lib/workspace";
import { createProject, deleteProject, getProject, listProjects, requireProject } from "@/lib/projects";

describe("shared workspace project access", () => {
  it("keeps projects created under the previous Identity owner visible", async () => {
    const project = await createProject({
      ownerId: "legacy-identity-user",
      fileName: "legacy-sermon.mp4",
      fileType: "video/mp4",
      fileSize: 128,
      totalParts: 1,
      targetDuration: 30,
    });

    try {
      await expect(requireProject(OPEN_WORKSPACE_OWNER_ID, project.id)).resolves.toMatchObject({ id: project.id, ownerId: "legacy-identity-user" });
      await expect(listProjects(OPEN_WORKSPACE_OWNER_ID)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id })]));
    } finally {
      await deleteProject(OPEN_WORKSPACE_OWNER_ID, project.id);
    }

    await expect(getProject("legacy-identity-user", project.id)).resolves.toBeNull();
  });
});
