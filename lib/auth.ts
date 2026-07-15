import { cookies } from "next/headers";
import { OPEN_WORKSPACE_OWNER_ID, WORKSPACE_SESSION_COOKIE } from "./workspace";

export { OPEN_WORKSPACE_OWNER_ID, WORKSPACE_SESSION_COOKIE, WORKSPACE_SESSION_MAX_AGE } from "./workspace";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CircumvisionUser {
  id: string;
  email?: string;
  name?: string;
  local: boolean;
}

export interface CircumvisionSession {
  authenticated: boolean;
  authorized: boolean;
  user: CircumvisionUser | null;
  local: boolean;
  reason?: string;
}

export class AuthenticationError extends Error {
  status: number = 401;

  constructor(message = "Enter your email to continue.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function normalizeWorkspaceEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new AuthenticationError("Enter a valid email address.");
  return email;
}

export function encodeWorkspaceSession(email: string) {
  return Buffer.from(normalizeWorkspaceEmail(email), "utf8").toString("base64url");
}

export function decodeWorkspaceSession(value: string | undefined) {
  if (!value || value.length > 512) return null;
  try {
    return normalizeWorkspaceEmail(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function workspaceSession(email: string): CircumvisionSession {
  return {
    authenticated: true,
    authorized: true,
    user: { id: OPEN_WORKSPACE_OWNER_ID, email: normalizeWorkspaceEmail(email), name: "Tyshone Roland", local: false },
    local: false,
  };
}

export async function getCircumvisionSession(): Promise<CircumvisionSession> {
  const cookieStore = await cookies();
  const email = decodeWorkspaceSession(cookieStore.get(WORKSPACE_SESSION_COOKIE)?.value);
  if (!email) return { authenticated: false, authorized: false, user: null, local: false };
  return workspaceSession(email);
}

export async function getCircumvisionUser(): Promise<CircumvisionUser | null> {
  const session = await getCircumvisionSession();
  return session.user;
}

export async function requireCircumvisionUser() {
  const session = await getCircumvisionSession();
  if (!session.authenticated || !session.user) throw new AuthenticationError();
  return session.user;
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}
