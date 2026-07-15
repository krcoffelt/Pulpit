"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  ArrowLeft,
  Captions,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Frame,
  Gauge,
  History,
  Home,
  Info,
  LayoutTemplate,
  LoaderCircle,
  Maximize2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Settings,
  Sparkles,
  Subtitles,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { DEMO_ANALYSIS } from "@/lib/demo";
import { UPLOAD_PART_BYTES } from "@/lib/upload";
import type {
  AnalysisResult,
  AspectRatio,
  CaptionPosition,
  CaptionPreset,
  ClipSuggestion,
  FrameMode,
  RenderSettings,
} from "@/lib/types";

type AppMode = "welcome" | "ready" | "analyzing" | "editor";
type InspectorTab = "captions" | "frame" | "transcript";

const DEFAULT_SETTINGS: RenderSettings = {
  aspect: "9:16",
  captionPreset: "bold",
  captionPosition: "bottom",
  captionScale: 1,
  captionsEnabled: true,
  highlight: true,
  frameMode: "fill",
};

type ApiErrorPayload = {
  error?: string;
  requestId?: string;
};

type AnalysisJobStartPayload = {
  jobId: string;
  title: string;
  duration: number;
  totalChunks: number;
};

type AnalysisChunkPayload = {
  completedChunks: number;
  totalChunks: number;
  completedDuration: number;
  totalDuration: number;
  transcriptSegments: number;
};

function parseApiPayload<T extends object>(body: string, responseStatus: number, action: string): T & ApiErrorPayload {
  const status = responseStatus ? `HTTP ${responseStatus}` : "an unknown status";

  if (!body.trim()) {
    throw new Error(`${action} failed with ${status}, but the processor returned no details. Retry the analysis.`);
  }

  try {
    const payload = JSON.parse(body) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("The response was not a JSON object.");
    }
    return payload as T & ApiErrorPayload;
  } catch {
    throw new Error(`${action} failed with ${status}, and the processor returned an unreadable response. Try again in a moment.`);
  }
}

async function readApiPayload<T extends object>(response: Response, action: string): Promise<T & ApiErrorPayload> {
  return parseApiPayload<T>(await response.text(), response.status, action);
}

function uploadPart(
  part: Blob,
  jobId: string,
  chunkIndex: number,
  totalChunks: number,
  onProgress: (uploadedBytes: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/uploads");
    request.timeout = 60_000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("x-upload-id", jobId);
    request.setRequestHeader("x-chunk-index", String(chunkIndex));
    request.setRequestHeader("x-total-chunks", String(totalChunks));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded);
      }
    };
    request.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    request.onabort = () => reject(new Error("The upload was cancelled."));
    request.ontimeout = () => reject(new Error("An upload section timed out. Retrying may help."));
    request.onload = () => {
      try {
        const payload = parseApiPayload<ApiErrorPayload>(request.responseText, request.status, "Uploading media");
        if (request.status < 200 || request.status >= 300) {
          const suffix = payload.requestId ? ` Reference: ${payload.requestId}.` : "";
          reject(new Error(`${payload.error || "An upload section could not be stored."}${suffix}`));
          return;
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    request.send(part);
  });
}

async function uploadFileInParts(file: File, jobId: string, onProgress: (progress: number) => void) {
  const totalChunks = Math.ceil(file.size / UPLOAD_PART_BYTES);
  let reportedProgress = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * UPLOAD_PART_BYTES;
    const end = Math.min(file.size, start + UPLOAD_PART_BYTES);
    const part = file.slice(start, end);
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await uploadPart(part, jobId, chunkIndex, totalChunks, (partBytes) => {
          reportedProgress = Math.max(reportedProgress, (start + partBytes) / file.size);
          onProgress(reportedProgress);
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
      }
    }

    if (lastError) throw lastError;
    reportedProgress = Math.max(reportedProgress, end / file.size);
    onProgress(reportedProgress);
  }

  return totalChunks;
}

function createJobId() {
  return `job-${crypto.randomUUID()}`;
}

