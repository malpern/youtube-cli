import Foundation

struct PhaseProgressSnapshot: Identifiable, Equatable {
    let phase: MovePhase
    var status: MovePhaseStatus = .pending
    var completed: Int = 0
    var total: Int = 0

    var id: MovePhase {
        phase
    }

    var fraction: Double {
        guard total > 0 else {
            switch status {
            case .pending:
                return 0
            case .running:
                return 0.15
            case .completed:
                return 1
            }
        }

        return min(max(Double(completed) / Double(total), 0), 1)
    }

    var countLabel: String {
        if total > 0 {
            return "\(completed) / \(total)"
        }

        if completed > 0 && status == .running {
            return "\(completed) found"
        }

        switch status {
        case .pending:
            return "Not started"
        case .running:
            return "In progress"
        case .completed:
            return "Complete"
        }
    }

    mutating func markCompletedIfNeeded() {
        if total == 0 {
            total = 1
        }

        completed = max(completed, total)
        status = .completed
    }
}
