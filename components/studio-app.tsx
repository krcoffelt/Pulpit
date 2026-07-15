"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  ArrowLeft,
  Captions,
  Check,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Frame,
  Home,
  Info,
  LayoutTemplate,
  LoaderCircle,
  LogOut,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Subtitles,
  Trash2,
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
  ClipTargetDuration,
  CircumvisionProject,
  FrameMode,
  RenderSettings,
  ProjectSummary,
  ProjectExport,
  TranscriptSegment,
} from "@/lib/types";

type AppMode = "welcome" | "ready" | "analyzing" | "editor" | "projects";
type InspectorTab = "captions" | "frame" | "transcript";

const DEFAULT_SETTINGS: RenderSettings = {
  aspect: "9:16",
  captionPreset: "bold",
  captionPosition: "bottom",
  captionScale: 1,
  captionsEnabled: true,
  highlight: true,
  frameMode: "fill",
  frameX: 0,
  frameY: 0,
};

type ApiErrorPayload = {
  error?: string;
  requestId?: string;
};

type ProjectCreationPayload = {
  project: CircumvisionProject;
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
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => request.abort();
    if (signal?.aborted) {
      reject(new DOMException("The upload was cancelled.", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    request.open("POST", "/api/uploads");
    request.timeout = 60_000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("x-project-id", jobId);
    request.setRequestHeader("x-chunk-index", String(chunkIndex));
    request.setRequestHeader("x-total-chunks", String(totalChunks));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded);
      }
    };
    request.onerror = () => { cleanup(); reject(new Error("The upload was interrupted. Check your connection and try again.")); };
    request.onabort = () => { cleanup(); reject(new DOMException("The upload was cancelled.", "AbortError")); };
    request.ontimeout = () => { cleanup(); reject(new Error("An upload section timed out. Retrying may help.")); };
    request.onload = () => {
      cleanup();
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

async function uploadFileInParts(
  file: File,
  jobId: string,
  onProgress: (progress: number) => void,
  completedParts: number[] = [],
  signal?: AbortSignal,
) {
  const totalChunks = Math.ceil(file.size / UPLOAD_PART_BYTES);
  const completed = new Set(completedParts);
  let reportedProgress = completed.size / totalChunks;
  onProgress(reportedProgress);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    if (signal?.aborted) throw new DOMException("The upload was cancelled.", "AbortError");
    if (completed.has(chunkIndex)) continue;
    const start = chunkIndex * UPLOAD_PART_BYTES;
    const end = Math.min(file.size, start + UPLOAD_PART_BYTES);
    const part = file.slice(start, end);
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await uploadPart(part, jobId, chunkIndex, totalChunks, (partBytes) => {
          reportedProgress = Math.max(reportedProgress, (start + partBytes) / file.size);
          onProgress(reportedProgress);
        }, signal);
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
  targetDuration,
  error,
  onFile,
  onTitle,
  onTargetDuration,
  onAnalyze,
  onClear,
  onSample,
}: {
  mode: AppMode;
  file: File | null;
  title: string;
  duration: number;
  targetDuration: ClipTargetDuration;
  error: string;
  onFile: (file: File) => void;
  onTitle: (value: string) => void;
  onTargetDuration: (value: ClipTargetDuration) => void;
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
            accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/webm"
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
              <span className="file-types">MP4 · MOV · WEBM · MP3 · M4A · WAV <i /> UP TO 2 GB</span>
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
              <div className="target-length">
                <span>TARGET CLIP LENGTH</span>
                <div>{([15, 30, 45, 60] as ClipTargetDuration[]).map((seconds) => <button key={seconds} className={targetDuration === seconds ? "active" : ""} onClick={() => onTargetDuration(seconds)}>{seconds}s</button>)}</div>
              </div>
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

function AnalyzingView({ fileName, step, progress, activeDetail, onCancel }: { fileName: string; step: number; progress: number; activeDetail: string; onCancel: () => void }) {
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
        <small className="analysis-note">Processing continues safely if you leave or refresh this page.</small>
        <button className="analysis-cancel" onClick={onCancel}>Pause and return to projects</button>
      </div>
    </main>
  );
}

type AuthFlow = "login" | "request-recovery" | "invite-password" | "recovery-password" | "processing";

function SignInView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [flow, setFlow] = useState<AuthFlow>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!/^#(confirmation_token|recovery_token|invite_token|email_change_token|access_token)=/.test(window.location.hash)) return;
    void import("@netlify/identity").then(async ({ handleAuthCallback }) => {
      setFlow("processing");
      try {
        const result = await handleAuthCallback();
        if (result?.type === "invite" && result.token) {
          setInviteToken(result.token);
          setFlow("invite-password");
          return;
        }
        if (result?.type === "recovery") {
          setFlow("recovery-password");
          return;
        }
        window.location.replace("/");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The sign-in link could not be completed.");
        setFlow("login");
      }
    });
  }, []);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { login } = await import("@netlify/identity");
      await login(email.trim(), password);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
      setBusy(false);
    }
  };

  const sendRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { requestPasswordRecovery } = await import("@netlify/identity");
      await requestPasswordRecovery(email.trim());
      setNotice("If that email belongs to an invited account, a password-reset link is on its way.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The password-reset email could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const finishPasswordSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const identity = await import("@netlify/identity");
      if (flow === "invite-password") {
        if (!inviteToken) throw new Error("This invitation link is incomplete. Open the invitation email again.");
        await identity.acceptInvite(inviteToken, password);
      } else {
        await identity.updateUser({ password });
      }
      window.location.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The password could not be saved.");
      setBusy(false);
    }
  };

  const showLogin = () => {
    setFlow("login");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setNotice("");
  };

  const settingPassword = flow === "invite-password" || flow === "recovery-password";
  const heading = flow === "invite-password" ? <>Create your<br /><em>password.</em></>
    : flow === "recovery-password" ? <>Choose a new<br /><em>password.</em></>
      : flow === "request-recovery" ? <>Reset your<br /><em>password.</em></>
        : <>Sign in to<br /><em>Circumvision.</em></>;
  const description = flow === "invite-password"
    ? "Finish accepting your invitation to enter Tyshone's private workspace."
    : flow === "recovery-password"
      ? "Set a new password to finish recovering your Circumvision account."
      : flow === "request-recovery"
        ? "Enter the email that received the Circumvision invitation."
        : "Your sermons, transcripts, edits, and exports stay inside your private workspace.";

  if (flow === "processing") {
    return <main className="app-loading"><BrandMark /><LoaderCircle className="spin" size={24} /><span>Verifying your secure link</span></main>;
  }

  return (
    <main className="auth-shell">
      <header className="welcome-nav"><BrandMark /></header>
      <section className="auth-panel">
        <p className="eyebrow"><span>PRIVATE WORKSPACE</span><i /> TYSHONE ROLAND</p>
        <h1>{heading}</h1>
        <p>{description}</p>
        <form onSubmit={settingPassword ? finishPasswordSetup : flow === "request-recovery" ? sendRecovery : signIn}>
          {!settingPassword && <label><span>Email</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          {flow !== "request-recovery" && <label><span>{settingPassword ? "New password" : "Password"}</span><input required minLength={settingPassword ? 8 : undefined} type="password" autoComplete={settingPassword ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          {settingPassword && <label><span>Confirm password</span><input required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
          {error && <div className="form-error"><Info size={15} /> {error}</div>}
          {notice && <div className="form-success"><Check size={15} /> {notice}</div>}
          <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Scissors size={17} />} {busy ? "Working…" : settingPassword ? "Save password" : flow === "request-recovery" ? "Send reset link" : "Sign in"}</button>
        </form>
        {flow === "login"
          ? <button className="auth-link" type="button" onClick={() => { setFlow("request-recovery"); setError(""); }}>Forgot your password?</button>
          : flow === "request-recovery" && <button className="auth-link" type="button" onClick={showLogin}>Return to sign in</button>}
      </section>
    </main>
  );
}

function AccessDeniedView() {
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    const { logout } = await import("@netlify/identity");
    await logout().catch(() => undefined);
    window.location.reload();
  };

  return (
    <main className="auth-shell">
      <header className="welcome-nav"><BrandMark /></header>
      <section className="auth-panel">
        <p className="eyebrow"><span>PRIVATE WORKSPACE</span><i /> INVITE REQUIRED</p>
        <h1>This account isn&apos;t<br /><em>on the list.</em></h1>
        <p>Circumvision only accepts accounts invited by the workspace owner. Ask for an invitation, then sign in with that email.</p>
        <button className="primary-button" disabled={busy} onClick={signOut}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <LogOut size={17} />} {busy ? "Signing out…" : "Sign out and use another account"}
        </button>
      </section>
    </main>
  );
}