function formatTime(totalSeconds: number, compact = false) {
  const safe = Math.max(0, totalSeconds || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 10);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return compact ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}.${ms}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function getMediaDuration(file: File) {
  return new Promise<number>((resolve) => {
    const media = document.createElement(file.type.startsWith("audio") ? "audio" : "video");
    const url = URL.createObjectURL(file);
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      resolve(Number.isFinite(media.duration) ? media.duration : 0);
      URL.revokeObjectURL(url);
    };
    media.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(url);
    };
    media.src = url;
  });
}

function WelcomeView({
  mode,
  file,
  title,
  duration,
  error,
  onFile,
  onTitle,
  onAnalyze,
  onClear,
  onSample,
}: {
  mode: AppMode;
  file: File | null;
  title: string;
  duration: number;
  error: string;
  onFile: (file: File) => void;
  onTitle: (value: string) => void;
  onAnalyze: () => void;
  onClear: () => void;
  onSample: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };

  return (
    <main className="welcome-shell">
      <header className="welcome-nav">
        <BrandMark />
        <div className="welcome-nav-meta">
          <span className="status-dot"><i /> Local workspace</span>
          <button className="icon-button" aria-label="Settings"><Settings size={17} /></button>
          <span className="avatar">TR</span>
        </div>
      </header>

      <section className="welcome-main">
        <div className="welcome-copy">
          <p className="eyebrow"><span>TYSHONE ROLAND</span><i /> SERMON CLIP EDITOR</p>
          <h1>
            <span className="headline-line">Trim the sermon.</span>
            <span className="headline-line">Not the <em>spirit.</em></span>
          </h1>
          <p className="welcome-subtitle">Circumvision finds the moment, frames it right, and keeps the message intact.</p>
        </div>

        <div
          className={`drop-workspace ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="drop-shader" aria-hidden="true" />
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/webm"
            hidden
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const selected = event.target.files?.[0];
              if (selected) onFile(selected);
            }}
          />

          {!file ? (
            <button className="drop-prompt" onClick={() => inputRef.current?.click()}>
              <span className="upload-orbit"><Upload size={25} strokeWidth={1.7} /></span>
              <span className="drop-title">Drop a sermon here</span>
              <span className="drop-note">or click to choose a video</span>
              <span className="file-types">MP4 · MOV · WEBM · MP3 · WAV <i /> UP TO 2 GB</span>
            </button>
          ) : (
            <div className="selected-file">
              <div className="file-leading">
                <span className="file-icon"><Film size={21} /></span>
                <div>
                  <strong>{file.name}</strong>
                  <span>{formatFileSize(file.size)} {duration ? `· ${formatTime(duration, true)}` : ""}</span>
                </div>
              </div>
              <button className="clear-file" onClick={onClear} aria-label="Remove file"><X size={18} /></button>
              <label className="title-field">
                <span>SERMON TITLE</span>
                <input value={title} onChange={(event) => onTitle(event.target.value)} placeholder="Name this sermon" />
              </label>
              {error && <p className="form-error"><Info size={15} />{error}</p>}
              <button className="primary-button analyze-button" disabled={mode === "analyzing"} onClick={onAnalyze}>
                <WandSparkles size={17} /> Analyze sermon <span>↗</span>
              </button>
            </div>
          )}
        </div>

        <button className="sample-link" onClick={onSample}><Play size={12} fill="currentColor" /> Explore with a sample sermon</button>
      </section>

      <footer className="welcome-steps">
        <div><span>01</span><strong>Transcribe</strong><p>Speaker-aware transcript with precise timing.</p></div>
        <div><span>02</span><strong>Find moments</strong><p>AI ranks hooks that can stand on their own.</p></div>
        <div><span>03</span><strong>Finish & export</strong><p>Crop, caption, and render for every platform.</p></div>
        <small>BUILT FOR THE MESSAGE <Zap size={12} fill="currentColor" /></small>
      </footer>
    </main>
  );
}

function AnalyzingView({ fileName, step, progress, activeDetail }: { fileName: string; step: number; progress: number; activeDetail: string }) {
  const steps = [
    { label: "Preparing media", detail: "Compressing the audio track" },
    { label: "Transcribing sermon", detail: "Identifying speakers and timing" },
    { label: "Finding the hooks", detail: "Ranking complete, shareable moments" },
    { label: "Building your workspace", detail: "Preparing captions and formats" },
  ];
  const displayedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <main className="analysis-screen">
      <header><BrandMark /><span>AI EDIT IN PROGRESS</span></header>
      <div className="analysis-core">
        <span className="analysis-emblem"><Sparkles size={32} /></span>
        <p className="eyebrow">ANALYZING SERMON</p>
        <h1>Finding the moments<br />that <em>move people.</em></h1>
        <p className="analysis-file"><Film size={15} /> {fileName}</p>
        <div className="analysis-progress-meta">
          <span>OVERALL PROGRESS</span>
          <strong><b>{displayedProgress}</b>%</strong>
        </div>
        <div
          className="analysis-progress"
          role="progressbar"
          aria-label="Sermon analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayedProgress}
        >
          <i style={{ width: `${displayedProgress}%` }} />
        </div>
        <div className="analysis-checklist">
          {steps.map((item, index) => (
            <div key={item.label} className={index < step ? "done" : index === step ? "active" : ""}>
              <span>{index < step ? <Check size={14} /> : index === step ? <LoaderCircle className="spin" size={14} /> : index + 1}</span>
              <p><strong>{item.label}</strong><small>{index === step && activeDetail ? activeDetail : item.detail}</small></p>
            </div>
          ))}
        </div>
        <small className="analysis-note">Long sermons can take several minutes. Keep this tab open.</small>
      </div>
    </main>
  );
}

function ClipList({ clips, selectedId, onSelect }: { clips: ClipSuggestion[]; selectedId: string; onSelect: (clip: ClipSuggestion) => void }) {
  return (
    <aside className="clip-panel">
      <div className="clip-panel-head">
        <div><span>AI SELECTS</span><strong>{clips.length} moments found</strong></div>
        <button className="small-icon"><Search size={15} /></button>
      </div>
      <div className="clip-list">
        {clips.map((clip, index) => (
          <button key={clip.id} className={`clip-item ${clip.id === selectedId ? "selected" : ""}`} onClick={() => onSelect(clip)}>
            <span className="clip-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="clip-copy">
              <span className="clip-score"><Sparkles size={10} /> {clip.score}% MATCH</span>
              <strong>{clip.title}</strong>
              <p>“{clip.hook}”</p>
              <small><Clock3 size={11} /> {formatTime(clip.end - clip.start, true)} <i /> {clip.platform}</small>
            </div>
            <MoreHorizontal className="clip-more" size={16} />
          </button>
        ))}
      </div>
      <button className="add-clip"><Plus size={14} /> Create manual clip</button>
    </aside>
  );
}

function Inspector({
  tab,
  settings,
  selectedClip,
  transcriptText,
  onTab,
  onSettings,
  onClipChange,
}: {
  tab: InspectorTab;
  settings: RenderSettings;
  selectedClip: ClipSuggestion;
  transcriptText: string;
  onTab: (tab: InspectorTab) => void;
  onSettings: (updates: Partial<RenderSettings>) => void;
  onClipChange: (updates: Partial<ClipSuggestion>) => void;
}) {
  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        <button className={tab === "captions" ? "active" : ""} onClick={() => onTab("captions")}><Captions size={15} /> Captions</button>
        <button className={tab === "frame" ? "active" : ""} onClick={() => onTab("frame")}><Frame size={15} /> Frame</button>
        <button className={tab === "transcript" ? "active" : ""} onClick={() => onTab("transcript")}><Subtitles size={15} /> Script</button>
      </div>

      <div className="inspector-body">
        {tab === "captions" && (
          <>
            <section className="control-section">
              <div className="control-heading"><span>CAPTION STYLE</span><button><RotateCcw size={12} /> Reset</button></div>
              <div className="caption-presets">
                {(["bold", "clean", "minimal"] as CaptionPreset[]).map((preset) => (
                  <button key={preset} className={settings.captionPreset === preset ? "selected" : ""} onClick={() => onSettings({ captionPreset: preset })}>
                    <span className={`preset-preview ${preset}`}>{preset === "bold" ? "SAY IT" : preset === "clean" ? "Say it" : "say it"}</span>
                    <small>{preset}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="control-section">
              <div className="control-heading"><span>SIZE</span><b>{Math.round(settings.captionScale * 100)}%</b></div>
              <input className="range" type="range" min="0.7" max="1.35" step="0.05" value={settings.captionScale} onChange={(event) => onSettings({ captionScale: Number(event.target.value) })} />
              <div className="range-labels"><span>A</span><strong>A</strong></div>
            </section>

            <section className="control-section">
              <span className="section-label">POSITION</span>
              <div className="segmented">
                {(["middle", "bottom"] as CaptionPosition[]).map((position) => (
                  <button key={position} className={settings.captionPosition === position ? "active" : ""} onClick={() => onSettings({ captionPosition: position })}>
                    <AlignCenter size={13} /> {position}
                  </button>
                ))}
              </div>
            </section>

            <section className="control-section switches">
              <label><span><strong>Captions</strong><small>Burn text into the export</small></span><input type="checkbox" checked={settings.captionsEnabled} onChange={(event) => onSettings({ captionsEnabled: event.target.checked })} /><i /></label>
              <label><span><strong>Signal highlight</strong><small>Use the brand color on key text</small></span><input type="checkbox" checked={settings.highlight} onChange={(event) => onSettings({ highlight: event.target.checked })} /><i /></label>
            </section>
          </>
        )}

        {tab === "frame" && (
          <>
            <section className="control-section">
              <span className="section-label">ASPECT RATIO</span>
              <div className="aspect-options">
                {(["9:16", "4:5", "1:1"] as AspectRatio[]).map((aspect) => (
                  <button key={aspect} className={settings.aspect === aspect ? "selected" : ""} onClick={() => onSettings({ aspect })}>
                    <i className={`ratio-shape ratio-${aspect.replace(":", "-")}`} />
                    <strong>{aspect}</strong>
                    <small>{aspect === "9:16" ? "Reels / Shorts" : aspect === "4:5" ? "Instagram feed" : "Square feed"}</small>
                  </button>
                ))}
              </div>
            </section>
            <section className="control-section">
              <span className="section-label">SOURCE FIT</span>
              <div className="frame-modes">
                {(["fill", "fit"] as FrameMode[]).map((mode) => (
                  <button key={mode} className={settings.frameMode === mode ? "selected" : ""} onClick={() => onSettings({ frameMode: mode })}>
                    {mode === "fill" ? <Maximize2 size={18} /> : <LayoutTemplate size={18} />}
                    <span><strong>{mode === "fill" ? "Fill frame" : "Smart fit"}</strong><small>{mode === "fill" ? "Crop to the selected ratio" : "Keep the full frame with a soft backdrop"}</small></span>
                  </button>
                ))}
              </div>
            </section>
            <p className="inspector-tip"><Sparkles size={14} /> Smart fit keeps the speaker visible when the source was shot wide.</p>
          </>
        )}

        {tab === "transcript" && (
          <>
            <section className="control-section">
              <span className="section-label">CLIP TITLE</span>
              <input className="text-control" value={selectedClip.title} onChange={(event) => onClipChange({ title: event.target.value })} />
            </section>
            <section className="control-section time-controls">
              <label><span>START</span><input type="number" step="0.1" value={selectedClip.start.toFixed(1)} onChange={(event) => onClipChange({ start: Number(event.target.value) })} /></label>
              <label><span>END</span><input type="number" step="0.1" value={selectedClip.end.toFixed(1)} onChange={(event) => onClipChange({ end: Number(event.target.value) })} /></label>
            </section>
            <section className="control-section">
              <div className="control-heading"><span>SELECTED TRANSCRIPT</span><b>{Math.round(selectedClip.end - selectedClip.start)} SEC</b></div>
              <div className="transcript-editor">{transcriptText || "No transcript falls inside this range."}</div>
            </section>
            <p className="inspector-tip"><Info size={14} /> Timing edits update the preview and final render. Transcript text comes from the speaker-aware analysis.</p>
          </>
        )}
      </div>
    </aside>
  );
}

function Timeline({
  analysis,
  selectedClip,
  currentTime,
  playing,
  onSeek,
}: {
  analysis: AnalysisResult;
  selectedClip: ClipSuggestion;
  currentTime: number;
  playing: boolean;
  onSeek: (time: number) => void;
}) {
  const windowStart = Math.max(0, selectedClip.start - 12);
  const windowEnd = Math.min(analysis.duration, selectedClip.end + 12);
  const windowDuration = Math.max(1, windowEnd - windowStart);
  const selectionLeft = ((selectedClip.start - windowStart) / windowDuration) * 100;
  const selectionWidth = ((selectedClip.end - selectedClip.start) / windowDuration) * 100;
  const playhead = ((Math.max(windowStart, Math.min(windowEnd, currentTime)) - windowStart) / windowDuration) * 100;
  const ticks = Array.from({ length: 7 }, (_, index) => windowStart + (windowDuration * index) / 6);
  const waveform = Array.from({ length: 120 }, (_, index) => 18 + ((index * 17 + index * index * 3) % 64));

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(windowStart + ratio * windowDuration);
  };

  return (
    <section className={`timeline ${playing ? "is-playing" : ""}`}>
      <div className="timeline-toolbar">
        <div><Scissors size={14} /><strong>{selectedClip.title}</strong><span>{formatTime(selectedClip.end - selectedClip.start, true)}</span></div>
        <div><button><RotateCcw size={13} /></button><button><Gauge size={13} /> 100%</button><button><ChevronDown size={13} /></button></div>
      </div>
      <div className="ruler">{ticks.map((tick) => <span key={tick} style={{ left: `${((tick - windowStart) / windowDuration) * 100}%` }}>{formatTime(tick, true)}</span>)}</div>
      <div className="timeline-track" onClick={seek}>
        <div className="waveform">{waveform.map((height, index) => <i key={index} style={{ height: `${height}%`, animationDelay: `${-(index % 12) * 0.07}s` }} />)}</div>
        <div className="clip-selection" style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}><i /><i /></div>
        <div className="playhead" style={{ left: `${playhead}%` }}><i /></div>
      </div>
      <div className="timeline-script">
        <span className="track-label"><Subtitles size={12} /> TEXT</span>
        <div className="script-row">
          {analysis.transcript.filter((segment) => segment.end > windowStart && segment.start < windowEnd).map((segment) => {
            const left = ((Math.max(windowStart, segment.start) - windowStart) / windowDuration) * 100;
            const width = ((Math.min(windowEnd, segment.end) - Math.max(windowStart, segment.start)) / windowDuration) * 100;
            return <button key={segment.id} style={{ left: `${left}%`, width: `${Math.max(1.4, width)}%` }} onClick={(event) => { event.stopPropagation(); onSeek(segment.start); }}>{segment.text}</button>;
          })}
        </div>
      </div>
    </section>
  );
}

function EditorView({
  analysis,
  sourceFile,
  videoUrl,
  onBack,
}: {
  analysis: AnalysisResult;
  sourceFile: File | null;
  videoUrl: string | null;
  onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState(analysis.clips[0]?.id || "");
  const [clips, setClips] = useState(analysis.clips);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("captions");
  const [currentTime, setCurrentTime] = useState(analysis.clips[0]?.start || 0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectedClip = clips.find((clip) => clip.id === selectedId) || clips[0];

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!playing || videoUrl || !selectedClip) return;
    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        if (time >= selectedClip.end) {
          setPlaying(false);
          return selectedClip.start;
        }
        return time + 0.1;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, videoUrl, selectedClip]);

  const currentCaption = useMemo(() => {
    if (!selectedClip) return null;
    return analysis.transcript.find((segment) => currentTime >= segment.start && currentTime <= segment.end)
      || analysis.transcript.find((segment) => segment.start >= selectedClip.start && segment.end <= selectedClip.end)
      || null;
  }, [analysis.transcript, currentTime, selectedClip]);

  const selectedTranscript = useMemo(() => {
    if (!selectedClip) return "";
    return analysis.transcript
      .filter((segment) => segment.end > selectedClip.start && segment.start < selectedClip.end)
      .map((segment) => segment.text)
      .join(" ");
  }, [analysis.transcript, selectedClip]);

  if (!selectedClip) return null;

  const selectClip = (clip: ClipSuggestion) => {
    setSelectedId(clip.id);
    setCurrentTime(clip.start);
    setPlaying(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = clip.start;
    }
  };

  const seek = (time: number) => {
    const safe = Math.max(0, Math.min(analysis.duration, time));
    setCurrentTime(safe);
    if (videoRef.current) videoRef.current.currentTime = safe;
  };

  const togglePlay = async () => {
    if (videoRef.current) {
      if (playing) {
        videoRef.current.pause();
        setPlaying(false);
      } else {
        if (videoRef.current.currentTime < selectedClip.start || videoRef.current.currentTime >= selectedClip.end) seek(selectedClip.start);
        try {
          await videoRef.current.play();
          setPlaying(true);
        } catch {
          setToast("The browser could not start video playback.");
        }
      }
    } else {
      setPlaying((value) => !value);
    }
  };

  const updateClip = (updates: Partial<ClipSuggestion>) => {
    setClips((items) => items.map((clip) => clip.id === selectedClip.id ? { ...clip, ...updates } : clip));
  };

  const exportClip = async () => {
    if (!sourceFile) {
      setToast("Sample mode is for exploration. Upload a sermon to render an MP4.");
      return;
    }
    setExporting(true);
    try {
      const form = new FormData();
      form.append("file", sourceFile);
      form.append("start", String(selectedClip.start));
      form.append("end", String(selectedClip.end));
      form.append("transcript", JSON.stringify(analysis.transcript));
      form.append("settings", JSON.stringify(settings));
      const response = await fetch("/api/render", { method: "POST", body: form });
      if (!response.ok) {
        const payload = await readApiPayload<ApiErrorPayload>(response, "Export");
        const suffix = payload.requestId ? ` Reference: ${payload.requestId}.` : "";
        throw new Error(`${payload.error || "The render did not finish."}${suffix}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedClip.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sermon-short"}.mp4`;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast("Your captioned MP4 is ready.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The clip could not be exported.");
    } finally {
      setExporting(false);
    }
  };

  const captionWords = (currentCaption?.text || selectedClip.hook).split(/\s+/);
  const splitAt = Math.max(1, captionWords.length - 2);

  return (
    <main className="editor-shell">
      <nav className="rail">
        <BrandMark compact />
        <div className="rail-main">
          <button className="active" aria-label="Editor"><Home size={18} /></button>
          <button aria-label="Projects"><FolderOpen size={18} /></button>
          <button aria-label="History"><History size={18} /></button>
        </div>
        <div className="rail-foot">
          <button aria-label="Settings"><Settings size={18} /></button>
          <span className="avatar">TR</span>
        </div>
      </nav>

      <div className="editor-main">
        <header className="editor-header">
          <div className="project-breadcrumb">
            <button onClick={onBack} aria-label="Back to upload"><ArrowLeft size={16} /></button>
            <div><span>PROJECT / SERMON</span><strong>{analysis.title}</strong></div>
            <button className="small-icon"><ChevronDown size={14} /></button>
          </div>
          <div className="editor-actions">
            <span className="saved-state"><Check size={12} /> Session ready</span>
            <button className="secondary-button"><Plus size={15} /> New project</button>
            <button className="export-button" disabled={exporting} onClick={exportClip}>
              {exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
              {exporting ? "Rendering…" : "Export clip"}
            </button>
          </div>
        </header>

        <div className="workspace">
          <ClipList clips={clips} selectedId={selectedId} onSelect={selectClip} />

          <section className="canvas-area">
            <div className="canvas-toolbar">
              <div className="aspect-switcher">
                {(["9:16", "4:5", "1:1"] as AspectRatio[]).map((aspect) => (
                  <button key={aspect} className={settings.aspect === aspect ? "active" : ""} onClick={() => setSettings((value) => ({ ...value, aspect }))}>
                    <i className={`ratio-shape ratio-${aspect.replace(":", "-")}`} /> {aspect}
                  </button>
                ))}
              </div>
              <button className="canvas-fit"><Maximize2 size={13} /> Fit <ChevronDown size={12} /></button>
            </div>

            <div className="stage-wrap">
              <div className={`video-stage aspect-${settings.aspect.replace(":", "-")} ${settings.frameMode === "fit" ? "smart-fit" : ""} ${playing ? "is-playing" : ""}`}>
                {videoUrl ? (
                  <>
                    {settings.frameMode === "fit" && <video className="blur-layer" src={videoUrl} muted aria-hidden="true" />}
                    <video
                      ref={videoRef}
                      className="source-video"
                      src={videoUrl}
                      preload="metadata"
                      onTimeUpdate={(event) => {
                        const time = event.currentTarget.currentTime;
                        setCurrentTime(time);
                        if (time >= selectedClip.end) {
                          event.currentTarget.pause();
                          setPlaying(false);
                        }
                      }}
                      onPause={() => setPlaying(false)}
                      onPlay={() => setPlaying(true)}
                    />
                  </>
                ) : (
                  <div className="demo-scene">
                    <div className="demo-light" /><div className="demo-window" /><div className="demo-figure"><i /><b /></div>
                    <span className="demo-tag">TYSHONE ROLAND</span>
                  </div>
                )}
                <div className="stage-vignette" />
                {settings.captionsEnabled && (
                  <div key={currentCaption?.id || selectedClip.id} className={`caption-overlay ${settings.captionPreset} ${settings.captionPosition}`} style={{ transform: `scale(${settings.captionScale})` }}>
                    <span>{captionWords.slice(0, splitAt).join(" ")} </span>
                    <mark className={settings.highlight ? "" : "plain"}>{captionWords.slice(splitAt).join(" ")}</mark>
                  </div>
                )}
                <div className="safe-zone"><span>SAFE ZONE</span></div>
              </div>
            </div>

            <div className="player-controls">
              <div className="player-time"><strong>{formatTime(currentTime - selectedClip.start)}</strong><span>/ {formatTime(selectedClip.end - selectedClip.start)}</span></div>
              <button className="play-button" aria-label={playing ? "Pause clip" : "Play clip"} onClick={togglePlay}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
              <div className="player-right"><button><Captions size={15} /></button><button><Maximize2 size={15} /></button></div>
            </div>
          </section>

          <Inspector
            tab={inspectorTab}
            settings={settings}
            selectedClip={selectedClip}
            transcriptText={selectedTranscript}
            onTab={setInspectorTab}
            onSettings={(updates) => setSettings((value) => ({ ...value, ...updates }))}
            onClipChange={updateClip}
          />
        </div>

        <Timeline analysis={analysis} selectedClip={selectedClip} currentTime={currentTime} playing={playing} onSeek={seek} />
      </div>
      {toast && <div className="toast"><Check size={15} /> {toast}<button onClick={() => setToast("")}><X size={14} /></button></div>}
    </main>
  );
}

export function StudioApp() {
  const [mode, setMode] = useState<AppMode>("welcome");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [analysisStep, setAnalysisStep] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisDetail, setAnalysisDetail] = useState("Uploading sermon · 0% uploaded");

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const chooseFile = async (selected: File) => {
    if (!selected.type.startsWith("video") && !selected.type.startsWith("audio")) {
      setError("Choose a supported video or audio file.");
      return;
    }
    if (selected.size > 2 * 1024 * 1024 * 1024) {
      setError("This local build accepts files up to 2 GB.");
      return;
    }
    setFile(selected);
    setError("");
    setTitle(selected.name.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " "));
    setDuration(await getMediaDuration(selected));
    setMode("ready");
  };

  const clearFile = () => {
    setFile(null);
    setDuration(0);
    setTitle("");
    setError("");
    setMode("welcome");
  };

  const analyze = async () => {
    if (!file) return;
    setAnalysisStep(0);
    setAnalysisProgress(0);
    setAnalysisDetail("Uploading sermon · 0% uploaded");
    setMode("analyzing");
    setError("");
    let activeJobId = "";
    try {
      activeJobId = createJobId();
      const totalUploadChunks = await uploadFileInParts(file, activeJobId, (uploadProgress) => {
        const uploadedPercent = Math.round(uploadProgress * 100);
        setAnalysisProgress(Math.round(uploadProgress * 12));
        setAnalysisDetail(`Uploading sermon · ${uploadedPercent}% uploaded`);
      });
      setAnalysisProgress(12);
      setAnalysisDetail("Extracting and optimizing the audio track");

      const startResponse = await fetch("/api/analyze/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: activeJobId,
          title,
          fileName: file.name,
          fileSize: file.size,
          totalChunks: totalUploadChunks,
        }),
      });
      const startPayload = await readApiPayload<AnalysisJobStartPayload>(startResponse, "Preparing media");
      if (!startResponse.ok) {
        const suffix = startPayload.requestId ? ` Reference: ${startPayload.requestId}.` : "";
        throw new Error(`${startPayload.error || "The sermon could not be prepared."}${suffix}`);
      }

      activeJobId = startPayload.jobId;
      setAnalysisStep(1);
      setAnalysisProgress(18);

      for (let chunkIndex = 0; chunkIndex < startPayload.totalChunks; chunkIndex += 1) {
        setAnalysisDetail(`Transcribing section ${chunkIndex + 1} of ${startPayload.totalChunks}`);
        const chunkResponse = await fetch("/api/analyze/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: activeJobId, chunkIndex }),
        });
        const chunkPayload = await readApiPayload<AnalysisChunkPayload>(chunkResponse, "Transcription");
        if (!chunkResponse.ok) {
          const suffix = chunkPayload.requestId ? ` Reference: ${chunkPayload.requestId}.` : "";
          throw new Error(`${chunkPayload.error || "Part of the sermon could not be transcribed."}${suffix}`);
        }
        const transcriptProgress = chunkPayload.totalDuration > 0
          ? chunkPayload.completedDuration / chunkPayload.totalDuration
          : chunkPayload.completedChunks / chunkPayload.totalChunks;
        setAnalysisProgress(18 + Math.round(Math.max(0, Math.min(1, transcriptProgress)) * 64));
      }

      setAnalysisStep(2);
      setAnalysisProgress(82);
      setAnalysisDetail("Ranking complete moments with strong hooks");
      const finishResponse = await fetch("/api/analyze/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      });
      const payload = await readApiPayload<AnalysisResult>(finishResponse, "Finding clips");
      if (!finishResponse.ok) {
        const suffix = payload.requestId ? ` Reference: ${payload.requestId}.` : "";
        throw new Error(`${payload.error || "The strongest clips could not be selected."}${suffix}`);
      }
      activeJobId = "";
      if (!payload.clips?.length) throw new Error("The transcript completed, but no complete clip moments were found.");
      setAnalysisStep(3);
      setAnalysisProgress(96);
      setAnalysisDetail("Preparing captions and editor controls");
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setAnalysis(payload as AnalysisResult);
      setAnalysisProgress(100);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setMode("editor");
    } catch (caught) {
      if (activeJobId) {
        await fetch(`/api/analyze/start?jobId=${encodeURIComponent(activeJobId)}`, { method: "DELETE" }).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : "The sermon could not be analyzed.");
      setMode("ready");
    }
  };

  const openSample = () => {
    setAnalysis(DEMO_ANALYSIS);
    setVideoUrl(null);
    setFile(null);
    setMode("editor");
  };

  const backToWelcome = () => {
    setAnalysis(null);
    setVideoUrl(null);
    clearFile();
  };

  if (mode === "analyzing") return <AnalyzingView fileName={file?.name || "Sermon"} step={analysisStep} progress={analysisProgress} activeDetail={analysisDetail} />;
  if (mode === "editor" && analysis) return <EditorView analysis={analysis} sourceFile={file} videoUrl={videoUrl} onBack={backToWelcome} />;
  return (
    <WelcomeView
      mode={mode}
      file={file}
      title={title}
      duration={duration}
      error={error}
      onFile={chooseFile}
      onTitle={setTitle}
      onAnalyze={analyze}
      onClear={clearFile}
      onSample={openSample}
    />
  );
}
