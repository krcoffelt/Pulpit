import { isNetlifyRuntime } from "./runtime";

export interface WorkerMediaSource {
  url: string;
  headers: Record<string, string>;
}

function productionMediaUrl(projectId: string) {
  if (!isNetlifyRuntime()) return null;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!siteUrl) return null;
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/media`, siteUrl);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("The worker media origin must use HTTPS.");
  }
  return url.toString();
}

export function processWorkerMediaSource(projectId: string, token: string): WorkerMediaSource | null {
  const url = productionMediaUrl(projectId);
  return url ? { url, headers: { "X-Circumvision-Process-Token": token } } : null;
}

export function renderWorkerMediaSource(projectId: string, exportId: string, token: string): WorkerMediaSource | null {
  const url = productionMediaUrl(projectId);
  return url ? {
    url,
    headers: {
      "X-Circumvision-Render-Token": token,
      "X-Circumvision-Export-Id": exportId,
    },
  } : null;
}
