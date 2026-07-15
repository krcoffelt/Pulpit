import { describe, expect, it } from "vitest";
import { PublicError, safeErrorMessage } from "../../lib/public-error";

describe("safe production errors", () => {
  it("preserves messages explicitly marked safe for the user", () => {
    expect(safeErrorMessage(new PublicError("Resume the upload.", 409), "Something failed.")).toBe("Resume the upload.");
  });

  it("does not expose unexpected provider or filesystem errors", () => {
    expect(safeErrorMessage(new Error("/tmp/source.mp4: provider stack trace"), "The export failed.")).toBe("The export failed.");
  });
});
