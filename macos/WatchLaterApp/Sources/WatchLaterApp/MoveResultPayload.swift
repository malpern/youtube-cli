import Foundation

struct MoveResultPayload: Equatable {
    let ok: Bool
    let runID: String
    let targetPlaylist: String?
    let workflow: MoveWorkflow?
    let summaryPath: String?
    let errorMessage: String?
}
