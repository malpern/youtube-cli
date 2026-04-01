# Native App And Monorepo Evolution

## Purpose

This document describes the planned phase 2 direction after the phase 1 CLI release point is tagged.

The target is a native macOS YouTube management app that feels fast locally while using Playwright as an eventually consistent executor for YouTube reads and writes.

## Core decision

Do not build a second independent Playwright tool.

Keep one automation engine and evolve the repository so that:

- Swift owns the product UX
- a local data store owns current app state
- a sync engine owns reconciliation and queued work
- Playwright owns YouTube automation and verification

## Product direction

The long-term app should support:

- browsing playlists natively
- searching and filtering locally
- selecting and moving subsets of videos
- creating playlists
- tagging and organizing locally
- Watch Later management
- history-oriented workflows where feasible
- eventual playlist maintenance features such as reorder and cleanup

The app should feel immediate even when YouTube mutations are slow.

## Architectural principles

### 1. Local-first UI

The macOS app should render from a local store, not from live browser state.

Implications:

- searching 5,000 items should be local
- selection should be local
- sort and filter should be local
- pending operations should be visible immediately

### 2. Playwright is a transport and executor

Playwright is useful, but it is not a real-time source of truth.

Implications:

- reads happen via snapshots
- writes happen via queued operations
- the UI must tolerate delay, retry, drift, and failure

### 3. Explicit sync states

The app should expose states such as:

- local
- pending
- syncing
- verified
- failed
- conflicted

Do not silently pretend remote success.

### 4. Contract-first backend boundary

The Swift app should not depend on ad hoc CLI text output.

Implications:

- use machine-readable contracts
- version payloads intentionally
- keep fixtures for app and backend integration tests

## Target repository shape

The current repository should evolve into a monorepo shape rather than splitting immediately.

Suggested shape:

```text
apps/
  macos/
packages/
  protocol/
  worker/
docs/
runs/
```

Meaning:

- `apps/macos`: Swift app and native UI code
- `packages/protocol`: shared schemas, fixtures, and sample payloads
- `packages/worker`: TypeScript Playwright engine and app-facing commands or service
- `docs`: architecture notes, ADRs, and planning
- `runs`: durable local run artifacts during development and operations

This layout can be reached incrementally. It does not need to happen in one large refactor.

## Recommended runtime architecture

### Native macOS app

Responsibilities:

- render local data
- manage search, selection, sort, and filters
- show pending and failed states
- launch sync work
- present conflicts and verification outcomes

For large list views, prefer an AppKit-backed list/table implementation where needed for performance.

### Local store

Use a SQLite-backed local store as the app source of truth.

Responsibilities:

- persist snapshots of playlists and Watch Later
- support fast search and filtering
- track local-only entities such as tags and notes
- store queued operations and reconciliation state

### Sync engine

Responsibilities:

- pull remote snapshots into the local store
- enqueue user intents as operations
- apply optimistic local updates where appropriate
- retry, back off, and reconcile failures
- surface verification and conflicts

This should likely live in Swift because it is tightly coupled to UI state and local data semantics.

### Playwright worker

Responsibilities:

- authenticate against the browser session
- read YouTube pages into structured snapshots
- execute queued mutations
- verify outcomes using the existing safety-first approach
- emit structured progress and error events

Long term, this should become a long-lived local worker process or service rather than a one-shot CLI for every action.

## Recommended data model

### Core entities

- `Video`
  - `videoID`
  - canonical title
  - channel identifier if known
  - channel name
  - duration text
  - published text
  - view count text
  - thumbnail URL
  - availability state
  - last observed timestamp
- `Playlist`
  - `playlistID`
  - title
  - kind such as user playlist, Watch Later, or history-derived collection
  - visibility
  - video count
  - last observed timestamp
- `PlaylistItem`
  - local row id
  - playlist id
  - video id
  - position
  - observed metadata fields
  - source snapshot id
  - last observed timestamp

### Local-only entities

- `Tag`
- `VideoTag`
- `Note`
- `SavedFilter`
- `SelectionSet`

These are app features and should not depend on YouTube supporting them.

### Sync entities

- `Snapshot`
  - snapshot id
  - source kind
  - captured at
  - scope
  - fingerprint
- `Operation`
  - operation id
  - type
  - payload
  - local status
  - remote status
  - retry count
  - timestamps
  - last error
- `Conflict`
  - entity kind
  - entity id
  - reason
  - detected at
  - resolution state

## Operation model

Every mutation should become an explicit operation.

Examples:

- create playlist
- add video to playlist
- remove video from playlist
- move selected videos from Watch Later
- refresh playlist snapshot
- reorder playlist items

Recommended operation lifecycle:

1. User intent is recorded locally.
2. Local state updates immediately where safe.
3. Operation is queued.
4. Worker executes the browser automation.
5. Result is verified.
6. Local state is confirmed, reverted, or marked conflicted.

## Why this is a good fit

### Pros

- the native app stays responsive because it renders local state
- the repository keeps one automation engine
- local-only features like tags and saved filters become easy to add
- the existing durable artifact and verification model can be reused
- failures become manageable because operations are explicit and resumable

### Cons

- sync and reconciliation add real complexity
- Playwright will always limit how live the remote state can feel
- reorder and other high-churn mutations will be expensive and error-prone
- protocol design becomes important earlier than in a simple CLI app
- the app must explain pending and failed state clearly

## Suggested phase 2 milestones

### M1. Real backend app integration

- replace mock playlist and move services with the actual backend contract
- keep the current UX scope small

### M2. Snapshot-backed native browsing

- capture Watch Later and playlist snapshots
- persist them locally
- render native searchable list views from the local store

### M3. Selective transfer operations

- support selecting subsets of videos
- enqueue copy or move operations for selected items
- add selective verification semantics

### M4. Local-only organization

- tags
- notes
- saved filters
- custom collections built from local metadata

### M5. Advanced playlist management

- reorder
- bulk cleanup
- richer conflict handling

## Phase boundary reminder

Phase 2 should begin only after phase 1 has a release tag.

That tag is the safety line:

- it preserves a working migration tool
- it prevents phase 1 polish from being mixed into architecture experiments
- it gives the app and worker a stable baseline to compare against

## Deferred decisions

These can wait until after phase 1 is tagged:

- exact SQLite wrapper choice in Swift
- whether the worker runs as a daemon, JSON-RPC helper, or subprocess wrapper
- how much protocol surface belongs in shared generated schemas
- how history should be modeled given likely YouTube constraints
- when, if ever, the monorepo should be split into multiple repositories
