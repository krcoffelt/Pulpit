import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchBackgroundJob } from "../../lib/worker-dispatch";

describe("background worker dispatch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the Netlify background function when only the Blobs runtime context is present", async () => {
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("NETLIFY_BLOBS_CONTEXT", "production-context");
    vi.stubEnv("URL", "https://circumvision.netlify.app");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(dispatchBackgroundJob(
      new Request("https://internal.example/api/projects/job/process"),
      "process",
      { projectId: "job-1", token: "token" },
      "request-1",
    )).resolves.toBe("netlify");

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://circumvision.netlify.app/.netlify/functions/process-background"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null outside a Netlify or external-worker runtime", async () => {
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("NETLIFY_BLOBS_CONTEXT", "");
    vi.stubEnv("DEPLOY_ID", "");
    vi.stubEnv("CIRCUMVISION_WORKER_URL", "");

    await expect(dispatchBackgroundJob(
      new Request("http://localhost:3000/api/projects/job/process"),
      "process",
      { projectId: "job-1", token: "token" },
      "request-1",
    )).resolves.toBeNull();
  });

  it("surfaces an unreadable background-function response as a queue error", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("URL", "https://circumvision.netlify.app");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(dispatchBackgroundJob(
      new Request("https://circumvision.netlify.app/api/projects/job/process"),
      "process",
      { projectId: "job-1", token: "token" },
      "request-1",
    )).rejects.toThrow("HTTP 500");
  });
});
