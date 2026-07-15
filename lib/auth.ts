import { getUser } from "@netlify/identity";

export interface CircumvisionUser {
  id: string;
  email?: string;
  name?: string;
  local: boolean;
}

export class AuthenticationError extends Error {
  status = 401;

  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

function isNetlifyRuntime() {
  return process.env.NETLIFY === "true"
    || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
    || typeof globalThis.netlifyBlobsContext === "string";
}

export async function getCircumvisionUser(): Promise<CircumvisionUser | null> {
  if (!isNetlifyRuntime()) {
    return { id: "local-user", email: "local@circumvision.test", name: "Tyshone Roland", local: true };
  }

  const user = await getUser();
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, local: false };
}

export async function requireCircumvisionUser() {
  const user = await getCircumvisionUser();
  if (!user) throw new AuthenticationError();
  return user;
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}
