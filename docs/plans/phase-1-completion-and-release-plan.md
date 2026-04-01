# Phase 1 Completion And Release Plan

## 🎯 Purpose

This document defines the finish line for phase 1 of this repository:

- a safety-first Playwright-backed tool for migrating YouTube Watch Later into another playlist
- a simple macOS companion surface that can exercise the real backend instead of mocks
- a stable release point that can remain usable while phase 2 evolves on a new branch

Phase 1 should be treated as a coherent product, not as a half-converted stepping stone.

## 📦 Phase 1 product definition

Phase 1 is complete when the repository provides:

- a working CLI for `doctor`, `inventory`, `setup`, `copy`, `verify`, `repair`, `delete`, `playlists`, `move`, `status`, `preflight`, and `copy-performance`
- a durable run model with logs, checkpoints, summaries, and verification artifacts
- a macOS app surface that uses the real backend contract for playlist loading and move execution
- a release tag and short release notes describing what is supported and what is intentionally deferred

Phase 1 is not trying to be a general YouTube management app yet.

## ✅ Goals

- [ ] Finish current backend functionality cleanly
- [ ] Remove or isolate mock-only app flows where real backend integration is now expected
- [ ] Improve polish and operator clarity without destabilizing the safety model
- [ ] Cut a release that can stand on its own
- [ ] Preserve a stable fallback while phase 2 is explored separately

## 🚫 Non-goals

- [ ] Local-first sync engine
- [ ] Native browsing of the full Watch Later inventory
- [ ] Selective move from a native picker
- [ ] Playlist reordering UI
- [ ] Tagging, history management, or general playlist management
- [ ] Major repo split during phase 1 completion

## 🧩 Workstreams

### 1. 🖥️ Real backend integration in the macOS app

Replace mock data paths with the real TypeScript backend contract for the app flows that already exist.

#### Target outcomes

- [ ] Playlist loading uses the real `playlists --json` contract
- [ ] Move execution uses the real `move --json` event stream
- [ ] App error states reflect actual backend failures
- [ ] App settings cover the backend inputs needed to run against a real authenticated browser

#### Suggested tasks

- [ ] Define the real process-launch boundary in Swift
- [ ] Decode the current JSON payloads and stream events into app models
- [ ] Decide where mock services remain useful for previews and UI development
- [ ] Make mock mode explicit rather than accidental

### 2. 🔒 Backend contract hardening

The current CLI already emits app-facing JSON, but the contract should be treated as intentional and versioned.

#### Target outcomes

- [ ] Document JSON payloads for `playlists --json` and `move --json`
- [ ] Ensure error payloads are structured and consistent
- [ ] Make streamed events and final result payloads stable enough for the app to depend on
- [ ] Identify any missing metadata needed by the current app shell

#### Suggested tasks

- [ ] Write or update contract fixtures
- [ ] Add tests around machine-readable outputs
- [ ] Add a contract version field if the payloads are likely to evolve during phase 2
- [ ] Decide whether `move --json` needs richer per-item metadata before release or whether that waits for phase 2

### 3. ✨ Phase 1 polish and operator experience

#### Target outcomes

- [ ] Clearer run summaries and error messages
- [ ] Clearer auth-loss guidance
- [ ] Cleaner README quick-start for real usage
- [ ] Known limitations written down instead of implied

#### Suggested tasks

- [ ] Tighten terminology around copy, verify, repair, and move
- [ ] Make app-facing commands discoverable in docs
- [ ] Capture expected browser setup and failure recovery in a short operator runbook
- [ ] Review screenshots and artifacts generated on failure for usefulness

### 4. 🧪 Validation and release readiness

#### Target outcomes

- [ ] Deterministic tests remain green
- [ ] Live browser validation is performed on a bounded real run
- [ ] Release notes and a tag identify the phase 1 boundary clearly

#### Suggested tasks

- [ ] Validate real playlist discovery from the app path
- [ ] Validate a bounded real move using the app-facing JSON contract
- [ ] Confirm auth-loss and resume behavior from the release candidate
- [ ] Decide the first release name and tag format

## 🚪 Phase 1 exit criteria

The repository is ready for a phase 1 release when all of the following are true:

- [ ] The CLI commands intended for release are documented and tested
- [ ] The macOS app can use real backend data for the currently implemented flows
- [ ] Mocks are clearly marked as mock-only where still present
- [ ] The release candidate has passed a bounded live validation run
- [ ] Docs clearly separate phase 1 capabilities from phase 2 aspirations
- [ ] The exact release commit is tagged

## 🛣️ Recommended sequencing

- [ ] Finish app integration against the real backend for playlists and move
- [ ] Harden the JSON contract and its tests
- [ ] Polish docs and operator messaging
- [ ] Run bounded live validation and fix the last release blockers only
- [ ] Tag the release commit
- [ ] Branch for phase 2 architecture work

## 🌿 Branch and release strategy

### Recommended flow

- [ ] Continue finishing phase 1 on the current branch or a dedicated release-hardening branch
- [ ] Cut a release tag once the exit criteria are met
- [ ] Create a new branch for phase 2 exploration after the tag exists

### Suggested branch naming

- [ ] `codex/phase-1-release-hardening`
- [ ] `codex/native-app-sync-engine`

## ❓Open questions to resolve before release

- [ ] How much of the macOS app must be real-data-backed for phase 1 to count as complete?
- [ ] Does the JSON contract need explicit versioning now, or can that wait until the first phase 2 protocol changes?
- [ ] Should the release ship the macOS app as experimental, preview-only, or supported?
- [ ] Are any current mock-only UI affordances misleading enough that they should be removed before release?
