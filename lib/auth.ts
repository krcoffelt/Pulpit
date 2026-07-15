import { getSettings, getUser, type User } from "@netlify/identity";

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

export class AuthorizationError extends AuthenticationError {
  status = 403;

  constructor(message = "This account has not been invited to the Circumvision workspace.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

function isNetlifyRuntime() {
  return process.env.NETLIFY === "true"
    || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
    || typeof globalThis.netlifyBlobsContext === "string";
}

function configuredAllowedEmails(value = process.env.CIRCUMVISION_ALLOWED_EMAILS || "") {
  return new Set(value.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

const IDENTITY_SETTINGS_TTL_MS = 5 * 60 * 1000;
let cachedInviteOnlySetting: { enabled: boolean; expiresAt: number } | null = null;

async function isInviteOnlyRegistrationEnabled() {
  if (cachedInviteOnlySetting && cachedInviteOnlySetting.expiresAt > Date.now()) {
    return cachedInviteOnlySetting.enabled;
  }
  try {
    const settings = await getSettings();
    cachedInviteOnlySetting = {
      enabled: settings.disableSignup,
      expiresAt: Date.now() + IDENTITY_SETTINGS_TTL_MS,
    };
    return settings.disableSignup;
  } catch {
    // Fail closed when the Identity policy cannot be verified.
    return false;
  }
}

export function isAuthorizedIdentityUser(
  user: Pick<User, "email" | "confirmedAt" | "invitedAt" | "role" | "roles">,
  allowedEmails = configuredAllowedEmails(),
  inviteOnlyRegistration = false,
) {
  const hasWorkspaceAccess = Boolean(user.invitedAt)
    || user.role === "admin"
    || Boolean(user.roles?.some((role) => role === "admin" || role === "circumvision"))
    // Netlify clears the pending-invite state after acceptance. A confirmed
    // account is therefore an accepted invite while registration is disabled.
    || Boolean(inviteOnlyRegistration && user.confirmedAt && user.email);
  if (!hasWorkspaceAccess) return false;
  return !allowedEmails.size || Boolean(user.email && allowedEmails.has(user.email.toLowerCase()));
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
  const inviteOnlyRegistration = await isInviteOnlyRegistrationEnabled();
  if (!isAuthorizedIdentityUser(identityUser, configuredAllowedEmails(), inviteOnlyRegistration)) {
    return {
      authenticated: true,
      authorized: false,
      user: null,
      local: false,
      reason: "This account has not been invited to the Circumvision workspace.",
    };
  }
  return {
    authenticated: true,
    authorized: true,
    user: { id: identityUser.id, email: identityUser.email, name: identityUser.name, local: false },
    local: false,
  };
}

export async function getCircumvisionUser(): Promise<CircumvisionUser | null> {
  const session = await getCircumvisionSession();
  return session.authorized ? session.user : null;
}

export async function requireCircumvisionUser() {
  const session = await getCircumvisionSession();
  if (!session.authenticated) throw new AuthenticationError();
  if (!session.authorized || !session.user) throw new AuthorizationError(session.reason);
  return session.user;
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}
