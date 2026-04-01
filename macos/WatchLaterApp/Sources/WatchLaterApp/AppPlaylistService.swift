import Foundation

@MainActor
struct AppPlaylistService: PlaylistService {
    let preferences: AppPreferences
    let mockService: any PlaylistService
    let realService: any PlaylistService

    func fetchPlaylists() async throws -> PlaylistLibrarySnapshot {
        switch preferences.backendMode {
        case .mock:
            try await mockService.fetchPlaylists()
        case .real:
            try await realService.fetchPlaylists()
        }
    }
}
