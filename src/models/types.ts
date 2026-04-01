export type Phase =
  | "login"
  | "export-storage-state"
  | "doctor"
  | "setup"
  | "probe-selectors"
  | "inventory"
  | "copy"
  | "verify"
  | "repair"
  | "delete"
  | "performance"
  | "run"
  | "playlists"
  | "move"
  | "chunked-move";

export interface RunConfig {
  profileDir: string | undefined;
  storageStatePath: string | undefined;
  expectedAccount: string | undefined;
  browserChannel: string | undefined;
  browserExecutablePath: string | undefined;
  browserCdpUrl: string | undefined;
  browserWindowWidth: number | undefined;
  browserWindowHeight: number | undefined;
  browserWindowPositionX: number | undefined;
  browserWindowPositionY: number | undefined;
  browserViewportWidth: number | undefined;
  browserViewportHeight: number | undefined;
  headless: boolean;
  artifactsDirName: string;
  stopOnAccountMismatch: boolean;
  slowMoMs: number;
  youtubeBaseUrl: string;
}

export interface RunArtifacts {
  runId: string;
  runDir: string;
  artifactsDir: string;
  screenshotsDir: string;
  tracesDir: string;
  dbPath: string;
  eventsPath: string;
  logPath: string;
  checkpointPath: string;
}

export interface RunStateRow {
  runId: string;
  phase: Phase;
  status: "running" | "paused" | "complete" | "failed";
  startedAt: string;
  updatedAt: string;
}

export interface EventRecord {
  runId: string;
  phase: Phase;
  level: "info" | "warn" | "error";
  eventType: string;
  message: string;
  details?: Record<string, unknown> | undefined;
  createdAt: string;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export interface ProbeReport {
  currentUrl: string;
  title: string;
  accountLabel: string | null;
  selectorCounts: Record<string, number>;
  bodyTextSample: string;
  signInLinkCount: number;
  menuProbe?: {
    opened: boolean;
    buttonSelector: string | null;
    itemCount: number;
    itemTexts: string[];
  };
}

export interface InventoryItem {
  sourceIndex: number;
  title: string | null;
  videoUrl: string | null;
  videoId: string | null;
  channelName: string | null;
  metadataText: string | null;
  unavailableKind: "none" | "private" | "deleted" | "unavailable" | "unknown";
}

export interface VerificationMismatch {
  sourceIndex: number;
  field: "missing-target-item" | "videoId" | "title" | "videoUrl" | "ambiguous-source-item";
  expected: string | null;
  actual: string | null;
}

export interface InventoryFingerprint {
  total: number;
  orderedHash: string;
  headIdentifiers: string[];
  tailIdentifiers: string[];
}

export interface SourceSnapshot {
  runId: string;
  currentUrl: string;
  capturedAt: string;
  metadataVersion: number | null;
  metadataComplete: boolean;
  total: number;
  scrollPasses: number;
  requestedMaxItems: number | null;
  bounded: boolean;
  fingerprint: InventoryFingerprint;
  items: InventoryItem[];
}

export interface CheckpointRecord {
  phase: Phase;
  updatedAt: string;
  payload: Record<string, unknown>;
}

export type SourceItemPolicy =
  | "copyable"
  | "expected-non-copyable"
  | "ambiguous-unavailable";

export interface DeletionEligibilityDecision {
  eligible: boolean;
  reasons: string[];
}

export interface ProductionDeleteAuthorization {
  authorized: boolean;
  reasons: string[];
  verificationRunId: string;
  sourceSnapshotRunId: string | null;
  targetPlaylist: string;
  verificationMode: "full" | "subset";
  verifiedAt: string;
}

export interface NumericStats {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p95: number | null;
  stddev: number | null;
}

export interface CopyPerformanceRunReport {
  runId: string;
  startedAt: string | null;
  completedAt: string | null;
  itemCount: number;
  timingSampleCount: number;
  resultCounts: Record<string, number>;
  totalDurationMs: number | null;
  startupLatencyMs: number | null;
  completionOverheadMs: number | null;
  overallRateItemsPerSecond: number | null;
  itemLatencyMs: NumericStats;
  itemLatencyByResult: Record<string, NumericStats>;
  timingBreakdownByStep: Record<string, NumericStats>;
  timingBreakdownByResult: Record<string, Record<string, NumericStats>>;
}

export interface CopyPerformanceReport {
  generatedAt: string;
  analyzedRunIds: string[];
  runReports: CopyPerformanceRunReport[];
  aggregate: {
    totalDurationMs: NumericStats;
    startupLatencyMs: NumericStats;
    completionOverheadMs: NumericStats;
    overallRateItemsPerSecond: NumericStats;
    itemLatencyMs: NumericStats;
    itemLatencyByResult: Record<string, NumericStats>;
    timingBreakdownByStep: Record<string, NumericStats>;
    timingBreakdownByResult: Record<string, Record<string, NumericStats>>;
  };
}

export interface FullRunPreflightReport {
  generatedAt: string;
  sourceSnapshotRunId: string;
  sourceSnapshotMetadataVersion: number | null;
  sourceSnapshotMetadataComplete: boolean;
  sourceTotal: number;
  sourceSnapshotBounded: boolean;
  sourceSnapshotRequestedMaxItems: number | null;
  copyableCount: number;
  expectedNonCopyableCount: number;
  ambiguousCount: number;
  snapshotEligibleForProductionAuthorization: boolean;
  snapshotBlockingReasons: string[];
  performanceBaselineRunIds: string[];
  latencyBasis: {
    resultBucket: string | null;
    meanMsPerItem: number | null;
    p95MsPerItem: number | null;
  };
  estimatedCopyDuration: {
    meanSeconds: number | null;
    meanHours: number | null;
    p95Seconds: number | null;
    p95Hours: number | null;
  };
}

export interface WatchLaterCapacitySummary {
  videoCount: number | null;
  maxItems: number;
  remainingCapacity: number | null;
  nearCapacity: boolean;
  atCapacity: boolean;
}
