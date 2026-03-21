import { describe, expect, it } from "vitest";

import type { WorkflowChildSummaries } from "./workflowSummary.js";
import { evaluateWorkflowProductionReadiness } from "./workflowReadiness.js";

function makeChildSummaries(overrides: Partial<WorkflowChildSummaries> = {}): WorkflowChildSummaries {
  return {
    setup: null,
    inventory: {
      runId: "inventory-a",
      total: 10,
      scrollPasses: 3,
      requestedMaxItems: null,
      bounded: false,
      fingerprint: null
    },
    copy: null,
    verify: {
      runId: "verify-a",
      passed: true,
      targetPassed: true,
      driftPassed: true,
      verificationMode: "full",
      deletionEligible: true,
      deletionBlockedBy: [],
      authorizationVerificationRunId: "verify-a",
      targetWindowStart: 0,
      targetWindowMatched: true
    },
    ...overrides
  };
}

describe("evaluateWorkflowProductionReadiness", () => {
  it("marks a full authorized workflow as ready", () => {
    expect(evaluateWorkflowProductionReadiness(makeChildSummaries())).toEqual({
      readyForProductionDeleteAuthorization: true,
      blockingReasons: []
    });
  });

  it("surfaces verify blocking reasons", () => {
    const readiness = evaluateWorkflowProductionReadiness(
      makeChildSummaries({
        verify: {
          runId: "verify-a",
          passed: true,
          targetPassed: true,
          driftPassed: true,
          verificationMode: "subset",
          deletionEligible: false,
          deletionBlockedBy: ["verification-was-subset-only", "source-snapshot-was-bounded"],
          authorizationVerificationRunId: "verify-a",
          targetWindowStart: 2,
          targetWindowMatched: true
        }
      })
    );

    expect(readiness).toEqual({
      readyForProductionDeleteAuthorization: false,
      blockingReasons: ["verification-was-subset-only", "source-snapshot-was-bounded", "verification-mode-not-full"]
    });
  });

  it("blocks when the inventory summary shows a bounded snapshot even without verify context", () => {
    expect(
      evaluateWorkflowProductionReadiness(
        makeChildSummaries({
          inventory: {
            runId: "inventory-a",
            total: 1,
            scrollPasses: 1,
            requestedMaxItems: 1,
            bounded: true,
            fingerprint: null
          },
          verify: null
        })
      )
    ).toEqual({
      readyForProductionDeleteAuthorization: false,
      blockingReasons: ["missing-verify-summary", "source-snapshot-was-bounded"]
    });
  });
});
