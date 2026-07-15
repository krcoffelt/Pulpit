import { describe, expect, it } from "vitest";
import { validateMediaSignature } from "@/lib/projects";
import { splitTimedTranscriptSegment } from "@/lib/media";

describe("validateMediaSignature", () => {
  it("accepts supported container signatures", () => {
    expect(() => validateMediaSignature(Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), "sermon.mp4")).not.toThrow();
    expect(() => validateMediaSignature(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), "sermon.webm")).not.toThrow();
    expect(() => validateMediaSignature(new TextEncoder().encode("RIFF0000WAVEfmt "), "sermon.wav")).not.toThrow();
    expect(() => validateMediaSignature(new TextEncoder().encode("ID3 sermon audio"), "sermon.mp3")).not.toThrow();
  });

  it("rejects renamed or malformed data", () => {
    expect(() => validateMediaSignature(new TextEncoder().encode("not a real movie"), "sermon.mov")).toThrow(/do not match/);
  });
});

describe("splitTimedTranscriptSegment", () => {
  it("keeps exact words and speaker identity while creating useful timing cues", () => {
    const source = {
      id: "speaker-turn",
      start: 10,
      end: 30,
      speaker: "Speaker 1",
      text: "Faith does not deny the storm. Faith decides the storm will not have the final word in your life today.",
    };
    const cues = splitTimedTranscriptSegment(source, 8);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.map((cue) => cue.text).join(" ")).toBe(source.text);
    expect(cues.every((cue) => cue.speaker === source.speaker)).toBe(true);
    expect(cues[0].start).toBe(source.start);
    expect(cues.at(-1)?.end).toBe(source.end);
    expect(cues.every((cue, index) => index === 0 || cue.start === cues[index - 1].end)).toBe(true);
  });
});
