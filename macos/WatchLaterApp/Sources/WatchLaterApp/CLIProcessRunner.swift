import Foundation

enum CLIProcessRunner {
    static func makeProcess(arguments: [String]) throws -> Process {
        guard FileManager.default.isExecutableFile(atPath: CLIBackendPaths.tsxURL.path(percentEncoded: false)) else {
            throw CLIProcessError(description: "Could not find an executable tsx binary at \(CLIBackendPaths.tsxURL.path(percentEncoded: false)). Run npm install in the repository root first.")
        }

        guard FileManager.default.fileExists(atPath: CLIBackendPaths.cliURL.path(percentEncoded: false)) else {
            throw CLIProcessError(description: "Could not find src/cli.ts at \(CLIBackendPaths.cliURL.path(percentEncoded: false)).")
        }

        let process = Process()
        process.executableURL = CLIBackendPaths.tsxURL
        process.arguments = [CLIBackendPaths.cliURL.path(percentEncoded: false)] + arguments
        process.currentDirectoryURL = CLIBackendPaths.repositoryRootURL
        process.environment = ProcessInfo.processInfo.environment
        return process
    }

    static func run(arguments: [String]) async throws -> CLIProcessResult {
        let process = try makeProcess(arguments: arguments)
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        let state = ProcessIOState()

        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                return
            }

            state.appendStdout(data)
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                return
            }

            state.appendStderr(data)
        }

        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { terminatedProcess in
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil

                let result = state.finish(
                    exitStatus: terminatedProcess.terminationStatus,
                    trailingStdout: stdoutPipe.fileHandleForReading.readDataToEndOfFile(),
                    trailingStderr: stderrPipe.fileHandleForReading.readDataToEndOfFile()
                )

                continuation.resume(returning: result)
            }

            do {
                try process.run()
            } catch {
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(throwing: error)
            }
        }
    }
}

private final class ProcessIOState: @unchecked Sendable {
    private let lock = NSLock()
    private var stdoutData = Data()
    private var stderrData = Data()

    func appendStdout(_ data: Data) {
        lock.lock()
        stdoutData.append(data)
        lock.unlock()
    }

    func appendStderr(_ data: Data) {
        lock.lock()
        stderrData.append(data)
        lock.unlock()
    }

    func finish(exitStatus: Int32, trailingStdout: Data, trailingStderr: Data) -> CLIProcessResult {
        lock.lock()
        stdoutData.append(trailingStdout)
        stderrData.append(trailingStderr)
        let result = CLIProcessResult(exitStatus: exitStatus, stdout: stdoutData, stderr: stderrData)
        lock.unlock()
        return result
    }
}
