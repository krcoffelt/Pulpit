import { getUser, type User } from "@netlify/identity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCircumvisionSession, requireCircumvisionUser } from "../../lib/auth";

vi.mock("@netlify/identity", () => ({ getUser: vi.fn() }));

const getUserMock = vi.mocked(getUser);

describe("Circumvision authentication", () => {
  beforeEach(() => {
    vi.stubEnv("NETLIFY", "true");
    getUserMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("admits any user with a valid Netlify Identity session", async () => {
    getUserMock.mockResolvedValue({ id: "identity-user", email: "invited@example.com" } as User);

    await expect(getCircumvisionSession()).resolves.toMatchObject({
      authenticated: true,
      authorized: true,
      user: { id: "identity-user", email: "invited@example.com", local: false },
    });
  });

  it("rejects requests without an Identity session", async () => {
    getUserMock.mockResolvedValue(null);

    await expect(getCircumvisionSession()).resolves.toMatchObject({
      authenticated: false,
      authorized: false,
      user: null,
    });
    await expect(requireCircumvisionUser()).rejects.toMatchObject({ status: 401 });
  });
});
