import type { RunContext } from "../app/runContext.js";
import type { Phase } from "../models/types.js";
import { AuthenticationRequiredError } from "./authGuard.js";

export function pauseRunForAuthentication(args: {
  ctx: RunContext;
  phase: Phase;
  error: AuthenticationRequiredError;
  payload: Record<string, unknown>;
}): void {
  const { ctx, phase, error, payload } = args;

  ctx.logEvent(phase, "error", "auth.paused", "Paused because the YouTube session is no longer authenticated", {
    authReason: error.reason,
    authContext: error.contextLabel,
    currentUrl: error.snapshot.currentUrl,
    pageTitle: error.snapshot.pageTitle,
    accountLabel: error.snapshot.accountLabel,
    ...payload
  });
  ctx.saveCheckpoint(phase, {
    ...payload,
    paused: true,
    pauseReason: "auth-required",
    authReason: error.reason,
    authContext: error.contextLabel,
    authSnapshot: {
      currentUrl: error.snapshot.currentUrl,
      pageTitle: error.snapshot.pageTitle,
      accountLabel: error.snapshot.accountLabel,
      signedIn: error.snapshot.signedIn
    }
  });
  ctx.db.upsertRunState(phase, "paused");
  process.exitCode = 2;
}
