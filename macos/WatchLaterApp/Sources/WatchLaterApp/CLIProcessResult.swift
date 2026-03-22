import Foundation

struct CLIProcessResult {
    let exitStatus: Int32
    let stdout: Data
    let stderr: Data
}
