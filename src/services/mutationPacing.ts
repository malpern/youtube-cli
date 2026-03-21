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
