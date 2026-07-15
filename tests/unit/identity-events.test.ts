import type { UserSignupEvent } from "@netlify/functions";
import { describe, expect, it, vi } from "vitest";
import identityEvents from "../../netlify/functions/identity";

describe("Circumvision Identity lifecycle policy", () => {
  it("assigns the workspace role to accepted invitees", () => {
    const event = {
      user: {
        id: "invited-user",
        email: "editor@example.com",
        invitedAt: "2026-07-15T00:00:00Z",
        roles: ["existing"],
        appMetadata: { provider: "email" },
      },
      deny: vi.fn(),
    } as unknown as UserSignupEvent;

    const result = identityEvents.userSignup(event);

    expect(event.deny).not.toHaveBeenCalled();
    expect(result?.user.roles).toEqual(["existing", "circumvision"]);
    expect(result?.user.appMetadata?.roles).toEqual(["existing", "circumvision"]);
  });

  it("denies a signup that was not created by an invitation", () => {
    const deny = vi.fn(() => undefined);
    const event = {
      user: { id: "open-signup", email: "stranger@example.com" },
      deny,
    } as unknown as UserSignupEvent;

    expect(identityEvents.userSignup(event)).toBeUndefined();
    expect(deny).toHaveBeenCalledOnce();
  });
});
