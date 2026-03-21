import type { Page } from "playwright";

import { accountMatches, captureAccountSnapshot, type AccountSnapshot } from "../browser/accountCheck.js";
import type { RunConfig } from "../models/types.js";

export interface AuthHealthResult {
  ok: boolean;
  reason: string | null;
  snapshot: AccountSnapshot;
}

export class AuthenticationRequiredError extends Error {
  readonly snapshot: AccountSnapshot;
  readonly reason: string;
  readonly contextLabel: string;

  constructor(args: { snapshot: AccountSnapshot; reason: string; contextLabel: string }) {
    super(`Authentication required during ${args.contextLabel}: ${args.reason}`);
    this.name = "AuthenticationRequiredError";
    this.snapshot = args.snapshot;
    this.reason = args.reason;
    this.contextLabel = args.contextLabel;
  }
}

export function isGoogleAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "accounts.google.com" || parsed.pathname.includes("/signin");
  } catch {
    return false;
  }
}

export function evaluateYouTubeAuthHealth(args: {
  snapshot: AccountSnapshot;
  expectedAccount: string | undefined;
}): AuthHealthResult {
  const { snapshot, expectedAccount } = args;

  if (isGoogleAuthUrl(snapshot.currentUrl)) {
    return { ok: false, reason: "redirected-to-google-auth", snapshot };
  }

  if (!snapshot.signedIn) {
    return { ok: false, reason: "not-signed-in-to-youtube", snapshot };
  }

  if (!accountMatches(expectedAccount, snapshot)) {
    return { ok: false, reason: "signed-in-account-mismatch", snapshot };
  }

  return { ok: true, reason: null, snapshot };
}

export async function assertAuthenticatedYouTubeSession(
  page: Page,
  config: RunConfig,
  contextLabel: string,
  options: { navigate?: boolean } = {}
): Promise<AccountSnapshot> {
  const snapshot = await captureAccountSnapshot(page, config.youtubeBaseUrl, {
    navigate: options.navigate ?? false,
    waitForNetworkIdle: false,
    waitTimeoutMs: 5_000
  });
  const health = evaluateYouTubeAuthHealth({
    snapshot,
    expectedAccount: config.expectedAccount
  });

  if (!health.ok || !health.reason) {
    throw new AuthenticationRequiredError({
      snapshot,
      reason: health.reason ?? "unknown-auth-state",
      contextLabel
    });
  }

  return snapshot;
}

export async function throwIfAuthenticationLost(
  page: Page,
  config: RunConfig,
  contextLabel: string,
  fallbackError: unknown
): Promise<never> {
  try {
    await assertAuthenticatedYouTubeSession(page, config, contextLabel);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      throw error;
    }
  }

  throw fallbackError;
}
