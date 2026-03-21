import { describe, expect, it } from "vitest";

import { evaluateYouTubeAuthHealth, isGoogleAuthUrl } from "./authGuard.js";

describe("isGoogleAuthUrl", () => {
  it("detects Google account auth URLs", () => {
    expect(isGoogleAuthUrl("https://accounts.google.com/v3/signin/identifier")).toBe(true);
  });

  it("ignores normal YouTube URLs", () => {
    expect(isGoogleAuthUrl("https://www.youtube.com/watch?v=abc123")).toBe(false);
  });
});

describe("evaluateYouTubeAuthHealth", () => {
  it("fails closed for auth redirects", () => {
    const result = evaluateYouTubeAuthHealth({
      expectedAccount: "personal",
      snapshot: {
        signedIn: false,
        accountLabel: null,
        currentUrl: "https://accounts.google.com/v3/signin/identifier",
        pageTitle: "Sign in - Google Accounts"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("redirected-to-google-auth");
  });

  it("fails when YouTube is not signed in", () => {
    const result = evaluateYouTubeAuthHealth({
      expectedAccount: undefined,
      snapshot: {
        signedIn: false,
        accountLabel: null,
        currentUrl: "https://www.youtube.com/",
        pageTitle: "YouTube"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-signed-in-to-youtube");
  });

  it("fails on account mismatch", () => {
    const result = evaluateYouTubeAuthHealth({
      expectedAccount: "personal",
      snapshot: {
        signedIn: true,
        accountLabel: "Google Account: work@example.com",
        currentUrl: "https://www.youtube.com/",
        pageTitle: "YouTube"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signed-in-account-mismatch");
  });

  it("passes when the signed-in account matches", () => {
    const result = evaluateYouTubeAuthHealth({
      expectedAccount: "personal@example.com",
      snapshot: {
        signedIn: true,
        accountLabel: "Google Account: personal@example.com",
        currentUrl: "https://www.youtube.com/",
        pageTitle: "YouTube"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });
});
