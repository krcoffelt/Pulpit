import { getStore } from "@netlify/blobs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const LOCAL_ROOT = path.join(tmpdir(), "circumvision-analysis-storage");

export const JOB_ID_PATTERN = /^job-[a-zA-Z0-9_-]+$/;

export function usesNetlifyBlobs() {
  return process.env.NETLIFY === "true"
    || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
    || Boolean(process.env.CIRCUMVISION_BLOB_SITE_ID && process.env.CIRCUMVISION_BLOB_TOKEN)
    || typeof globalThis.netlifyBlobsContext === "string";
}

function blobStore() {
  const context = process.env.CONTEXT;
  const deploySuffix = (process.env.DEPLOY_ID || process.env.BRANCH || "nonproduction")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 40);
  const name = context && context !== "production" ? `circumvision-${deploySuffix}` : "circumvision";
  const siteID = process.env.CIRCUMVISION_BLOB_SITE_ID;
  const token = process.env.CIRCUMVISION_BLOB_TOKEN;
  return siteID && token
    ? getStore({ name, consistency: "strong", siteID, token })
    : getStore({ name, consistency: "strong" });
}

function assertSafeKey(key: string) {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\") || !/^[a-zA-Z0-9._/-]+$/.test(key)) {
    throw new Error("The job storage key is invalid.");
  }
}

function localPath(key: string) {
  assertSafeKey(key);
  return path.join(LOCAL_ROOT, key);
}

function toArrayBuffer(data: Uint8Array | ArrayBuffer) {
  if (data instanceof ArrayBuffer) return data;
  return Uint8Array.from(data).buffer;
}

async function listLocalKeys(prefix: string) {
  const root = localPath(prefix);
  const keys: string[] = [];

  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else keys.push(path.relative(LOCAL_ROOT, target).split(path.sep).join("/"));
    }
  }

  await walk(root);
  return keys;
}

export function jobKey(jobId: string, relativeKey: string) {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error("The analysis job identifier is invalid.");
  const key = `jobs/${jobId}/${relativeKey}`;
  assertSafeKey(key);
  return key;
}

export async function putJobBytes(key: string, data: Uint8Array | ArrayBuffer) {
  assertSafeKey(key);
  if (usesNetlifyBlobs()) {
    await blobStore().set(key, toArrayBuffer(data));
    return;
  }

  const target = localPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, new Uint8Array(toArrayBuffer(data)));
}

export async function getJobBytes(key: string) {
  assertSafeKey(key);
  if (usesNetlifyBlobs()) {
    const data = await blobStore().get(key, { type: "arrayBuffer" }).catch(() => null);
    return data ? new Uint8Array(data) : null;
  }

  return readFile(localPath(key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

export async function putJobJson(key: string, data: unknown) {
  assertSafeKey(key);
  if (usesNetlifyBlobs()) {
    await blobStore().setJSON(key, data);
    return;
  }

  const target = localPath(key);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, JSON.stringify(data), "utf8");
  await rename(temporary, target);
}

export async function getJobJson<T>(key: string) {
  assertSafeKey(key);
  if (usesNetlifyBlobs()) {
    return await blobStore().get(key, { type: "json" }).catch(() => null) as T | null;
  }

  try {
    return JSON.parse(await readFile(localPath(key), "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function listJobKeys(prefix = "jobs/") {
  assertSafeKey(prefix);
  if (!usesNetlifyBlobs()) return listLocalKeys(prefix);

  const keys: string[] = [];
  for await (const page of blobStore().list({ prefix, paginate: true })) {
    keys.push(...page.blobs.map((blob) => blob.key));
  }
  return keys;
}

export async function deleteJobPath(jobId: string, relativePrefix = "") {
  const prefix = jobKey(jobId, relativePrefix);
  if (!usesNetlifyBlobs()) {
    await rm(localPath(prefix), { recursive: true, force: true });
    return;
  }

  const keys = await listJobKeys(prefix);
  for (let index = 0; index < keys.length; index += 20) {
    await Promise.all(keys.slice(index, index + 20).map((key) => blobStore().delete(key)));
  }
}

export async function deleteStoragePrefix(prefix: string) {
  assertSafeKey(prefix);
  if (!usesNetlifyBlobs()) {
    await rm(localPath(prefix), { recursive: true, force: true });
    return;
  }

  const keys = await listJobKeys(prefix);
  for (let index = 0; index < keys.length; index += 20) {
    await Promise.all(keys.slice(index, index + 20).map((key) => blobStore().delete(key)));
  }
}

export async function deleteStorageKey(key: string) {
  assertSafeKey(key);
  if (usesNetlifyBlobs()) {
    await blobStore().delete(key);
    return;
  }
  await rm(localPath(key), { force: true });
}
