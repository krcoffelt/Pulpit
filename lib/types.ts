export type AspectRatio = "9:16" | "4:5" | "1:1";
export type CaptionPreset = "bold" | "clean" | "minimal";
export type CaptionPosition = "middle" | "bottom";
export type FrameMode = "fill" | "fit";
export type ClipTargetDuration = 15 | 30 | 45 | 60;

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
  scores?: {
    hookStrength: number;
    emotionalImpact: number;
    clarity: number;
    completeness: number;
    faithfulness: number;
    shareability: number;
  };
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
  frameX: number;
  frameY: number;
}

export type ProjectStatus =
  | "uploading"
  | "preparing"
  | "transcribing"
  | "selecting"
  | "ready"
  | "rendering"
  | "failed"
  | "cancelled";

export interface ProjectSource {
  fileName: string;
  fileType: string;
  fileSize: number;
  totalParts: number;
  uploadedParts: number[];
}

export interface ProjectExport {
  id: string;
  clipId: string;
  aspect: AspectRatio;
  status: "queued" | "rendering" | "ready" | "failed" | "cancelled";
  fileName: string;
  createdAt: string;
  completedAt?: string;
  fileSize?: number;
  error?: string;
}

export interface ProjectEditorState {
  clips: ClipSuggestion[];
  transcript: TranscriptSegment[];
  settings: RenderSettings;
  selectedClipId?: string;
}

export interface CircumvisionProject {
  id: string;
  ownerId: string;
  title: string;
  targetDuration: ClipTargetDuration;
  status: ProjectStatus;
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  source: ProjectSource;
  duration?: number;
  processing?: {
    totalChunks: number;
    completedChunks: number[];
  };
  analysis?: AnalysisResult;
  editor?: ProjectEditorState;
  exports: ProjectExport[];
  error?: string;
  requestId?: string;
}

export type ProjectSummary = Omit<CircumvisionProject, "ownerId" | "analysis" | "editor"> & {
  clipCount: number;
  transcriptSegments: number;
};