function ProjectsView({
  projects,
  loading,
  onNew,
  onOpen,
  onDelete,
  onRefresh,
  onLogout,
}: {
  projects: ProjectSummary[];
  loading: boolean;
  onNew: () => void;
  onOpen: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <main className="projects-shell">
      <header className="welcome-nav">
        <BrandMark />
        <div className="welcome-nav-meta">
          <span className="status-dot"><i /> Private workspace</span>
          <button className="icon-button" onClick={onRefresh} aria-label="Refresh projects"><RotateCcw size={17} /></button>
          <button className="icon-button" onClick={onLogout} aria-label="Sign out"><LogOut size={17} /></button>
          <span className="avatar">TR</span>
        </div>
      </header>
      <section className="projects-main">
        <div className="projects-heading">
          <div><p className="eyebrow"><span>TYSHONE ROLAND</span><i /> PROJECTS</p><h1>Sermon workspace</h1><p>Return to an edit, monitor processing, or start with a new message.</p></div>
          <button className="primary-button" onClick={onNew}><Plus size={17} /> New sermon</button>
        </div>
        <div className="project-table" aria-busy={loading}>
          <div className="project-table-head"><span>PROJECT</span><span>STATUS</span><span>UPDATED</span><span>OUTPUT</span><span /></div>
          {loading ? (
            <div className="project-empty"><LoaderCircle className="spin" size={22} /><strong>Loading projects</strong></div>
          ) : projects.length ? projects.map((project) => (
            <article className="project-row" key={project.id}>
              <button className="project-open" onClick={() => onOpen(project)} aria-label={`Open ${project.title}`}>
                <span className="project-symbol"><Film size={17} /></span>
                <span><strong>{project.title}</strong><small>{project.source.fileName} · {formatFileSize(project.source.fileSize)}{project.duration ? ` · ${formatTime(project.duration, true)}` : ""}</small></span>
              </button>
              <div className={`project-status status-${project.status}`}><i /><span><strong>{project.status}</strong><small>{project.stage}</small></span></div>
              <time dateTime={project.updatedAt}>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(project.updatedAt))}</time>
              <span className="project-output">{project.exports.filter((item) => item.status === "ready").length} exports<small>{project.clipCount} clips</small></span>
              <button className="project-delete" onClick={() => onDelete(project)} aria-label={`Delete ${project.title}`}><Trash2 size={15} /></button>
              {project.progress < 100 && <span className="project-progress"><i style={{ width: `${project.progress}%` }} /></span>}
            </article>
          )) : (
            <div className="project-empty"><Scissors size={24} /><strong>No sermons yet</strong><p>Upload the first message to create its transcript and clips.</p><button onClick={onNew}>Start a project</button></div>
          )}
        </div>
      </section>
    </main>
  );
}

