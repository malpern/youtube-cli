import Foundation

enum MovePhase: String, CaseIterable, Identifiable, Equatable {
    case setup
    case inventory
    case copy
    case verify
    case delete

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .setup:
            "Setup"
        case .inventory:
            "Scanning"
        case .copy:
            "Copied"
        case .verify:
            "Verify"
        case .delete:
            "Moved"
        }
    }
}
