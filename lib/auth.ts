import { getUser } from "@netlify/identity";
import { isNetlifyRuntime } from "./runtime";

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

  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function getCircumvisionSession(): Promise<CircumvisionSession> {
  if (!isNetlifyRuntime()) {
    return {
      authenticated: true,
      authorized: true,
      user: { id: "local-user", email: "local@circumvision.test", name: "Tyshone Roland", local: true },
      local: true,
    };
  }

  const identityUser = await getUser();
  if (!identityUser) return { authenticated: false, authorized: false, user: null, local: false };
  return {
    authenticated: true,
    authorized: true,
    user: { id: identityUser.id, email: identityUser.email, name: identityUser.name, local: false },
    local: false,
  };
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
