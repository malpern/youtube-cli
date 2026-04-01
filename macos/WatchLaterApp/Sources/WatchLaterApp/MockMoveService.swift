import Foundation

struct MockMoveService: MoveService {
    func runMove(to destination: TransferDestination, options: MoveExecutionOptions) -> AsyncThrowingStream<MoveEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    try Task.checkCancellation()

                    let workflow = MoveWorkflow(
                        workflowRunID: "mock-run-20260321-run",
                        verifyRunID: "mock-run-20260321-run-verify",
                        deleteRunID: "mock-run-20260321-delete"
                    )
                    let targetPlaylist = destination.displayName

                    continuation.yield(.started(runID: "mock-run-20260321", targetPlaylist: targetPlaylist, workflow: workflow))

                    try await emitPhase(.setup, into: continuation)
                    try await emitPhase(.inventory, into: continuation)
                    try await emitCopyPhase(into: continuation, options: options)
                    try await emitVerifyPhase(into: continuation)
                    try await emitDeletePhase(into: continuation, options: options)

                    continuation.yield(
                        .result(
                            MoveResultPayload(
                                ok: true,
                                runID: "mock-run-20260321",
                                targetPlaylist: targetPlaylist,
                                workflow: workflow,
                                summaryPath: "/mock/runs/mock-run-20260321/summary.json",
                                errorMessage: nil
                            )
                        )
                    )
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
    }

    private func emitPhase(
        _ phase: MovePhase,
        into continuation: AsyncThrowingStream<MoveEvent, Error>.Continuation
    ) async throws {
        continuation.yield(.phase(phase: phase, status: .running, childRunID: "mock-\(phase.rawValue)-run"))
        try await Task.sleep(for: .milliseconds(700))
        continuation.yield(.phase(phase: phase, status: .completed, childRunID: "mock-\(phase.rawValue)-run"))
    }

    private func emitCopyPhase(
        into continuation: AsyncThrowingStream<MoveEvent, Error>.Continuation,
        options: MoveExecutionOptions
    ) async throws {
        continuation.yield(.phase(phase: .copy, status: .running, childRunID: "mock-copy-run"))

        let items = mockCopyItems(options: options)
        for (offset, item) in items.enumerated() {
            try await Task.sleep(for: .milliseconds(550))
            continuation.yield(
                .item(
                    phase: .copy,
                    completed: offset + 1,
                    total: items.count,
                    item: item,
                    occurredAt: Date()
                )
            )
        }

        continuation.yield(.phase(phase: .copy, status: .completed, childRunID: "mock-copy-run"))
    }

    private func emitDeletePhase(
        into continuation: AsyncThrowingStream<MoveEvent, Error>.Continuation,
        options: MoveExecutionOptions
    ) async throws {
        continuation.yield(.phase(phase: .delete, status: .running, childRunID: "mock-delete-run"))

        let items = mockDeleteItems(options: options)
        for (offset, item) in items.enumerated() {
            try await Task.sleep(for: .milliseconds(420))
            continuation.yield(
                .item(
                    phase: .delete,
                    completed: offset + 1,
                    total: items.count,
                    item: item,
                    occurredAt: Date()
                )
            )
        }

        continuation.yield(.phase(phase: .delete, status: .completed, childRunID: "mock-delete-run"))
    }

    private func emitVerifyPhase(
        into continuation: AsyncThrowingStream<MoveEvent, Error>.Continuation
    ) async throws {
        continuation.yield(.phase(phase: .verify, status: .running, childRunID: "mock-verify-run"))

        let items = mockVerifyItems
        let checkpoints = [
            "Checking playlist ordering",
            "Checking for missing items",
            "Checking for Watch Later drift",
            "Confirming delete readiness",
            "Matching thumbnails",
            "Comparing duplicate titles",
            "Checking playlist visibility",
            "Reviewing transfer notes",
            "Verifying source indexes",
            "Scanning for skipped videos",
            "Confirming playlist counts",
            "Finalizing delete safety"
        ]

        for (offset, item) in items.enumerated() {
            try await Task.sleep(for: .milliseconds(480))
            let checkpoint = checkpoints[offset % checkpoints.count]
            continuation.yield(
                .item(
                    phase: .verify,
                    completed: offset + 1,
                    total: items.count,
                    item: item,
                    occurredAt: Date()
                )
            )
            continuation.yield(
                .progress(
                    phase: .verify,
                    completed: offset + 1,
                    total: items.count,
                    message: checkpoint
                )
            )
        }

        continuation.yield(.phase(phase: .verify, status: .completed, childRunID: "mock-verify-run"))
    }

    private func mockCopyItems(options: MoveExecutionOptions) -> [MoveItemSnapshot] {
        mockCatalog.map { item in
            item.snapshot(result: options.avoidDuplicateAdditions ? item.copyResult : "saved")
        }
    }

    private func mockDeleteItems(options: MoveExecutionOptions) -> [MoveItemSnapshot] {
        mockCatalog
            .filter { options.avoidDuplicateAdditions ? $0.copyResult != "already-saved" : true }
            .map { $0.snapshot(result: "removed") }
    }

    private var mockVerifyItems: [MoveItemSnapshot] {
        mockCatalog.map { $0.snapshot(result: "verified") }
    }

    private var mockCatalog: [MockVideoRecord] {
        [
            MockVideoRecord(sourceIndex: 1, title: "Desk setup tour 2026: cables, cameras, and the one lamp I regret buying", channelName: "Studio Signal", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=12"), viewCountText: "241K views", publishedTimeText: "9 months ago", videoID: "dQw4w9WgXcQ", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 2, title: "SwiftUI layout patterns I keep reusing because they survive product changes", channelName: "Build Notes", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=18"), viewCountText: "17K views", publishedTimeText: "4 months ago", videoID: "9bZkp7q19f0", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 3, title: "ambient coding mix for people who accidentally opened 47 tabs and committed anyway", channelName: "Night Shift Audio", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=33"), viewCountText: "1.2M views", publishedTimeText: "2 years ago", videoID: "J---aiyznGQ", copyResult: "already-saved"),
            MockVideoRecord(sourceIndex: 4, title: "Browser automation notes: the flaky dropdown saga", channelName: "QA Weekly", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=47"), viewCountText: "83K views", publishedTimeText: "11 months ago", videoID: "kJQP7kiw5Fk", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 5, title: "tiny apartment kitchen tour but every drawer is somehow full of spices", channelName: "Small Space Living", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=52"), viewCountText: "546K views", publishedTimeText: "7 months ago", videoID: "M7FIvfx5J10", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 6, title: "I restored a 1997 camcorder and the footage looks mildly haunted", channelName: "Tape Loop", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=29"), viewCountText: "92K views", publishedTimeText: "3 weeks ago", videoID: "fJ9rUzIMcZQ", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 7, title: "why this weird mechanical keyboard sounds like typing inside a snow globe", channelName: "Switch Cult", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=61"), viewCountText: "308K views", publishedTimeText: "1 year ago", videoID: "hTWKbfoikeg", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 8, title: "deep dive: the design choices in old train station departure boards", channelName: "Public Interface", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=23"), viewCountText: "14K views", publishedTimeText: "6 days ago", videoID: "3JZ_D3ELwOQ", copyResult: "already-saved"),
            MockVideoRecord(sourceIndex: 9, title: "making coffee with a hand grinder at 5:12 AM was a mistake, here is the evidence", channelName: "Morning Methods", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=41"), viewCountText: "66K views", publishedTimeText: "8 months ago", videoID: "OPf0YbXqDm0", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 10, title: "How I organize side projects when none of them agree on a folder structure", channelName: "Second Brain-ish", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=15"), viewCountText: "39K views", publishedTimeText: "1 month ago", videoID: "YQHsXMglC9A", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 11, title: "[no spoilers] I tried ranking every map app by how dramatic the rerouting voice sounds", channelName: "Pocket Geography", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=8"), viewCountText: "118K views", publishedTimeText: "5 months ago", videoID: "CevxZvSJLk8", copyResult: "saved"),
            MockVideoRecord(sourceIndex: 12, title: "Lo-fi houseplant repotting stream, with one extremely judgmental fern in frame the whole time", channelName: "Windowlight Club", channelAvatarURL: URL(string: "https://i.pravatar.cc/80?img=37"), viewCountText: "9.4K views", publishedTimeText: "2 weeks ago", videoID: "60ItHLz5WEA", copyResult: "saved")
        ]
    }
}

private struct MockVideoRecord {
    let sourceIndex: Int
    let title: String
    let channelName: String
    let channelAvatarURL: URL?
    let viewCountText: String
    let publishedTimeText: String
    let videoID: String
    let copyResult: String

    func snapshot(result: String) -> MoveItemSnapshot {
        MoveItemSnapshot(
            sourceIndex: sourceIndex,
            title: title,
            channelName: channelName,
            channelAvatarURL: channelAvatarURL,
            viewCountText: viewCountText,
            publishedTimeText: publishedTimeText,
            videoID: videoID,
            videoURL: URL(string: "https://www.youtube.com/watch?v=\(videoID)"),
            thumbnailURL: URL(string: "https://i.ytimg.com/vi/\(videoID)/hqdefault.jpg"),
            result: result
        )
    }
}
