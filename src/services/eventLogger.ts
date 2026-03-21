import fs from "node:fs";

import pino from "pino";

import type { EventRecord, Phase } from "../models/types.js";
import { isoNow } from "../utils/time.js";

export interface EventLogger {
  logger: pino.Logger;
  logEvent: (phase: Phase, level: EventRecord["level"], eventType: string, message: string, details?: Record<string, unknown>) => void;
}

export function createEventLogger(
  eventsPath: string,
  logPath: string,
  runId: string,
  consoleStream: NodeJS.WritableStream = process.stdout
): EventLogger {
  const logger = pino(
    {
      level: "info",
      base: { runId }
    },
    pino.multistream([
      { stream: consoleStream },
      { stream: fs.createWriteStream(logPath, { flags: "a" }) }
    ])
  );

  const eventStream = fs.createWriteStream(eventsPath, { flags: "a" });

  const logEvent: EventLogger["logEvent"] = (phase, level, eventType, message, details) => {
    const record: EventRecord = {
      runId,
      phase,
      level,
      eventType,
      message,
      ...(details ? { details } : {}),
      createdAt: isoNow()
    };

    eventStream.write(`${JSON.stringify(record)}\n`);
    logger[level]({ phase, eventType, ...details }, message);
  };

  return { logger, logEvent };
}
