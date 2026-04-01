// --- Pacing ---

export interface MutationPacingPolicy {
  jitterMinMs: number;
  jitterMaxMs: number;
  cooldownEvery: number;
  cooldownMs: number;
}

export interface MutationPacingOptions {
  jitterMinMs?: string | number;
  jitterMaxMs?: string | number;
  cooldownEvery?: string | number;
  cooldownMs?: string | number;
}

const DEFAULT_MUTATION_PACING_POLICY: MutationPacingPolicy = {
  jitterMinMs: 250,
  jitterMaxMs: 1_250,
  cooldownEvery: 50,
  cooldownMs: 45_000
};

function parseNonNegativeInteger(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function resolveMutationPacingPolicy(options: MutationPacingOptions): MutationPacingPolicy {
  const jitterMinMs = parseNonNegativeInteger(options.jitterMinMs, DEFAULT_MUTATION_PACING_POLICY.jitterMinMs);
  const jitterMaxMs = Math.max(jitterMinMs, parseNonNegativeInteger(options.jitterMaxMs, DEFAULT_MUTATION_PACING_POLICY.jitterMaxMs));
  const cooldownEvery = parseNonNegativeInteger(options.cooldownEvery, DEFAULT_MUTATION_PACING_POLICY.cooldownEvery);
  const cooldownMs = parseNonNegativeInteger(options.cooldownMs, DEFAULT_MUTATION_PACING_POLICY.cooldownMs);

  return {
    jitterMinMs,
    jitterMaxMs,
    cooldownEvery,
    cooldownMs
  };
}

export function computeMutationPacingDelay(
  policy: MutationPacingPolicy,
  processedCount: number,
  randomValue = Math.random()
): {
  jitterMs: number;
  cooldownMs: number;
  totalDelayMs: number;
} {
  const normalizedRandom = Math.min(Math.max(randomValue, 0), 1);
  const jitterMs =
    policy.jitterMaxMs <= policy.jitterMinMs
      ? policy.jitterMinMs
      : Math.round(policy.jitterMinMs + normalizedRandom * (policy.jitterMaxMs - policy.jitterMinMs));
  const cooldownMs = policy.cooldownEvery > 0 && processedCount > 0 && processedCount % policy.cooldownEvery === 0 ? policy.cooldownMs : 0;

  return {
    jitterMs,
    cooldownMs,
    totalDelayMs: jitterMs + cooldownMs
  };
}

// --- Retry ---

export interface MutationRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface MutationRetryOptions {
  maxAttempts?: string | number;
  retryInitialDelayMs?: string | number;
  retryMaxDelayMs?: string | number;
}

const DEFAULT_RETRY_POLICY: MutationRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 8_000,
  backoffMultiplier: 2
};

function parsePositiveInteger(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function resolveMutationRetryPolicy(options: MutationRetryOptions): MutationRetryPolicy {
  const maxAttempts = Math.max(1, parsePositiveInteger(options.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts));
  const initialDelayMs = Math.max(1, parsePositiveInteger(options.retryInitialDelayMs, DEFAULT_RETRY_POLICY.initialDelayMs));
  const maxDelayMs = Math.max(initialDelayMs, parsePositiveInteger(options.retryMaxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs));

  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier: DEFAULT_RETRY_POLICY.backoffMultiplier
  };
}

export function computeRetryDelayMs(policy: MutationRetryPolicy, failedAttempt: number): number {
  const exponent = Math.max(0, failedAttempt - 1);
  const computedDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, exponent);
  return Math.min(policy.maxDelayMs, Math.round(computedDelay));
}

export async function runWithRetries<T>(args: {
  policy: MutationRetryPolicy;
  run: (attempt: number) => Promise<T>;
  onRetry?: (details: { attempt: number; nextAttempt: number; delayMs: number; error: Error }) => Promise<void> | void;
  sleep?: (delayMs: number) => Promise<void>;
  shouldRetry?: (error: Error) => boolean;
}): Promise<{ result: T; attempts: number }> {
  const sleep =
    args.sleep ??
    (async (delayMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= args.policy.maxAttempts; attempt += 1) {
    try {
      const result = await args.run(attempt);
      return { result, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (args.shouldRetry && !args.shouldRetry(lastError)) {
        throw lastError;
      }
      if (attempt >= args.policy.maxAttempts) {
        break;
      }

      const delayMs = computeRetryDelayMs(args.policy, attempt);
      await args.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error: lastError
      });
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error("Mutation retry failed without an error");
}
