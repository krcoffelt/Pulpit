import { isNetlifyRuntime } from "./runtime";

type WorkerKind = "process" | "render";

export async function dispatchBackgroundJob(
  request: Request,
  kind: WorkerKind,
  payload: Record<string, string>,
  requestId: string,
) {
  const externalUrl = process.env.CIRCUMVISION_WORKER_URL;
  if (externalUrl) {
    const token = process.env.CIRCUMVISION_WORKER_TOKEN;
    if (!token) throw new Error("The external media worker token is not configured.");
    const url = new URL(`/v1/jobs/${kind}`, externalUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error("The external media worker must use HTTPS.");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Circumvision-Request-Id": requestId },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`The external media worker could not be started (HTTP ${response.status}).`);
    return "external" as const;
  }

  if (isNetlifyRuntime()) {
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || request.url;
    const response = await fetch(new URL(`/.netlify/functions/${kind}-background`, siteUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Circumvision-Request-Id": requestId },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`The Netlify background ${kind === "process" ? "processor" : "renderer"} could not be started (HTTP ${response.status}).`);
    return "netlify" as const;
  }

  return null;
}
