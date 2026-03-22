import Foundation

struct MockPlaylistService: PlaylistService {
    func fetchPlaylists() async throws -> PlaylistLibrarySnapshot {
        try await Task.sleep(for: .milliseconds(450))

        return PlaylistLibrarySnapshot(
            watchLater: WatchLaterSummary(videoCount: 4_872, maxItems: 5_000),
            playlists: [
                PlaylistSummary(title: "Old Watch", visibility: "Private", videoCount: 147),
                PlaylistSummary(title: "Weekend Queue", visibility: "Private", videoCount: 28),
                PlaylistSummary(title: "Research Clips", visibility: "Unlisted", videoCount: 63),
                PlaylistSummary(title: "Music Catch-Up", visibility: "Public", videoCount: 91)
            ]
        )
    }
}
