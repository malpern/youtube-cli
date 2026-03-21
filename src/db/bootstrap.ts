import Database from "better-sqlite3";

import { bootstrapSql } from "./schema.js";
import type { EventRecord, Phase, RunStateRow } from "../models/types.js";
import { isoNow } from "../utils/time.js";

export interface DatabaseBundle {
  db: Database.Database;
  upsertRunState: (phase: Phase, status: RunStateRow["status"]) => void;
  insertEvent: (record: EventRecord) => void;
  saveCheckpoint: (phase: Phase, checkpoint: Record<string, unknown>) => void;
}

export function openDatabase(dbPath: string, runId: string): DatabaseBundle {
  const db = new Database(dbPath);
  db.exec(bootstrapSql);

  const upsertRunStateStmt = db.prepare(`
    INSERT INTO run_state (run_id, phase, status, started_at, updated_at)
    VALUES (@run_id, @phase, @status, @started_at, @updated_at)
    ON CONFLICT(run_id) DO UPDATE SET
      phase = excluded.phase,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  const insertEventStmt = db.prepare(`
    INSERT INTO events (run_id, phase, level, event_type, message, details_json, created_at)
    VALUES (@run_id, @phase, @level, @event_type, @message, @details_json, @created_at)
  `);

  const saveCheckpointStmt = db.prepare(`
    INSERT INTO checkpoints (run_id, phase, checkpoint_json, updated_at)
    VALUES (@run_id, @phase, @checkpoint_json, @updated_at)
    ON CONFLICT(run_id) DO UPDATE SET
      phase = excluded.phase,
      checkpoint_json = excluded.checkpoint_json,
      updated_at = excluded.updated_at
  `);

  return {
    db,
    upsertRunState(phase, status) {
      const now = isoNow();
      upsertRunStateStmt.run({
        run_id: runId,
        phase,
        status,
        started_at: now,
        updated_at: now
      });
    },
    insertEvent(record) {
      insertEventStmt.run({
        run_id: record.runId,
        phase: record.phase,
        level: record.level,
        event_type: record.eventType,
        message: record.message,
        details_json: record.details ? JSON.stringify(record.details) : null,
        created_at: record.createdAt
      });
    },
    saveCheckpoint(phase, checkpoint) {
      saveCheckpointStmt.run({
        run_id: runId,
        phase,
        checkpoint_json: JSON.stringify(checkpoint),
        updated_at: isoNow()
      });
    }
  };
}
