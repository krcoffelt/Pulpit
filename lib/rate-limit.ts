import { getJobJson, putJobJson } from "./job-storage";

interface RateRecord {
  count: number;
  resetAt: number;
}

export class RateLimitError extends Error {
  status = 429;
  retryAfter: number;

  constructor(retryAfter: number) {
    super("Too many requests. Wait a moment and try again.");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export async function enforceRateLimit(ownerId: string, action: string, limit: number, windowMs: number) {
  if (!/^[a-zA-Z0-9_-]+$/.test(ownerId) || !/^[a-z0-9-]+$/.test(action)) throw new Error("The rate-limit key is invalid.");
  if (process.env.NODE_ENV === "development" && process.env.CIRCUMVISION_ENFORCE_LOCAL_RATE_LIMITS !== "true") return;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const key = `rate/${ownerId}/${action}/${bucket}.json`;
  const existing = await getJobJson<RateRecord>(key);
  const count = existing?.count || 0;
  const resetAt = (bucket + 1) * windowMs;
  if (count >= limit) throw new RateLimitError(Math.max(1, Math.ceil((resetAt - now) / 1000)));
  await putJobJson(key, { count: count + 1, resetAt } satisfies RateRecord);
}
