import { describe, expect, it } from "vitest";
import { getCircumvisionSession, OPEN_WORKSPACE_OWNER_ID, requireCircumvisionUser } from "../../lib/auth";
import { DELETE, GET, POST } from "../../app/api/session/route";

describe("Circumvision open workspace", () => {
  it("opens without cookies or credentials", async () => {
    await expect(getCircumvisionSession()).resolves.toMatchObject({ authenticated: true, authorized: true, user: { id: OPEN_WORKSPACE_OWNER_ID } });
    await expect(requireCircumvisionUser()).resolves.toMatchObject({ id: OPEN_WORKSPACE_OWNER_ID });
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ authenticated: true });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps old session clients compatible without an email", async () => {
    const response = await POST(new Request("http://localhost/api/session", { method: "POST", headers: { Origin: "http://localhost" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authenticated: true });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("clears legacy cookies without closing the open workspace", async () => {
    const response = await DELETE(new Request("http://localhost/api/session", { method: "DELETE", headers: { Origin: "http://localhost" } }));
    await expect(response.json()).resolves.toMatchObject({ authenticated: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("continues to reject cross-site mutations", async () => {
    const response = await POST(new Request("http://localhost/api/session", { method: "POST", headers: { Origin: "https://untrusted.example" } }));
    expect(response.status).toBe(403);
  });
});
