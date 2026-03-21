import { describe, expect, it } from "vitest";

import { computeMutationPacingDelay, resolveMutationPacingPolicy } from "./mutationPacing.js";

describe("resolveMutationPacingPolicy", () => {
  it("uses conservative defaults", () => {
    expect(resolveMutationPacingPolicy({})).toEqual({
      jitterMinMs: 250,
      jitterMaxMs: 1_250,
      cooldownEvery: 50,
      cooldownMs: 45_000
    });
  });

  it("normalizes invalid values", () => {
    expect(
      resolveMutationPacingPolicy({
        jitterMinMs: "-1",
        jitterMaxMs: "10",
        cooldownEvery: "-5",
        cooldownMs: "nope"
      })
    ).toEqual({
      jitterMinMs: 250,
      jitterMaxMs: 250,
      cooldownEvery: 50,
      cooldownMs: 45_000
    });
  });
});

describe("computeMutationPacingDelay", () => {
  it("returns jitter plus cooldown on configured boundaries", () => {
    const policy = resolveMutationPacingPolicy({
      jitterMinMs: 100,
      jitterMaxMs: 200,
      cooldownEvery: 5,
      cooldownMs: 5_000
    });

    expect(computeMutationPacingDelay(policy, 4, 0.5)).toEqual({
      jitterMs: 150,
      cooldownMs: 0,
      totalDelayMs: 150
    });
    expect(computeMutationPacingDelay(policy, 5, 0.5)).toEqual({
      jitterMs: 150,
      cooldownMs: 5_000,
      totalDelayMs: 5_150
    });
  });
});
