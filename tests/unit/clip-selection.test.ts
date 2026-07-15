import { describe, expect, it } from "vitest";
import { rankAndDeduplicateClips } from "@/lib/clip-selection";
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