function ClipList({ clips, selectedId, regenerating, onSelect, onRegenerate, onCreate }: {
  clips: ClipSuggestion[];
  selectedId: string;
  regenerating: boolean;
  onSelect: (clip: ClipSuggestion) => void;
  onRegenerate: () => void;
  onCreate: () => void;
}) {
  return (
    <aside className="clip-panel">
      <div className="clip-panel-head">
        <div><span>AI SELECTS</span><strong>{clips.length} moments found</strong></div>
        <button className="small-icon" disabled={regenerating} onClick={onRegenerate} aria-label="Regenerate clip suggestions" title="Regenerate suggestions">{regenerating ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}</button>
      </div>
      <div className="clip-list">
        {clips.map((clip, index) => (
          <button key={clip.id} className={`clip-item ${clip.id === selectedId ? "selected" : ""}`} onClick={() => onSelect(clip)}>
            <span className="clip-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="clip-copy">
              <span className="clip-score"><Sparkles size={10} /> {clip.score}% MATCH</span>
              <strong>{clip.title}</strong>
              <p>“{clip.hook}”</p>
              <small className="clip-reason">{clip.reason}</small>
              <small><Clock3 size={11} /> {formatTime(clip.end - clip.start, true)} <i /> {clip.platform}</small>
            </div>
          </button>
        ))}
      </div>
      <button className="add-clip" onClick={onCreate}><Plus size={14} /> Create manual clip</button>
    </aside>
  );
}

