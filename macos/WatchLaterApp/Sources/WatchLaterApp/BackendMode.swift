import Foundation

enum BackendMode: String, CaseIterable, Identifiable {
    case mock
    case real

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .mock:
            "Mock Data"
        case .real:
            "Real Backend"
        }
    }

    var detail: String {
        switch self {
        case .mock:
            "Fast local demo mode for previews and UI development."
        case .real:
            "Runs the Playwright-backed CLI from this repository."
        }
    }
}
