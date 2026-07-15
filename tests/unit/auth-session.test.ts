import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeWorkspaceSession,
  getCircumvisionSession,
  OPEN_WORKSPACE_OWNER_ID,
  requireCircumvisionUser,
  WORKSPACE_SESSION_COOKIE,
} from "../../lib/auth";
import { DELETE, POST } from "../../app/api/session/route";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));

describe("Circumvision open workspace session", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    cookiesMock.mockResolvedValue({ get: vi.fn(() => undefined) });
  });

  it("admits any email remembered in the browser cookie", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) => name === WORKSPACE_SESSION_COOKIE
        ? { value: encodeWorkspaceSession(" Anybody@Example.com ") }
        : undefined),
    });

    await expect(getCircumvisionSession()).resolves.toMatchObject({
      authenticated: true,
      authorized: true,
      user: { id: OPEN_WORKSPACE_OWNER_ID, email: "anybody@example.com" },
    });
    await expect(requireCircumvisionUser()).resolves.toMatchObject({ id: OPEN_WORKSPACE_OWNER_ID });
  });

  it("asks for an email only when the remembered cookie is absent", async () => {
    await expect(getCircumvisionSession()).resolves.toMatchObject({
      authenticated: false,
      authorized: false,
      user: null,
    });
    await expect(requireCircumvisionUser()).rejects.toMatchObject({ status: 401 });
  });

  it("creates a one-year session immediately without sending an email", async () => {
    const response = await POST(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ email: "open@example.com" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authenticated: true, user: { id: OPEN_WORKSPACE_OWNER_ID } });
    expect(response.headers.get("set-cookie")).toContain(`${WORKSPACE_SESSION_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=31536000");
  });

  it("clears the remembered email when switching accounts", async () => {
    const response = await DELETE(new Request("http://localhost/api/session", {
      method: "DELETE",
      headers: { Origin: "http://localhost" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
