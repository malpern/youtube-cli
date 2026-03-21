import { describe, expect, it, vi } from "vitest";

import { computeRetryDelayMs, resolveMutationRetryPolicy, runWithRetries } from "./mutationRetry.js";

describe("resolveMutationRetryPolicy", () => {
  it("uses sane defaults when values are missing", () => {
    expect(resolveMutationRetryPolicy({})).toEqual({
      maxAttempts: 3,
      initialDelayMs: 1_000,
      maxDelayMs: 8_000,
      backoffMultiplier: 2
    });
  });

  it("normalizes invalid values back to defaults", () => {
    expect(
      resolveMutationRetryPolicy({
        maxAttempts: "0",
        retryInitialDelayMs: "-1",
        retryMaxDelayMs: "nope"
      })
    ).toEqual({
      maxAttempts: 3,
      initialDelayMs: 1_000,
      maxDelayMs: 8_000,
      backoffMultiplier: 2
    });
  });
});

describe("computeRetryDelayMs", () => {
  it("backs off exponentially and caps at the maximum delay", () => {
    const policy = resolveMutationRetryPolicy({
      maxAttempts: 5,
      retryInitialDelayMs: 250,
      retryMaxDelayMs: 600
    });

    expect(computeRetryDelayMs(policy, 1)).toBe(250);
    expect(computeRetryDelayMs(policy, 2)).toBe(500);
    expect(computeRetryDelayMs(policy, 3)).toBe(600);
  });
});

describe("runWithRetries", () => {
  it("returns on the first successful attempt", async () => {
    const run = vi.fn(async () => "ok");

    await expect(runWithRetries({ policy: resolveMutationRetryPolicy({}), run })).resolves.toEqual({
      result: "ok",
      attempts: 1
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries until success", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValueOnce("ok");
    const retrySpy = vi.fn();
    const sleep = vi.fn(async () => undefined);

    await expect(
      runWithRetries({
        policy: resolveMutationRetryPolicy({ maxAttempts: 3, retryInitialDelayMs: 10, retryMaxDelayMs: 20 }),
        run,
        onRetry: retrySpy,
        sleep
      })
    ).resolves.toEqual({
      result: "ok",
      attempts: 3
    });

    expect(run).toHaveBeenCalledTimes(3);
    expect(retrySpy).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("throws the last error after exhausting attempts", async () => {
    const run = vi.fn(async () => {
      throw new Error("still failing");
    });

    await expect(
      runWithRetries({
        policy: resolveMutationRetryPolicy({ maxAttempts: 2, retryInitialDelayMs: 10 }),
        run,
        sleep: async () => undefined
      })
    ).rejects.toThrow("still failing");

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const run = vi.fn(async () => {
      throw new Error("auth required");
    });

    await expect(
      runWithRetries({
        policy: resolveMutationRetryPolicy({ maxAttempts: 3, retryInitialDelayMs: 10 }),
        run,
        sleep: async () => undefined,
        shouldRetry: (error) => error.message !== "auth required"
      })
    ).rejects.toThrow("auth required");

    expect(run).toHaveBeenCalledTimes(1);
  });
});
