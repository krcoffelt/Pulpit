import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAuthenticationError } from "./auth";
import { logEvent } from "./log";
import { PublicError } from "./public-error";

export class ApiStatusError extends PublicError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "ApiStatusError";
  }
}

export function createRequestId() {
  return randomUUID();
}

function addConfiguredOrigin(origins: Set<string>, value: string | undefined) {
  if (!value) return;
  try {
    origins.add(new URL(value).origin);
  } catch {
    // Invalid deployment metadata must never widen the trusted-origin set.
  }
}

export function requireTrustedMutation(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const trustedOrigins = new Set([requestUrl.origin]);
  addConfiguredOrigin(trustedOrigins, process.env.NEXT_PUBLIC_APP_URL);
  addConfiguredOrigin(trustedOrigins, process.env.URL);
  addConfiguredOrigin(trustedOrigins, process.env.DEPLOY_PRIME_URL);
  addConfiguredOrigin(trustedOrigins, process.env.DEPLOY_URL);

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : requestUrl.protocol.replace(":", "");
  if (host && /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host)) trustedOrigins.add(`${protocol}://${host}`);

  if (origin && !trustedOrigins.has(origin)) throw new ApiStatusError("This request came from an untrusted origin.", 403);
  if (fetchSite === "cross-site") throw new ApiStatusError("Cross-site changes are not allowed.", 403);
}

export function apiError(error: unknown, requestId: string, fallback: string, validation = false) {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const explicitStatus = error instanceof PublicError
    ? error.status
    : error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  const status = isAuthenticationError(error) ? error.status : explicitStatus || (validation ? 400 : 500);
  const message = status >= 500 && !(error instanceof PublicError) ? fallback : rawMessage;
  if (status >= 500) logEvent("error", "api.request_failed", { requestId, status }, error);
  else if (status >= 400) logEvent("warn", "api.request_rejected", { requestId, status, reason: message.slice(0, 200) });
  const retryAfter = error && typeof error === "object" && "retryAfter" in error && typeof error.retryAfter === "number" ? error.retryAfter : undefined;
  return NextResponse.json({ error: message, requestId, retryAfter }, { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined });
}
