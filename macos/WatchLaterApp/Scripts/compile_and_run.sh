#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXECUTABLE_NAME=${EXECUTABLE_NAME:-WatchLaterApp}
APP_NAME=${APP_NAME:-You Watch Later}
APP_BUNDLE="${ROOT_DIR}/${APP_NAME}.app"
APP_PROCESS_PATTERN="${APP_BUNDLE}/Contents/MacOS/${EXECUTABLE_NAME}"
DEBUG_PROCESS_PATTERN="${ROOT_DIR}/.build/arm64-apple-macosx/debug/${EXECUTABLE_NAME}"
DEBUG_PROCESS_PATTERN_ALT="${ROOT_DIR}/.build/debug/${EXECUTABLE_NAME}"

pkill -f "${APP_PROCESS_PATTERN}" 2>/dev/null || true
pkill -f "${DEBUG_PROCESS_PATTERN}" 2>/dev/null || true
pkill -f "${DEBUG_PROCESS_PATTERN_ALT}" 2>/dev/null || true
pkill -x "${EXECUTABLE_NAME}" 2>/dev/null || true

APP_NAME="${APP_NAME}" EXECUTABLE_NAME="${EXECUTABLE_NAME}" SIGNING_MODE=adhoc "${ROOT_DIR}/Scripts/package_app.sh" debug

open "${APP_BUNDLE}"

for _ in {1..15}; do
  if pgrep -f "${APP_PROCESS_PATTERN}" >/dev/null 2>&1; then
    echo "OK: ${APP_NAME} is running from app bundle."
    exit 0
  fi
  sleep 0.4
done

echo "ERROR: ${APP_NAME} did not stay running." >&2
exit 1
