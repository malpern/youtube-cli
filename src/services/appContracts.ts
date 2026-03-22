import type { DoctorCheck } from "../models/types.js";

export const APP_CONTRACT_VERSION = 1;

export type AppContractSurface = "doctor" | "playlists" | "move";

export interface AppContractEnvelope {
  appContractVersion: number;
  appContractSurface: AppContractSurface;
}

export function buildDoctorAppPayload(args: {
  ok: boolean;
  runId: string;
  checks: DoctorCheck[];
}): AppContractEnvelope & {
  ok: boolean;
  runId: string;
  checks: DoctorCheck[];
} {
  return buildAppContractEnvelope("doctor", args);
}

export function buildPlaylistsAppPayload<T extends Record<string, unknown>>(
  payload: T
): AppContractEnvelope & T {
  return buildAppContractEnvelope("playlists", payload);
}

export function buildMoveAppPayload<T extends Record<string, unknown>>(
  runId: string,
  payload: T
): AppContractEnvelope & { runId: string } & T {
  return buildAppContractEnvelope("move", {
    runId,
    ...payload
  });
}

function buildAppContractEnvelope<T extends Record<string, unknown>>(
  surface: AppContractSurface,
  payload: T
): AppContractEnvelope & T {
  return {
    appContractVersion: APP_CONTRACT_VERSION,
    appContractSurface: surface,
    ...payload
  };
}
