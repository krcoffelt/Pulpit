import OpenAI from "openai";
import type { ClipSuggestion, ClipTargetDuration, TranscriptSegment } from "./types";

function fallbackClips(segments: TranscriptSegment[], targetDuration: ClipTargetDuration): ClipSuggestion[] {
  if (!segments.length) return [];
  const candidates: ClipSuggestion[] = [];
  const desired = Math.max(10, Math.min(60, targetDuration));

  for (let index = 0; index < segments.length && candidates.length < 6; index += Math.max(1, Math.floor(segments.length / 8))) {
    const start = segments[index].start;
    let endIndex = index;
    while (endIndex < segments.length - 1 && segments[endIndex].end - start < desired * 0.9) endIndex += 1;
    const chosen = segments.slice(index, endIndex + 1);
    const text = chosen.map((segment) => segment.text).join(" ");
    if (text.split(/\s+/).length < 12) continue;
    candidates.push({
      id: `clip-${candidates.length + 1}`,
      title: text.split(/\s+/).slice(0, 7).join(" ").replace(/[.,!?]$/, ""),
      start,
      end: Math.min(chosen.at(-1)?.end || start + desired, start + 60),
      hook: chosen[0].text,
      score: 82 - candidates.length * 3,
      reason: "A complete, self-contained section with clear spoken context.",
      platform: "Reels · Shorts",
      scores: { hookStrength: 78, emotionalImpact: 76, clarity: 84, completeness: 82, faithfulness: 100, shareability: 78 },
    });
  }
  return candidates;
}

type CandidateClip = Omit<ClipSuggestion, "id">;

function overlapRatio(left: CandidateClip, right: CandidateClip) {
  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
  return overlap / Math.max(0.1, Math.min(left.end - left.start, right.end - right.start));
}

function normalizedWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

function wordSimilarity(left: string, right: string) {
  const leftWords = new Set(normalizedWords(left));
  const rightWords = new Set(normalizedWords(right));
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return union ? shared / union : 0;
}

export function rankAndDeduplicateClips(candidates: CandidateClip[], segments: TranscriptSegment[], targetDuration: ClipTargetDuration) {
  const minDuration = Math.max(8, targetDuration * 0.8);
  const maxDuration = Math.min(60.1, targetDuration * 1.35);
  const transcriptEnd = segments.at(-1)?.end || 0;
  const normalized = candidates.flatMap((candidate) => {
    const start = Math.max(0, Math.min(candidate.start, transcriptEnd));
    const end = Math.max(start, Math.min(candidate.end, transcriptEnd, start + 60));
    if (end - start < minDuration || end - start > maxDuration) return [];
    const spoken = segments.filter((segment) => segment.end > start && segment.start < end);
    if (!spoken.length) return [];
    const exactText = spoken.map((segment) => segment.text).join(" ").trim();
    if (normalizedWords(exactText).length < 8) return [];
    const exactHook = exactText.split(/\s+/).slice(0, 18).join(" ");
    const scores = candidate.scores || {
      hookStrength: candidate.score,
      emotionalImpact: candidate.score,
      clarity: candidate.score,
      completeness: candidate.score,
      faithfulness: candidate.score,
      shareability: candidate.score,
    };
    const score = Math.round(scores.hookStrength * 0.2 + scores.emotionalImpact * 0.15 + scores.clarity * 0.15 + scores.completeness * 0.2 + scores.faithfulness * 0.2 + scores.shareability * 0.1);
    return [{ ...candidate, start, end, hook: exactHook, score: Math.max(1, Math.min(100, score)), scores, exactText }];
  }).sort((left, right) => right.score - left.score);

  const selected: typeof normalized = [];
  for (const candidate of normalized) {
    const duplicate = selected.some((chosen) => overlapRatio(candidate, chosen) > 0.35 || wordSimilarity(candidate.exactText, chosen.exactText) > 0.72);
    if (!duplicate) selected.push(candidate);
    if (selected.length === 6) break;
  }
  return selected.map(({ exactText: _exactText, ...clip }, index) => {
    void _exactText;
    return { ...clip, id: `clip-${index + 1}` } satisfies ClipSuggestion;
  });
}

export async function findBestClips(segments: TranscriptSegment[], openai: OpenAI, targetDuration: ClipTargetDuration = 30) {
  if (!segments.length) return [];
  const transcript = segments.map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`).join("\n");
  const response = await openai.responses.create({
    model: process.env.OPENAI_ANALYSIS_MODEL || "gpt-5",
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: `You are a senior short-form video editor specializing in sermons. Find emotionally complete, faithful moments with an immediate spoken hook, enough context to stand alone, and a satisfying landing. Never invent, paraphrase, rearrange, or clean up sermon language. Never invent timestamps. Return diverse moments from different parts of the sermon. Reject fragments, setup without payoff, repeated ideas, and heavily overlapping selections. Target ${targetDuration} seconds per clip and never exceed 60 seconds. Score each candidate independently for hook strength, emotional impact, clarity, completeness, faithfulness to the sermon, and social shareability.` },
      { role: "user", content: `Generate up to ten strong candidates so the application can remove overlaps and keep the best six. Aim for ${targetDuration}-second clips. Return a concise editorial title, exact start/end timestamps copied from this transcript, the exact opening spoken hook, all six quality scores from 1-100, an overall score, a brief concrete explanation of why the moment works, and recommended platforms.\n\n${transcript}` },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "sermon_clips",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["clips"],
          properties: {
            clips: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "start", "end", "hook", "score", "reason", "platform", "scores"],
                properties: {
                  title: { type: "string" }, start: { type: "number" }, end: { type: "number" }, hook: { type: "string" }, score: { type: "number" }, reason: { type: "string" }, platform: { type: "string" },
                  scores: {
                    type: "object", additionalProperties: false,
                    required: ["hookStrength", "emotionalImpact", "clarity", "completeness", "faithfulness", "shareability"],
                    properties: {
                      hookStrength: { type: "number", minimum: 1, maximum: 100 }, emotionalImpact: { type: "number", minimum: 1, maximum: 100 }, clarity: { type: "number", minimum: 1, maximum: 100 }, completeness: { type: "number", minimum: 1, maximum: 100 }, faithfulness: { type: "number", minimum: 1, maximum: 100 }, shareability: { type: "number", minimum: 1, maximum: 100 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  try {
    const parsed = JSON.parse(response.output_text) as { clips: Omit<ClipSuggestion, "id">[] };
    const selected = rankAndDeduplicateClips(parsed.clips, segments, targetDuration);
    return selected.length ? selected : fallbackClips(segments, targetDuration);
  } catch {
    return fallbackClips(segments, targetDuration);
  }
}
