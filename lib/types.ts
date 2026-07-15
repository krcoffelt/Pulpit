export type AspectRatio = "9:16" | "4:5" | "1:1";
export type CaptionPreset = "bold" | "clean" | "minimal";
export type CaptionPosition = "middle" | "bottom";
export type FrameMode = "fill" | "fit";

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export interface ClipSuggestion {
  id: string;
  title: string;
  start: number;
  end: number;
  hook: string;
  score: number;
  reason: string;
  platform: string;
}

export interface AnalysisResult {
  title: string;
  duration: number;
  transcript: TranscriptSegment[];
  clips: ClipSuggestion[];
}

export interface RenderSettings {
  aspect: AspectRatio;
  captionPreset: CaptionPreset;
  captionPosition: CaptionPosition;
  captionScale: number;
  captionsEnabled: boolean;
  highlight: boolean;
  frameMode: FrameMode;
}
