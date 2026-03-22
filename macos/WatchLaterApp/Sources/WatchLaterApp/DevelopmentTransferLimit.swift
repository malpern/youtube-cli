import Foundation

enum DevelopmentTransferLimit: String, CaseIterable, Identifiable {
    case five = "5"
    case fifteen = "15"
    case twentyFive = "25"
    case fifty = "50"
    case oneHundred = "100"
    case all = "all"

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .five:
            "5 items"
        case .fifteen:
            "15 items"
        case .twentyFive:
            "25 items"
        case .fifty:
            "50 items"
        case .oneHundred:
            "100 items"
        case .all:
            "All items"
        }
    }

    var maxItems: Int? {
        switch self {
        case .five:
            5
        case .fifteen:
            15
        case .twentyFive:
            25
        case .fifty:
            50
        case .oneHundred:
            100
        case .all:
            nil
        }
    }
}
