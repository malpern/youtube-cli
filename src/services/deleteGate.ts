import type { VerificationReport } from "./verification.js";

export interface DeleteGateDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateDeleteReadiness(args: {
  confirmDelete: boolean;
  verificationReport: VerificationReport;
}): DeleteGateDecision {
  const reasons: string[] = [];

  if (!args.confirmDelete) {
    reasons.push("missing-confirm-delete");
  }

  const authorization = args.verificationReport.productionDeleteAuthorization;
  if (!authorization.authorized) {
    reasons.push(...authorization.reasons);
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}
