import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { findBestClips, rankAndDeduplicateClips } from "@/lib/clip-selection";
import type { ClipSuggestion, TranscriptSegment } from "@/lib/types";

const segments: TranscriptSegment[] = Array.from({ length: 18 }, (_, index) => ({
  id: `s-${index}`,
  start: index * 5,
  end: index * 5 + 5,
  speaker: "Tyshone",
  text: `Exact sermon language for section ${index} carries enough faithful context and meaning`,
}));

function candidate(start: number, end: number, title: string, score = 80): Omit<ClipSuggestion, "id"> {
  return {
    title,
    start,
    end,
    hook: "Invented hook that must not survive",
    score,
    reason: "A complete thought with a clear landing.",
    platform: "Reels · Shorts",
    scores: {
      hookStrength: score,
      emotionalImpact: score,
      clarity: score,
      completeness: score,
      faithfulness: 100,
      shareability: score,
    },
  };
}

describe("rankAndDeduplicateClips", () => {
  it("removes heavy overlaps and preserves exact transcript language in hooks", () => {
    const result = rankAndDeduplicateClips([
      candidate(0, 30, "First", 88),
      candidate(4, 32, "Overlapping duplicate", 95),
      candidate(45, 75, "Different moment", 84),
    ], segments, 30);

    expect(result).toHaveLength(2);
    expect(result.map((clip) => clip.title)).toContain("Overlapping duplicate");
    expect(result.map((clip) => clip.title)).toContain("Different moment");
    for (const clip of result) {
      expect(clip.hook).toMatch(/^Exact sermon language/);
      expect(clip.hook).not.toContain("Invented");
    }
  });

  it("rejects candidates that miss the requested duration band", () => {
    const result = rankAndDeduplicateClips([
      candidate(0, 7, "Too short"),
      candidate(0, 55, "Too long"),
      candidate(10, 40, "On target"),
    ], segments, 30);
    expect(result.map((clip) => clip.title)).toEqual(["On target"]);
  });
});

describe("findBestClips model workflow", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Luna candidates as input to Sol and returns Sol's reviewed selection", async () => {
    vi.stubEnv("OPENAI_CANDIDATE_MODEL", "");
    vi.stubEnv("OPENAI_ANALYSIS_MODEL", "");
    const firstPass = JSON.stringify({ clips: [candidate(0, 30, "First pass")] });
    const create = vi.fn()
      .mockResolvedValueOnce({ output_text: firstPass })
      .mockResolvedValueOnce({ output_text: JSON.stringify({ clips: [candidate(45, 75, "Reviewed")] }) });
    const client = { responses: { create } } as unknown as OpenAI;

    const result = await findBestClips(segments, client, 30);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].model).toBe("gpt-6-luna");
    expect(create.mock.calls[1][0].model).toBe("gpt-6.1-sol");
    const review = create.mock.calls[1][0].input[1].content;
    expect(review).toContain(firstPass);
    expect(review).toContain(segments[0].text);
    expect(review).toContain(segments.at(-1)!.text);
    expect(result.map((clip) => clip.title)).toEqual(["Reviewed"]);
    expect(result[0].hook).toMatch(/^Exact sermon language/);
  });

  it("honors separate candidate and review model overrides", async () => {
    vi.stubEnv("OPENAI_CANDIDATE_MODEL", "candidate-override");
    vi.stubEnv("OPENAI_ANALYSIS_MODEL", "review-override");
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify({ clips: [candidate(0, 30, "Selected")] }) });
    await findBestClips(segments, { responses: { create } } as unknown as OpenAI);
    expect(create.mock.calls.map(([request]) => request.model)).toEqual(["candidate-override", "review-override"]);
  });
});
