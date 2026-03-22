import { describe, expect, it } from "vitest";

import { APP_CONTRACT_VERSION, buildDoctorAppPayload, buildMoveAppPayload, buildPlaylistsAppPayload } from "./appContracts.js";

describe("appContracts", () => {
  it("builds the doctor app payload with a versioned envelope", () => {
    const payload = buildDoctorAppPayload({
      ok: true,
      runId: "doctor-run",
      checks: [
        {
          name: "youtube.auth",
          ok: true,
          message: "Signed in to YouTube"
        }
      ]
    });

    expect(payload).toEqual({
      appContractVersion: APP_CONTRACT_VERSION,
      appContractSurface: "doctor",
      ok: true,
      runId: "doctor-run",
      checks: [
        {
          name: "youtube.auth",
          ok: true,
          message: "Signed in to YouTube"
        }
      ]
    });
  });

  it("builds the playlists app payload with a versioned envelope", () => {
    const payload = buildPlaylistsAppPayload({
      ok: true,
      runId: "playlists-run",
      playlists: [{ title: "Old Watch", visibility: "Private" }]
    });

    expect(payload).toEqual({
      appContractVersion: APP_CONTRACT_VERSION,
      appContractSurface: "playlists",
      ok: true,
      runId: "playlists-run",
      playlists: [{ title: "Old Watch", visibility: "Private" }]
    });
  });

  it("builds move stream payloads with a versioned envelope", () => {
    const payload = buildMoveAppPayload("move-run", {
      type: "started",
      workflow: {
        workflowRunId: "move-run-run",
        verifyRunId: "move-run-run-verify",
        deleteRunId: "move-run-delete"
      }
    });

    expect(payload).toEqual({
      appContractVersion: APP_CONTRACT_VERSION,
      appContractSurface: "move",
      runId: "move-run",
      type: "started",
      workflow: {
        workflowRunId: "move-run-run",
        verifyRunId: "move-run-run-verify",
        deleteRunId: "move-run-delete"
      }
    });
  });
});
