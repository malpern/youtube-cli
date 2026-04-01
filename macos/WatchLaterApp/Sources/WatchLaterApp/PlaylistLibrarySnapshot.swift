import Foundation

struct PlaylistLibrarySnapshot: Equatable {
    let watchLater: WatchLaterSummary
    let playlists: [PlaylistSummary]
}
