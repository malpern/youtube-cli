import Foundation

enum TransferDestination: Equatable {
    case newPlaylist(name: String)
    case existingPlaylist(id: String, title: String)

    var displayName: String {
        switch self {
        case .newPlaylist(let name):
            name
        case .existingPlaylist(_, let title):
            title
        }
    }
}
