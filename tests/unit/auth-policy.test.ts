import { describe, expect, it } from "vitest";
import { isAuthorizedIdentityUser } from "../../lib/auth";

describe("Circumvision identity authorization", () => {
  it("rejects a confirmed account that self-registered", () => {
    expect(isAuthorizedIdentityUser({ email: "stranger@example.com" }, new Set())).toBe(false);
  });

  it("accepts an account created through an invitation", () => {
    expect(isAuthorizedIdentityUser({ email: "tyshone@example.com", invitedAt: "2026-07-15T00:00:00Z" }, new Set())).toBe(true);
  });

  it("accepts an explicitly assigned workspace role", () => {
    expect(isAuthorizedIdentityUser({ email: "editor@example.com", roles: ["circumvision"] }, new Set())).toBe(true);
  });

  it("accepts a confirmed account while Identity registration is invite-only", () => {
    expect(isAuthorizedIdentityUser(
      { email: "owner@example.com", confirmedAt: "2026-07-15T00:00:00Z" },
      new Set(),
      true,
    )).toBe(true);
  });

  it("rejects a confirmed account when Identity registration is open", () => {
    expect(isAuthorizedIdentityUser(
      { email: "uninvited@example.com", confirmedAt: "2026-07-15T00:00:00Z" },
      new Set(),
      false,
    )).toBe(false);
  });

  it("applies the optional email allowlist after invitation checks", () => {
    const allowlist = new Set(["tyshone@example.com"]);
    expect(isAuthorizedIdentityUser({ email: "tyshone@example.com", invitedAt: "2026-07-15T00:00:00Z" }, allowlist)).toBe(true);
    expect(isAuthorizedIdentityUser({ email: "other@example.com", invitedAt: "2026-07-15T00:00:00Z" }, allowlist)).toBe(false);
    expect(isAuthorizedIdentityUser(
      { email: "other@example.com", confirmedAt: "2026-07-15T00:00:00Z" },
      allowlist,
      true,
    )).toBe(false);
  });
});
