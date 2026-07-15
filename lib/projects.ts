import { randomUUID } from "node:crypto";
import {
  deleteJobPath,
  deleteStorageKey,
  getJobJson,
  jobKey,
  listJobKeys,
  putJobJson,
} from "./job-storage";
import type {
  ClipTargetDuration,
  CircumvisionProject,
  ProjectStatus,
  ProjectSummary,
  RenderSettings,
} from "./types";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_PARTS, UPLOAD_PART_BYTES } from "./upload";
import { PublicError } from "./public-error";

export const PROJECT_ID_PATTERN = /^job-[a-f0-9-]{36}$/;
export const ALLOWED_MEDIA_EXTENSIONS = new Set(["mp4", "mov", "webm", "mp3", "m4a", "wav"]);
export const ALLOWED_MEDIA_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
]);
export const MAX_OWNER_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
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

function assertOwnerId(ownerId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(ownerId)) throw new PublicError("The project owner identifier is invalid.", 400);
}

function projectKey(ownerId: string, projectId: string) {
  assertOwnerId(ownerId);
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new PublicError("The project identifier is invalid.", 400);
  return `owners/${ownerId}/projects/${projectId}.json`;
}

function titleFromFile(fileName: string) {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function validateMedia(fileName: string, fileType: string, fileSize: number, totalParts: number) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_MEDIA_EXTENSIONS.has(extension)) {
    throw new PublicError("Choose an MP4, MOV, WebM, MP3, M4A, or WAV file.", 400);
  }
  if (fileType && !ALLOWED_MEDIA_TYPES.has(fileType.toLowerCase())) {
    throw new PublicError("This file's media type is not supported.", 400);
  }
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
    throw new PublicError("The source file must be larger than 0 bytes and no more than 2 GB.", 400);
  }
  if (!Number.isSafeInteger(totalParts) || totalParts <= 0 || totalParts > MAX_UPLOAD_PARTS) {
    throw new PublicError("The upload section count is invalid.", 400);
  }
  if (totalParts !== Math.ceil(fileSize / UPLOAD_PART_BYTES)) {
    throw new PublicError("The upload section count does not match the source file size.", 400);
  }
}

export async function createProject(input: {
  ownerId: string;
  title?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  totalParts: number;
  targetDuration?: ClipTargetDuration;
}) {
  validateMedia(input.fileName, input.fileType, input.fileSize, input.totalParts);
  const id = `job-${randomUUID()}`;
  const now = new Date().toISOString();
  const project: CircumvisionProject = {
    id,
    ownerId: input.ownerId,
    title: input.title?.trim().slice(0, 180) || titleFromFile(input.fileName) || "Untitled sermon",
    targetDuration: input.targetDuration || 30,
    status: "uploading",
    stage: "Waiting for upload",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    source: {
      fileName: input.fileName.slice(0, 255),
      fileType: input.fileType.toLowerCase(),
      fileSize: input.fileSize,
      totalParts: input.totalParts,
      uploadedParts: [],
    },
    exports: [],
  };
  await putJobJson(projectKey(input.ownerId, id), project);
  return project;
}

export async function getProject(ownerId: string, projectId: string) {
  return getJobJson<CircumvisionProject>(projectKey(ownerId, projectId));
}

export async function requireProject(ownerId: string, projectId: string) {
  const project = await getProject(ownerId, projectId);
  if (!project) throw new PublicError("This project could not be found.", 404);
  return project;
}

export async function saveProject(project: CircumvisionProject) {
  project.updatedAt = new Date().toISOString();
  project.progress = Math.max(0, Math.min(100, Math.round(project.progress)));
  await putJobJson(projectKey(project.ownerId, project.id), project);
  return project;
}

export async function updateProject(
  ownerId: string,
  projectId: string,
  update: Partial<Pick<CircumvisionProject, "title" | "targetDuration" | "status" | "stage" | "progress" | "duration" | "processing" | "analysis" | "editor" | "exports" | "error" | "requestId">>,
) {
  const project = await requireProject(ownerId, projectId);
  Object.assign(project, update);
  return saveProject(project);
}

export async function updateProjectStatus(
  ownerId: string,
  projectId: string,
  status: ProjectStatus,
  stage: string,
  progress: number,
  error?: string,
) {
  return updateProject(ownerId, projectId, { status, stage, progress, error });
}

export async function recordUploadedPart(ownerId: string, projectId: string, partIndex: number) {
  const project = await requireProject(ownerId, projectId);
  if (!project.source.uploadedParts.includes(partIndex)) {
    project.source.uploadedParts.push(partIndex);
    project.source.uploadedParts.sort((left, right) => left - right);
  }
  const uploaded = project.source.uploadedParts.length;
  project.progress = Math.round((uploaded / project.source.totalParts) * 12);
  project.stage = `Uploaded ${uploaded} of ${project.source.totalParts} sections`;
  return saveProject(project);
}

export async function listProjects(ownerId: string): Promise<ProjectSummary[]> {
  assertOwnerId(ownerId);
  const prefix = `owners/${ownerId}/projects/`;
  const keys = (await listJobKeys(prefix)).filter((key) => key.endsWith(".json"));
  const projects = (await Promise.all(keys.map((key) => getJobJson<CircumvisionProject>(key))))
    .filter((project): project is CircumvisionProject => Boolean(project));

  return projects
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(({ ownerId, analysis, editor, ...project }) => {
      void ownerId;
      return {
        ...project,
        clipCount: editor?.clips.length ?? analysis?.clips.length ?? 0,
        transcriptSegments: editor?.transcript.length ?? analysis?.transcript.length ?? 0,
      };
    });
}

export async function deleteProject(ownerId: string, projectId: string) {
  await requireProject(ownerId, projectId);
  await Promise.all([
    deleteJobPath(projectId),
    deleteStorageKey(projectKey(ownerId, projectId)),
  ]);
}

export function projectSourcePartKey(projectId: string, partIndex: number) {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new PublicError("The project identifier is invalid.", 400);
  if (!Number.isSafeInteger(partIndex) || partIndex < 0 || partIndex >= MAX_UPLOAD_PARTS) {
    throw new PublicError("The upload section number is invalid.", 400);
  }
  return jobKey(projectId, `source/part-${String(partIndex).padStart(4, "0")}`);
}

export function validateMediaSignature(bytes: Uint8Array, fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const ascii = String.fromCharCode(...bytes.slice(0, 64));
  const isIsoMedia = ascii.includes("ftyp");
  const isWebm = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const isWave = ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE";
  const isMp3 = ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  const valid = extension === "webm" ? isWebm
    : extension === "wav" ? isWave
      : extension === "mp3" ? isMp3
        : extension === "mp4" || extension === "mov" || extension === "m4a" ? isIsoMedia
          : false;
  if (!valid) throw new PublicError("The file contents do not match the selected media type.", 400);
}
