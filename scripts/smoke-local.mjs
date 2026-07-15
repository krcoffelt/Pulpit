import { open, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2];
const baseUrl = process.env.CIRCUMVISION_SMOKE_URL || "http://127.0.0.1:3000";
const partBytes = 3 * 1024 * 1024;
if (!sourcePath) throw new Error("Usage: npm run smoke:local -- /absolute/path/to/media.mp4");

async function payload(response, action) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${action} returned unreadable HTTP ${response.status}.`); }
  if (!response.ok) throw new Error(`${action} failed: ${data.error || `HTTP ${response.status}`} ${data.requestId ? `(request ${data.requestId})` : ""}`);
  return data;
}

const extension = path.extname(sourcePath).toLowerCase();
const mediaTypes = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav" };
const fileType = mediaTypes[extension];
if (!fileType) throw new Error("The smoke script accepts MP4, MOV, WebM, MP3, M4A, or WAV media.");

const source = await stat(sourcePath);
const totalParts = Math.ceil(source.size / partBytes);
const created = await payload(await fetch(`${baseUrl}/api/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Automated production smoke test", fileName: path.basename(sourcePath), fileType, fileSize: source.size, totalParts, targetDuration: 15 }),
}), "Creating smoke project");
const projectId = created.project.id;
console.info(JSON.stringify({ event: "smoke.project_created", projectId, bytes: source.size, totalParts }));

try {
  const handle = await open(sourcePath, "r");
  try {
    for (let index = 0; index < totalParts; index += 1) {
      const length = Math.min(partBytes, source.size - index * partBytes);
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, index * partBytes);
      await payload(await fetch(`${baseUrl}/api/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-project-id": projectId, "x-chunk-index": String(index), "x-total-chunks": String(totalParts) },
        body: buffer,
      }), `Uploading section ${index + 1}`);
      console.info(JSON.stringify({ event: "smoke.upload_progress", percent: Math.round(((index + 1) / totalParts) * 100) }));
    }
  } finally {
    await handle.close();
  }

  await payload(await fetch(`${baseUrl}/api/projects/${projectId}/process`, { method: "POST" }), "Queueing analysis");
  let readyProject;
  let lastStage = "";
  for (let attempt = 0; attempt < 450; attempt += 1) {
    const result = await payload(await fetch(`${baseUrl}/api/projects/${projectId}`, { cache: "no-store" }), "Polling analysis");
    if (result.project.stage !== lastStage) {
      lastStage = result.project.stage;
      console.info(JSON.stringify({ event: "smoke.analysis_progress", status: result.project.status, stage: lastStage, percent: result.project.progress }));
    }
    if (result.project.status === "failed") throw new Error(result.project.error || "Analysis failed.");
    if (result.project.status === "cancelled") throw new Error("Analysis was cancelled.");
    if (result.project.status === "ready" && result.project.analysis?.clips?.length) { readyProject = result.project; break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!readyProject) throw new Error("Analysis did not finish within 15 minutes.");
  const clip = readyProject.analysis.clips[0];
  console.info(JSON.stringify({ event: "smoke.analysis_ready", transcriptSegments: readyProject.analysis.transcript.length, speakers: new Set(readyProject.analysis.transcript.map((item) => item.speaker)).size, clips: readyProject.analysis.clips.map((item) => Math.round((item.end - item.start) * 10) / 10) }));

  const queued = await payload(await fetch(`${baseUrl}/api/projects/${projectId}/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clip,
      transcript: readyProject.analysis.transcript,
      settings: { aspect: "9:16", captionPreset: "bold", captionPosition: "bottom", captionScale: 1, captionsEnabled: true, highlight: true, frameMode: "fill", frameX: 25, frameY: -15 },
    }),
  }), "Queueing export");
  let finished;
  for (let attempt = 0; attempt < 450; attempt += 1) {
    const result = await payload(await fetch(`${baseUrl}/api/projects/${projectId}`, { cache: "no-store" }), "Polling export");
    const item = result.project.exports.find((value) => value.id === queued.export.id);
    if (item?.status === "failed") throw new Error(item.error || "Export failed.");
    if (item?.status === "ready") { finished = item; break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!finished?.fileSize) throw new Error("Export did not finish within 15 minutes.");

  const chunks = [];
  let offset = 0;
  while (offset < finished.fileSize) {
    const end = Math.min(finished.fileSize - 1, offset + partBytes - 1);
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/exports/${finished.id}/media`, { headers: { Range: `bytes=${offset}-${end}` } });
    if (response.status !== 206) throw new Error(`Export section download failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    chunks.push(bytes);
    offset += bytes.length;
  }
  const output = Buffer.concat(chunks);
  if (output.length !== finished.fileSize || !output.subarray(0, 32).includes(Buffer.from("ftyp"))) throw new Error("Downloaded export is incomplete or not an MP4.");
  const outputPath = "/tmp/circumvision-smoke-export.mp4";
  await writeFile(outputPath, output);
  console.info(JSON.stringify({ event: "smoke.complete", projectId, exportBytes: output.length, outputPath }));
} finally {
  if (process.env.KEEP_SMOKE_PROJECT !== "1") {
    await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
  }
}
