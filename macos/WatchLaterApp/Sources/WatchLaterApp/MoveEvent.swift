import Foundation

enum MoveEvent: Equatable {
    case started(runID: String, targetPlaylist: String, workflow: MoveWorkflow)
    case phase(phase: MovePhase, status: MovePhaseStatus, childRunID: String?)
    case progress(phase: MovePhase, completed: Int, total: Int, message: String)
    case item(phase: MovePhase, completed: Int?, total: Int?, item: MoveItemSnapshot, occurredAt: Date)
    case result(MoveResultPayload)
}
