import Foundation

struct CLIProcessError: LocalizedError {
    let description: String

    var errorDescription: String? {
        description
    }
}
