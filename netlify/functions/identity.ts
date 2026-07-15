import type { UserSignupEvent } from "@netlify/functions";

function workspaceRoles(event: UserSignupEvent) {
  const metadataRoles = Array.isArray(event.user.appMetadata?.roles)
    ? event.user.appMetadata.roles.filter((role): role is string => typeof role === "string")
    : [];
  return [...new Set([...(event.user.roles || []), ...metadataRoles, "circumvision"])];
}

const identityEvents = {
  userSignup(event: UserSignupEvent) {
    // Only invitations receive workspace access. This remains a second line of
    // defense if Identity registration is accidentally changed from invite-only.
    if (!event.user.invitedAt) return event.deny();
    const roles = workspaceRoles(event);
    return {
      user: {
        ...event.user,
        roles,
        appMetadata: {
          ...event.user.appMetadata,
          roles,
        },
      },
    };
  },
};

export default identityEvents;
