import Foundation

@MainActor
protocol PlaylistService {
    func fetchPlaylists() async throws -> PlaylistLibrarySnapshot
}
