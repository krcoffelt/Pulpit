import { afterEach, describe, expect, it } from "vitest";
import { requireTrustedMutation } from "../../lib/api";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("trusted mutation origins", () => {
  it("accepts a public origin forwarded through Netlify's internal handler", () => {
    const request = new Request("http://internal-function/api/projects", {
      method: "POST",
      headers: {
        origin: "https://circumvision.netlify.app",
        host: "internal-function",
        "x-forwarded-host": "circumvision.netlify.app",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
      },
    });

    expect(() => requireTrustedMutation(request)).not.toThrow();
  });

  it("accepts the explicitly configured custom-domain origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://clips.example.com";
    const request = new Request("http://internal-function/api/projects", {
      method: "POST",
      headers: { origin: "https://clips.example.com", "sec-fetch-site": "same-origin" },
    });

    expect(() => requireTrustedMutation(request)).not.toThrow();
  });

  it("rejects cross-site mutations even when forwarded headers are spoofed", () => {
    const request = new Request("http://internal-function/api/projects", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "x-forwarded-host": "circumvision.netlify.app",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "cross-site",
      },
    });

    expect(() => requireTrustedMutation(request)).toThrow("untrusted origin");
  });
});
