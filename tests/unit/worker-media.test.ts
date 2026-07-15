import { afterEach, describe, expect, it, vi } from "vitest";
import { processWorkerMediaSource, renderWorkerMediaSource } from "@/lib/worker-media";

describe("worker media source", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps worker credentials in headers while using the ranged project endpoint", () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("URL", "https://circumvision.netlify.app");
    const source = processWorkerMediaSource("job-123", "a".repeat(64));
    expect(source).toEqual({
      url: "https://circumvision.netlify.app/api/projects/job-123/media",
      headers: { "X-Circumvision-Process-Token": "a".repeat(64) },
    });
    expect(source?.url).not.toContain("a".repeat(64));
  });

  it("creates separate render credentials and falls back to local files outside Netlify", () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("URL", "https://circumvision.netlify.app");
    expect(renderWorkerMediaSource("job-123", "export-123", "b".repeat(64))).toMatchObject({
      headers: {
        "X-Circumvision-Render-Token": "b".repeat(64),
        "X-Circumvision-Export-Id": "export-123",
      },
    });

    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("URL", "");
    expect(processWorkerMediaSource("job-123", "a".repeat(64))).toBeNull();
  });
});