function Inspector({
  tab,
  settings,
  selectedClip,
  transcript,
  onTab,
  onSettings,
  onClipChange,
  onTranscriptChange,
  onResetSettings,
  exports,
  onDownloadExport,
  onCancelExport,
  mobileOpen,
  onMobileClose,
}: {
  tab: InspectorTab;
  settings: RenderSettings;
  selectedClip: ClipSuggestion;
  transcript: TranscriptSegment[];
  onTab: (tab: InspectorTab) => void;
  onSettings: (updates: Partial<RenderSettings>) => void;
  onClipChange: (updates: Partial<ClipSuggestion>) => void;
  onTranscriptChange: (segmentId: string, text: string) => void;
  onResetSettings: () => void;
  exports: ProjectExport[];
  onDownloadExport: (item: ProjectExport) => void;
  onCancelExport: (item: ProjectExport) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const selectedSegments = transcript.filter((segment) => segment.end > selectedClip.start && segment.start < selectedClip.end);

  return (
    <aside className={`inspector ${mobileOpen ? "mobile-open" : ""}`}>
      <button className="inspector-close" aria-label="Close editing tools" onClick={onMobileClose}><X size={18} /></button>
      <div className="inspector-tabs">
        <button className={tab === "captions" ? "active" : ""} onClick={() => onTab("captions")}><Captions size={15} /> Captions</button>
        <button className={tab === "frame" ? "active" : ""} onClick={() => onTab("frame")}><Frame size={15} /> Frame</button>
        <button className={tab === "transcript" ? "active" : ""} onClick={() => onTab("transcript")}><Subtitles size={15} /> Script</button>
      </div>

      <div className="inspector-body">
        {tab === "captions" && (
          <>
            <section className="control-section">
              <div className="control-heading"><span>CAPTION STYLE</span><button onClick={onResetSettings}><RotateCcw size={12} /> Reset</button></div>
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
                    <span><strong>{mode === "fill" ? "Fill frame" : "Full frame"}</strong><small>{mode === "fill" ? "Crop to the selected ratio" : "Keep the full frame with a soft backdrop"}</small></span>
                  </button>
                ))}
              </div>
            </section>
            <section className="control-section frame-position">
              <div className="control-heading"><span>MANUAL REFRAME</span><button onClick={() => onSettings({ frameX: 0, frameY: 0 })}><RotateCcw size={12} /> Center</button></div>
              <label><span>Horizontal <b>{settings.frameX > 0 ? "+" : ""}{settings.frameX}</b></span><input className="range" type="range" min="-100" max="100" step="5" value={settings.frameX} onChange={(event) => onSettings({ frameX: Number(event.target.value) })} /></label>
              <label><span>Vertical <b>{settings.frameY > 0 ? "+" : ""}{settings.frameY}</b></span><input className="range" type="range" min="-100" max="100" step="5" value={settings.frameY} onChange={(event) => onSettings({ frameY: Number(event.target.value) })} /></label>
            </section>
            <p className="inspector-tip"><Sparkles size={14} /> Use Full frame to preserve the whole shot or move the crop manually to keep the speaker centered.</p>
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
              <div className="transcript-editor">
                {selectedSegments.length ? selectedSegments.map((segment) => (
                  <label key={segment.id} className="transcript-segment">
                    <span>{segment.speaker} · {formatTime(segment.start, true)}</span>
                    <textarea
                      value={segment.text}
                      rows={Math.max(2, Math.ceil(segment.text.length / 42))}
                      onChange={(event) => onTranscriptChange(segment.id, event.target.value)}
                    />
                  </label>
                )) : "No transcript falls inside this range."}
              </div>
            </section>
            <p className="inspector-tip"><Info size={14} /> Corrections keep the original timing and are used for captions and final rendering.</p>
          </>
        )}
        {exports.length > 0 && (
          <section className="control-section export-history">
            <div className="control-heading"><span>FINISHED EXPORTS</span><b>{exports.filter((item) => item.status === "ready").length} READY</b></div>
            <div>
              {exports.slice(0, 5).map((item) => (
                <div className="export-row" key={item.id}>
                  <button disabled={item.status !== "ready"} onClick={() => onDownloadExport(item)}>
                    <span><strong>{item.aspect}</strong><small>{item.status === "ready" && item.fileSize ? formatFileSize(item.fileSize) : item.status}</small></span>
                    {item.status === "ready" ? <Download size={14} /> : item.status === "failed" || item.status === "cancelled" ? <Info size={14} /> : <LoaderCircle className="spin" size={14} />}
                  </button>
                  {(item.status === "queued" || item.status === "rendering") && <button className="cancel-export" aria-label={`Cancel ${item.aspect} export`} onClick={() => onCancelExport(item)}><X size={13} /></button>}
                </div>
              ))}
            </div>
          </section>
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
  onReset,
}: {
  analysis: AnalysisResult;
  selectedClip: ClipSuggestion;
  currentTime: number;
  playing: boolean;
  onSeek: (time: number) => void;
  onReset: () => void;
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
        <div><button onClick={onReset}><RotateCcw size={13} /> Reset timing</button></div>
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
  projectId,
  initialEditor,
  initialExports,
  videoUrl,
  onBack,
  onNew,
}: {
  analysis: AnalysisResult;
  projectId: string | null;
  initialEditor?: CircumvisionProject["editor"];
  initialExports?: ProjectExport[];
  videoUrl: string | null;
  onBack: () => void;
  onNew: () => void;
}) {
  const [selectedId, setSelectedId] = useState(initialEditor?.selectedClipId || analysis.clips[0]?.id || "");
  const [clips, setClips] = useState(initialEditor?.clips || analysis.clips);
  const [transcript, setTranscript] = useState(initialEditor?.transcript || analysis.transcript);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...initialEditor?.settings });
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("captions");
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(analysis.clips[0]?.start || 0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exports, setExports] = useState(initialExports || []);
  const [toast, setToast] = useState("");
  const [saveState, setSaveState] = useState(projectId ? "Saved" : "Sample project");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const selectedClip = clips.find((clip) => clip.id === selectedId) || clips[0];

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSaveState("Saving…");
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ editor: { clips, transcript, settings, selectedClipId: selectedId } }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await readApiPayload<ApiErrorPayload>(response, "Autosave");
          throw new Error(payload.error || "Autosave failed.");
        }
        setSaveState("Saved");
      } catch (error) {
        if (controller.signal.aborted) return;
        setSaveState("Save failed");
        setToast(error instanceof Error ? error.message : "The editor changes could not be saved.");
      }
    }, 700);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [clips, projectId, selectedId, settings, transcript]);

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
    return transcript.find((segment) => currentTime >= segment.start && currentTime <= segment.end)
      || transcript.find((segment) => segment.start >= selectedClip.start && segment.end <= selectedClip.end)
      || null;
  }, [currentTime, selectedClip, transcript]);

  const workingAnalysis = useMemo(() => ({ ...analysis, clips, transcript }), [analysis, clips, transcript]);

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

  const resetSelectedClip = () => {
    const original = analysis.clips.find((clip) => clip.id === selectedClip.id);
    if (!original) {
      setToast("Manual clips do not have AI timing to restore.");
      return;
    }
    setClips((items) => items.map((clip) => clip.id === selectedClip.id ? original : clip));
    setCurrentTime(original.start);
  };

  const createManualClip = () => {
    const start = Math.max(0, Math.min(currentTime, Math.max(0, analysis.duration - 1)));
    const end = Math.min(analysis.duration, start + 30);
    const spoken = transcript.filter((segment) => segment.end > start && segment.start < end).map((segment) => segment.text).join(" ");
    const manual: ClipSuggestion = {
      id: `manual-${crypto.randomUUID()}`,
      title: "Manual clip",
      start,
      end: Math.max(start + 0.5, end),
      hook: spoken.split(/\s+/).slice(0, 18).join(" ") || "Custom sermon moment",
      score: 0,
      reason: "A manually selected moment. Adjust the timing and title before export.",
      platform: "Reels · Shorts",
    };
    setClips((items) => [...items, manual]);
    setSelectedId(manual.id);
    setCurrentTime(manual.start);
    setInspectorTab("transcript");
  };

  const regenerateSuggestions = async () => {
    if (!projectId) {
      setToast("Upload and analyze a sermon before regenerating suggestions.");
      return;
    }
    setRegenerating(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await readApiPayload<{ clips: ClipSuggestion[] }>(response, "Regenerating suggestions");
      if (!response.ok || !payload.clips?.length) throw new Error(payload.error || "No new complete moments were found.");
      setClips(payload.clips);
      setSelectedId(payload.clips[0].id);
      setCurrentTime(payload.clips[0].start);
      setToast("Fresh, non-overlapping clip suggestions are ready.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Suggestions could not be regenerated.");
    } finally {
      setRegenerating(false);
    }
  };

  const downloadStoredExport = async (item: ProjectExport) => {
    if (!projectId || !item.fileSize) {
      setToast("This export is not ready to download yet.");
      return;
    }
    setExporting(true);
    setExportProgress(0);
    try {
      const parts: ArrayBuffer[] = [];
      let offset = 0;
      while (offset < item.fileSize) {
        const end = Math.min(item.fileSize - 1, offset + UPLOAD_PART_BYTES - 1);
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(item.id)}/media`, {
          headers: { Range: `bytes=${offset}-${end}` },
        });
        if (response.status !== 206) {
          const payload = await readApiPayload<ApiErrorPayload>(response, "Downloading export");
          throw new Error(payload.error || "The export download was interrupted.");
        }
        const part = await response.arrayBuffer();
        if (!part.byteLength) throw new Error("The export download returned an empty section.");
        parts.push(part);
        offset += part.byteLength;
        setExportProgress(Math.round((offset / item.fileSize) * 100));
      }
      const url = URL.createObjectURL(new Blob(parts, { type: "video/mp4" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("Your finished MP4 was downloaded.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "The export could not be downloaded.");
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const exportClip = async () => {
    if (!projectId) {
      setToast("Sample mode is for exploration. Upload a sermon to render an MP4.");
      return;
    }
    setExporting(true);
    setExportProgress(0);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip: selectedClip, transcript, settings }),
      });
      const queued = await readApiPayload<{ export: ProjectExport }>(response, "Queuing export");
      if (!response.ok) {
        const suffix = queued.requestId ? ` Reference: ${queued.requestId}.` : "";
        throw new Error(`${queued.error || "The export could not be queued."}${suffix}`);
      }
      setExports((items) => [queued.export, ...items.filter((item) => item.id !== queued.export.id)]);
      setToast("Export queued. You can leave this page while it renders.");

      for (let attempt = 0; attempt < 450; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const projectResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const projectPayload = await readApiPayload<{ project: CircumvisionProject }>(projectResponse, "Checking export");
        if (!projectResponse.ok || !projectPayload.project) throw new Error(projectPayload.error || "Export status could not be checked.");
        const item = projectPayload.project.exports.find((value) => value.id === queued.export.id);
        if (!item) throw new Error("The queued export could not be found.");
        setExports(projectPayload.project.exports);
        if (item.status === "failed") throw new Error(item.error || "The export failed.");
        if (item.status === "cancelled") throw new Error("The export was cancelled.");
        if (item.status === "ready") {
          setExporting(false);
          await downloadStoredExport(item);
          return;
        }
      }
      setToast("The export is still rendering in the background. It will remain in this project.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The clip could not be exported.");
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const cancelStoredExport = async (item: ProjectExport) => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const payload = await readApiPayload<{ export?: ProjectExport }>(response, "Cancelling export");
      if (!response.ok) throw new Error(payload.error || "The export could not be cancelled.");
      setExports((items) => items.map((value) => value.id === item.id ? { ...value, status: "cancelled" } : value));
      setToast("Export cancelled. The source and editor changes are still safe.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "The export could not be cancelled.");
    }
  };

  const captionWords = (currentCaption?.text || selectedClip.hook).split(/\s+/);
  const splitAt = Math.max(1, captionWords.length - 2);

  return (
    <main className="editor-shell">
      <nav className="rail">
        <BrandMark compact />
        <div className="rail-main">
          <button className="active" aria-label="Editor" onClick={onBack}><Home size={18} /></button>
          <button aria-label="Projects" onClick={onBack}><FolderOpen size={18} /></button>
        </div>
        <div className="rail-foot">
          <span className="avatar">TR</span>
        </div>
      </nav>

      <div className="editor-main">
        <header className="editor-header">
          <div className="project-breadcrumb">
            <button onClick={onBack} aria-label="Back to upload"><ArrowLeft size={16} /></button>
            <div><span>PROJECT / SERMON</span><strong>{analysis.title}</strong></div>
          </div>
          <div className="editor-actions">
            <span className="saved-state"><Check size={12} /> {saveState}</span>
            <button className="secondary-button" onClick={onNew}><Plus size={15} /> New project</button>
            <button className="export-button" disabled={exporting} onClick={exportClip}>
              {exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
              {exporting ? exportProgress ? `${exportProgress}% · Downloading` : "Rendering…" : "Export clip"}
            </button>
          </div>
        </header>

        <div className="workspace">
          <ClipList clips={clips} selectedId={selectedId} regenerating={regenerating} onSelect={selectClip} onRegenerate={() => void regenerateSuggestions()} onCreate={createManualClip} />

          <section className="canvas-area">
            <div className="canvas-toolbar">
              <div className="aspect-switcher">
                {(["9:16", "4:5", "1:1"] as AspectRatio[]).map((aspect) => (
                  <button key={aspect} className={settings.aspect === aspect ? "active" : ""} onClick={() => setSettings((value) => ({ ...value, aspect }))}>
                    <i className={`ratio-shape ratio-${aspect.replace(":", "-")}`} /> {aspect}
                  </button>
                ))}
              </div>
              <button className="canvas-fit" onClick={() => setSettings((value) => ({ ...value, frameMode: value.frameMode === "fill" ? "fit" : "fill" }))}><Maximize2 size={13} /> {settings.frameMode === "fill" ? "Fill" : "Full frame"}</button>
              <button className="mobile-tools" onClick={() => setMobileToolsOpen(true)}><Frame size={13} /> Edit</button>
            </div>

            <div className="stage-wrap">
              <div ref={stageRef} className={`video-stage aspect-${settings.aspect.replace(":", "-")} ${settings.frameMode === "fit" ? "smart-fit" : ""} ${playing ? "is-playing" : ""}`}>
                {videoUrl ? (
                  <>
                    {settings.frameMode === "fit" && <video className="blur-layer" src={videoUrl} muted aria-hidden="true" style={{ objectPosition: `${50 + settings.frameX / 2}% ${50 + settings.frameY / 2}%` }} />}
                    <video
                      ref={videoRef}
                      className="source-video"
                      src={videoUrl}
                      preload="metadata"
                      style={{ objectPosition: `${50 + settings.frameX / 2}% ${50 + settings.frameY / 2}%` }}
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
              <div className="player-right"><button aria-label="Toggle captions" aria-pressed={settings.captionsEnabled} onClick={() => setSettings((value) => ({ ...value, captionsEnabled: !value.captionsEnabled }))}><Captions size={15} /></button><button aria-label="Enter fullscreen preview" onClick={() => void stageRef.current?.requestFullscreen().catch(() => setToast("Fullscreen preview is not available in this browser."))}><Maximize2 size={15} /></button></div>
            </div>
          </section>

          {mobileToolsOpen && <button className="inspector-backdrop" aria-label="Close editing tools" onClick={() => setMobileToolsOpen(false)} />}
          <Inspector
            tab={inspectorTab}
            settings={settings}
            selectedClip={selectedClip}
            transcript={transcript}
            onTab={setInspectorTab}
            onSettings={(updates) => setSettings((value) => ({ ...value, ...updates }))}
            onClipChange={updateClip}
            onTranscriptChange={(segmentId, text) => setTranscript((segments) => segments.map((segment) => segment.id === segmentId ? { ...segment, text } : segment))}
            onResetSettings={() => setSettings(DEFAULT_SETTINGS)}
            exports={exports}
            onDownloadExport={(item) => void downloadStoredExport(item)}
            onCancelExport={(item) => void cancelStoredExport(item)}
            mobileOpen={mobileToolsOpen}
            onMobileClose={() => setMobileToolsOpen(false)}
          />
        </div>

        <Timeline analysis={workingAnalysis} selectedClip={selectedClip} currentTime={currentTime} playing={playing} onSeek={seek} onReset={resetSelectedClip} />
      </div>
      {toast && <div className="toast"><Check size={15} /> {toast}<button onClick={() => setToast("")}><X size={14} /></button></div>}
    </main>
  );
}

export function StudioApp() {
  const [mode, setMode] = useState<AppMode>("welcome");
  const [sessionState, setSessionState] = useState<"loading" | "authenticated" | "unauthenticated" | "unauthorized">("loading");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(0);
  const [targetDuration, setTargetDuration] = useState<ClipTargetDuration>(30);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [initialEditor, setInitialEditor] = useState<CircumvisionProject["editor"]>();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resumeTarget, setResumeTarget] = useState<CircumvisionProject | null>(null);
  const [error, setError] = useState("");
  const [analysisStep, setAnalysisStep] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisDetail, setAnalysisDetail] = useState("Uploading sermon · 0% uploaded");
  const operationController = useRef<AbortController | null>(null);
  const activeProjectId = useRef<string | null>(null);

  useEffect(() => {
    activeProjectId.current = projectId;
  }, [projectId]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const sessionResponse = await fetch("/api/session", { cache: "no-store" });
        const session = await readApiPayload<{ authenticated: boolean; authorized: boolean }>(sessionResponse, "Loading session");
        if (!active) return;
        if (!session.authenticated) {
          setSessionState("unauthenticated");
          setProjectsLoading(false);
          return;
        }
        if (!session.authorized) {
          setSessionState("unauthorized");
          setProjectsLoading(false);
          return;
        }
        const response = await fetch("/api/projects", { cache: "no-store" });
        const payload = await readApiPayload<{ projects: ProjectSummary[] }>(response, "Loading projects");
        if (!response.ok) throw new Error(payload.error || "Projects could not be loaded.");
        if (!active) return;
        setProjects(payload.projects || []);
        if (payload.projects?.length) setMode("projects");
        setSessionState("authenticated");
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "The workspace could not be loaded.");
        setSessionState("authenticated");
      } finally {
        if (active) setProjectsLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const loadProjects = async () => {
    setProjectsLoading(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const payload = await readApiPayload<{ projects: ProjectSummary[] }>(response, "Loading projects");
      if (!response.ok) throw new Error(payload.error || "Projects could not be loaded.");
      setProjects(payload.projects || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Projects could not be loaded.");
    } finally {
      setProjectsLoading(false);
    }
  };

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
    setResumeTarget(null);
    setMode("welcome");
  };

  const openReadyProject = (project: CircumvisionProject) => {
    if (!project.analysis?.clips.length) throw new Error("Processing completed without any usable clip suggestions.");
    setInitialEditor(project.editor);
    setAnalysis({
      ...project.analysis,
      clips: project.editor?.clips || project.analysis.clips,
      transcript: project.editor?.transcript || project.analysis.transcript,
    });
    setProjectId(project.id);
    setResumeTarget(null);
    setAnalysisStep(3);
    setAnalysisProgress(100);
    setAnalysisDetail("Ready to edit");
    setMode("editor");
    void loadProjects();
  };

  const monitorProcessing = async (activeProjectId: string, signal?: AbortSignal) => {
    for (let attempt = 0; attempt < 450; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Processing monitor cancelled.", "AbortError");
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}`, { cache: "no-store", signal });
      const payload = await readApiPayload<{ project: CircumvisionProject }>(response, "Checking processing");
      if (!response.ok || !payload.project) throw new Error(payload.error || "Processing status could not be checked.");
      const project = payload.project;
      setAnalysisProgress(project.progress);
      setAnalysisDetail(project.stage);
      setAnalysisStep(project.status === "preparing" || project.status === "uploading" ? 0 : project.status === "transcribing" ? 1 : project.status === "selecting" ? 2 : 3);
      if (project.analysis?.clips.length) {
        openReadyProject(project);
        return;
      }
      if (project.status === "failed") throw new Error(project.error || "Sermon processing failed. Retry from the project dashboard.");
      if (project.status === "cancelled") throw new DOMException("Sermon processing was cancelled.", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("Processing is still running in the background. Return to the project dashboard in a few minutes.");
  };

  const queueAndMonitor = async (activeProjectId: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/process`, { method: "POST", signal });
    const payload = await readApiPayload<{ projectId: string; status: string }>(response, "Starting background processing");
    if (!response.ok) {
      const suffix = payload.requestId ? ` Reference: ${payload.requestId}.` : "";
      throw new Error(`${payload.error || "The sermon could not be queued."}${suffix}`);
    }
    await monitorProcessing(activeProjectId, signal);
  };

  const analyze = async () => {
    if (!file) return;
    setAnalysisStep(0);
    setAnalysisProgress(0);
    setAnalysisDetail("Uploading sermon · 0% uploaded");
    setMode("analyzing");
    setError("");
    operationController.current?.abort();
    const controller = new AbortController();
    operationController.current = controller;
    let activeJobId = "";
    try {
      let project: CircumvisionProject;
      if (resumeTarget) {
        if (file.size !== resumeTarget.source.fileSize) throw new Error(`Choose the original ${formatFileSize(resumeTarget.source.fileSize)} source file to resume this upload.`);
        project = resumeTarget;
      } else {
        const projectResponse = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            totalParts: Math.ceil(file.size / UPLOAD_PART_BYTES),
            targetDuration,
          }),
          signal: controller.signal,
        });
        const projectPayload = await readApiPayload<ProjectCreationPayload>(projectResponse, "Creating project");
        if (!projectResponse.ok || !projectPayload.project) {
          const suffix = projectPayload.requestId ? ` Reference: ${projectPayload.requestId}.` : "";
          throw new Error(`${projectPayload.error || "The project could not be created."}${suffix}`);
        }
        project = projectPayload.project;
      }
      activeJobId = project.id;
      setProjectId(activeJobId);
      activeProjectId.current = activeJobId;

      await uploadFileInParts(file, activeJobId, (uploadProgress) => {
        const uploadedPercent = Math.round(uploadProgress * 100);
        setAnalysisProgress(Math.round(uploadProgress * 12));
        setAnalysisDetail(`Uploading sermon · ${uploadedPercent}% uploaded`);
      }, project.source.uploadedParts, controller.signal);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      await queueAndMonitor(activeJobId, controller.signal);
    } catch (caught) {
      if (controller.signal.aborted || caught instanceof DOMException && caught.name === "AbortError") {
        setMode("projects");
        void loadProjects();
        return;
      }
      setError(caught instanceof Error ? caught.message : "The sermon could not be analyzed.");
      setMode("ready");
    } finally {
      if (operationController.current === controller) operationController.current = null;
    }
  };

  const openSample = () => {
    setAnalysis(DEMO_ANALYSIS);
    setInitialEditor(undefined);
    setProjectId(null);
    setVideoUrl(null);
    setFile(null);
    setMode("editor");
  };

  const newProject = () => {
    setAnalysis(null);
    setInitialEditor(undefined);
    setProjectId(null);
    setResumeTarget(null);
    setFile(null);
    setVideoUrl(null);
    setDuration(0);
    setTitle("");
    setError("");
    setMode("welcome");
  };

  const openProject = async (summary: ProjectSummary) => {
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(summary.id)}`, { cache: "no-store" });
      const payload = await readApiPayload<{ project: CircumvisionProject }>(response, "Opening project");
      if (!response.ok || !payload.project) throw new Error(payload.error || "The project could not be opened.");
      const project = payload.project;
      setProjectId(project.id);
      activeProjectId.current = project.id;
      setTitle(project.title);
      setDuration(project.duration || 0);
      setTargetDuration(project.targetDuration || 30);
      setVideoUrl(`/api/projects/${encodeURIComponent(project.id)}/media`);

      if (project.analysis?.clips.length) {
        openReadyProject(project);
        setFile(null);
        return;
      }

      if (project.status === "uploading" && project.source.uploadedParts.length < project.source.totalParts) {
        setResumeTarget(project);
        setFile(null);
        setMode("welcome");
        setError(`Choose the original ${project.source.fileName} to resume at ${Math.round((project.source.uploadedParts.length / project.source.totalParts) * 100)}%.`);
        return;
      }

      setResumeTarget(project);
      setMode("analyzing");
      setAnalysisDetail(project.stage);
      setAnalysisProgress(project.progress);
      const isStale = Date.now() - Date.parse(project.updatedAt) > 16 * 60 * 1000;
      operationController.current?.abort();
      const controller = new AbortController();
      operationController.current = controller;
      if (project.status === "failed" || project.status === "uploading" || project.status === "cancelled" || isStale) await queueAndMonitor(project.id, controller.signal);
      else await monitorProcessing(project.id, controller.signal);
      if (operationController.current === controller) operationController.current = null;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setMode("projects");
        void loadProjects();
        return;
      }
      setError(caught instanceof Error ? caught.message : "The project could not be resumed.");
      setMode("projects");
    }
  };

  const removeProject = async (project: ProjectSummary) => {
    if (!window.confirm(`Delete “${project.title}” and its stored media and exports?`)) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      const payload = await readApiPayload<ApiErrorPayload>(response, "Deleting project");
      if (!response.ok) throw new Error(payload.error || "The project could not be deleted.");
      setProjects((items) => items.filter((item) => item.id !== project.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project could not be deleted.");
    }
  };

  const showProjects = () => {
    operationController.current?.abort();
    setAnalysis(null);
    setInitialEditor(undefined);
    setProjectId(null);
    setFile(null);
    setVideoUrl(null);
    setMode("projects");
    void loadProjects();
  };

  const cancelProcessing = async () => {
    operationController.current?.abort();
    operationController.current = null;
    const activeId = activeProjectId.current;
    setMode("projects");
    if (activeId) {
      await fetch(`/api/projects/${encodeURIComponent(activeId)}/cancel`, { method: "POST" }).catch(() => undefined);
    }
    await loadProjects();
  };

  if (sessionState === "loading") return <main className="app-loading"><BrandMark /><LoaderCircle className="spin" size={24} /><span>Opening private workspace</span></main>;
  if (sessionState === "unauthenticated") return <SignInView />;
  if (sessionState === "unauthorized") return <AccessDeniedView />;

  if (mode === "analyzing") return <AnalyzingView fileName={file?.name || title || "Sermon"} step={analysisStep} progress={analysisProgress} activeDetail={analysisDetail} onCancel={() => void cancelProcessing()} />;
  if (mode === "projects") return <ProjectsView projects={projects} loading={projectsLoading} onNew={newProject} onOpen={(project) => void openProject(project)} onDelete={(project) => void removeProject(project)} onRefresh={() => void loadProjects()} onLogout={() => void import("@netlify/identity").then(async ({ logout }) => { await logout(); window.location.reload(); })} />;
  if (mode === "editor" && analysis) return <EditorView analysis={analysis} projectId={projectId} initialEditor={initialEditor} initialExports={projects.find((project) => project.id === projectId)?.exports} videoUrl={videoUrl} onBack={showProjects} onNew={newProject} />;
  return (
    <WelcomeView
      mode={mode}
      file={file}
      title={title}
      duration={duration}
      targetDuration={targetDuration}
      error={error}
      onFile={chooseFile}
      onTitle={setTitle}
      onTargetDuration={setTargetDuration}
      onAnalyze={analyze}
      onClear={clearFile}
      onSample={openSample}
    />
  );
}
