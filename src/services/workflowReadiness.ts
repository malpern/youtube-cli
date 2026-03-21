import type { WorkflowChildSummaries } from "./workflowSummary.js";

export interface WorkflowProductionReadiness {
  readyForProductionDeleteAuthorization: boolean;
  blockingReasons: string[];
}

export function evaluateWorkflowProductionReadiness(childSummaries: WorkflowChildSummaries): WorkflowProductionReadiness {
  const reasons = new Set<string>();

  if (!childSummaries.verify) {
    reasons.add("missing-verify-summary");
  } else {
    if (childSummaries.verify.deletionEligible !== true) {
      for (const reason of childSummaries.verify.deletionBlockedBy ?? ["verification-not-production-authorized"]) {
        reasons.add(reason);
      }
    }

    if (childSummaries.verify.verificationMode !== "full") {
      reasons.add("verification-mode-not-full");
    }
  }

  if (childSummaries.inventory?.bounded) {
    reasons.add("source-snapshot-was-bounded");
  }

  return {
    readyForProductionDeleteAuthorization: reasons.size === 0,
    blockingReasons: [...reasons]
  };
}
