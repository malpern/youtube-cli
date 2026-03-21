export function isoNow(): string {
  return new Date().toISOString();
}

export function makeRunId(now = new Date()): string {
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${suffix}`;
}
