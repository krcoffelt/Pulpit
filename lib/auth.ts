import { OPEN_WORKSPACE_OWNER_ID } from "./workspace";

export { OPEN_WORKSPACE_OWNER_ID } from "./workspace";

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

  constructor(message = "The workspace could not be opened.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function getCircumvisionSession(): Promise<CircumvisionSession> {
  return {
    authenticated: true,
    authorized: true,
    user: { id: OPEN_WORKSPACE_OWNER_ID, name: "Shared workspace", local: false },
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
