import Foundation
import os

private let log = Logger(subsystem: "com.malpern.watchlaterapp", category: "MoveService")

@MainActor
struct RealMoveService: MoveService {
    let preferences: AppPreferences

    func runMove(to destination: TransferDestination, options: MoveExecutionOptions) -> AsyncThrowingStream<MoveEvent, Error> {
        let arguments = options.useChunkedMove
            ? chunkedMoveArguments(for: destination, options: options)
            : moveArguments(for: destination, options: options)

        log.info("Starting \(options.useChunkedMove ? "chunked-move" : "move", privacy: .public) to \(destination.displayName, privacy: .public)")
        return AsyncThrowingStream { continuation in
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            let state = MoveStreamState()

            let process: Process
            do {
                process = try CLIProcessRunner.makeProcess(arguments: arguments)
            } catch {
                continuation.finish(throwing: error)
                return
            }

            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }

                for lineData in state.appendStdoutAndDrainLines(data) {
                    do {
                        let event = try Self.decodeMoveEvent(from: lineData, state: state)
                        continuation.yield(event)
                    } catch {
                        log.error("Move stream decode error: \(error.localizedDescription, privacy: .public)")
                        continuation.finish(throwing: error)
                        if process.isRunning {
                            process.terminate()
                        }
                        return
                    }
                }
            }

            stderrPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }

                state.appendStderr(data)
            }

            process.terminationHandler = { terminatedProcess in
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil

                for lineData in state.appendStdoutAndDrainLines(stdoutPipe.fileHandleForReading.readDataToEndOfFile()) {
                    do {
                        let event = try Self.decodeMoveEvent(from: lineData, state: state)
                        continuation.yield(event)
                    } catch {
                        // If we already have the result, ignore trailing decode errors
                        // (partial lines or non-JSON output flushed at process exit)
                        if state.didEmitResult {
                            log.warning("Ignoring trailing decode error after result: \(error.localizedDescription, privacy: .public)")
                            continue
                        }
                        continuation.finish(throwing: error)
                        return
                    }
                }

                state.appendStderr(stderrPipe.fileHandleForReading.readDataToEndOfFile())
                let stderrText = state.stderrText

                if terminatedProcess.terminationStatus == 0 || state.didEmitResult {
                    log.info("Move process exited cleanly, status=\(terminatedProcess.terminationStatus)")
                    continuation.finish()
                    return
                }

                let humanMessage = Self.extractHumanReadableError(from: stderrText)
                log.error("Move process failed, status=\(terminatedProcess.terminationStatus), error: \(humanMessage, privacy: .public)")
                continuation.finish(throwing: CLIProcessError(description: humanMessage))
            }

            continuation.onTermination = { @Sendable _ in
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                if process.isRunning {
                    process.terminate()
                }
            }

            do {
                log.info("Launching move process: \(self.moveArguments(for: destination, options: options).joined(separator: " "), privacy: .public)")
                try process.run()
            } catch {
                log.error("Move process launch failed: \(error.localizedDescription, privacy: .public)")
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                continuation.finish(throwing: error)
            }
        }
    }

    private func moveArguments(for destination: TransferDestination, options: MoveExecutionOptions) -> [String] {
        let targetPlaylist = destination.displayName
        var arguments = CLIBackendPaths.commonCLIArguments

        if let resumeRunID = options.resumeRunID {
            arguments.append(contentsOf: ["--run-id", resumeRunID])
        }

        arguments.append(contentsOf: ["move", "--json", "--target-playlist", targetPlaylist])

        if case .existingPlaylist(let id, _) = destination {
            arguments.append(contentsOf: ["--target-playlist-id", id])
        }

        if let maxItems = preferences.developmentTransferLimit.maxItems {
            arguments.append(contentsOf: ["--development-max-items", String(maxItems)])
        }

        if options.resumeRunID != nil {
            arguments.append("--resume")
        }

        return arguments
    }

    private func chunkedMoveArguments(for destination: TransferDestination, options: MoveExecutionOptions) -> [String] {
        let targetPlaylist = destination.displayName
        var arguments = CLIBackendPaths.commonCLIArguments

        if let resumeRunID = options.resumeRunID {
            arguments.append(contentsOf: ["--run-id", resumeRunID])
        }

        arguments.append(contentsOf: [
            "chunked-move", "--json",
            "--target-playlist", targetPlaylist,
            "--chunk-size", String(options.chunkSize),
            "--start-index", String(options.startIndex)
        ])

        if case .existingPlaylist(let id, _) = destination {
            arguments.append(contentsOf: ["--target-playlist-id", id])
        }

        if let sourceRunID = options.sourceRunID {
            arguments.append(contentsOf: ["--source-run-id", sourceRunID])
        }

        if options.confirmDelete {
            arguments.append("--confirm-delete")
        }

        if options.resumeRunID != nil {
            arguments.append("--resume")
        }

        return arguments
    }

    private nonisolated static func decodeMoveEvent(from data: Data, state: MoveStreamState) throws -> MoveEvent {
        let decoder = JSONDecoder()
        let payload = try decoder.decode(MoveStreamPayload.self, from: data)
        try CLIAppContract.validate(payload, surface: .move)

        switch payload.type {
        case "started":
            guard let runId = payload.runId,
                  let targetPlaylist = payload.targetPlaylist,
                  let workflow = payload.workflow else {
                throw CLIProcessError(description: "Move stream emitted an incomplete started event.")
            }

            return .started(
                runID: runId,
                targetPlaylist: targetPlaylist,
                workflow: MoveWorkflow(
                    workflowRunID: workflow.workflowRunId,
                    verifyRunID: workflow.verifyRunId,
                    deleteRunID: workflow.deleteRunId
                )
            )
        case "phase":
            guard let phase = payload.phase.flatMap(MovePhase.init(rawValue:)),
                  let status = payload.status.map(Self.decodeMovePhaseStatus) else {
                throw CLIProcessError(description: "Move stream emitted an incomplete phase event.")
            }

            return .phase(phase: phase, status: status, childRunID: payload.childRunId)
        case "progress":
            guard let phase = payload.phase.flatMap(MovePhase.init(rawValue:)),
                  let completed = payload.completed,
                  let total = payload.total,
                  let message = payload.message else {
                throw CLIProcessError(description: "Move stream emitted an incomplete progress event.")
            }

            return .progress(phase: phase, completed: completed, total: total, message: message)
        case "item":
            guard let phase = payload.phase.flatMap(MovePhase.init(rawValue:)),
                  let item = payload.item else {
                throw CLIProcessError(description: "Move stream emitted an incomplete item event.")
            }

            return .item(
                phase: phase,
                completed: payload.completed,
                total: payload.total,
                item: MoveItemSnapshot(
                    sourceIndex: item.sourceIndex,
                    title: item.title ?? "Untitled video",
                    channelName: item.channelName,
                    channelAvatarURL: nil,
                    viewCountText: nil,
                    publishedTimeText: nil,
                    videoID: item.videoId,
                    videoURL: item.videoUrl.flatMap(URL.init(string:)),
                    thumbnailURL: item.thumbnailUrl.flatMap(URL.init(string:)),
                    result: item.result
                ),
                occurredAt: payload.occurredAt.flatMap(Self.parseDate) ?? .now
            )
        case "result":
            state.didEmitResult = true
            return .result(
                MoveResultPayload(
                    ok: payload.ok ?? false,
                    runID: payload.runId ?? "unknown-run",
                    targetPlaylist: payload.targetPlaylist,
                    workflow: payload.workflow.map {
                        MoveWorkflow(
                            workflowRunID: $0.workflowRunId,
                            verifyRunID: $0.verifyRunId,
                            deleteRunID: $0.deleteRunId
                        )
                    },
                    summaryPath: payload.artifacts?.summaryPath,
                    errorMessage: payload.error
                )
            )
        default:
            throw CLIProcessError(description: "Move stream emitted an unknown event type '\(payload.type)'.")
        }
    }

    private nonisolated static func decodeMovePhaseStatus(_ value: String) -> MovePhaseStatus {
        switch value {
        case "completed":
            .completed
        case "started":
            .running
        default:
            .pending
        }
    }

    private nonisolated static func parseDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private nonisolated static func extractHumanReadableError(from stderr: String) -> String {
        let lines = stderr.components(separatedBy: .newlines)
        let humanLines = lines.filter { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            return !trimmed.isEmpty && !trimmed.hasPrefix("{")
        }
        let message = humanLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? "Move failed." : message
    }
}

private final class MoveStreamState: @unchecked Sendable {
    private let lock = NSLock()
    private var stderrData = Data()
    private var bufferedStdout = Data()
    private var emittedResult = false

    var didEmitResult: Bool {
        get {
            lock.lock()
            let value = emittedResult
            lock.unlock()
            return value
        }
        set {
            lock.lock()
            emittedResult = newValue
            lock.unlock()
        }
    }

    func appendStdoutAndDrainLines(_ data: Data) -> [Data] {
        lock.lock()
        bufferedStdout.append(data)

        var lines: [Data] = []
        while let newlineIndex = bufferedStdout.firstIndex(of: 0x0A) {
            let lineData = Data(bufferedStdout.prefix(upTo: newlineIndex))
            bufferedStdout.removeSubrange(...newlineIndex)
            if !lineData.isEmpty {
                lines.append(lineData)
            }
        }

        lock.unlock()
        return lines
    }

    func appendStderr(_ data: Data) {
        lock.lock()
        stderrData.append(data)
        lock.unlock()
    }

    var stderrText: String {
        lock.lock()
        let text = String(decoding: stderrData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        lock.unlock()
        return text
    }
}

private struct MoveStreamPayload: CLIAppContractPayload {
    let appContractVersion: Int
    let appContractSurface: String
    let type: String
    let ok: Bool?
    let runId: String?
    let phase: String?
    let status: String?
    let childRunId: String?
    let completed: Int?
    let total: Int?
    let message: String?
    let targetPlaylist: String?
    let workflow: MoveWorkflowPayload?
    let item: MoveItemPayload?
    let occurredAt: String?
    let artifacts: MoveArtifactsPayload?
    let error: String?
}

private struct MoveWorkflowPayload: Decodable {
    let workflowRunId: String
    let verifyRunId: String
    let deleteRunId: String
}

private struct MoveItemPayload: Decodable {
    let sourceIndex: Int
    let title: String?
    let channelName: String?
    let videoId: String?
    let videoUrl: String?
    let thumbnailUrl: String?
    let result: String
}

private struct MoveArtifactsPayload: Decodable {
    let summaryPath: String?
}
