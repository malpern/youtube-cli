import Foundation
import os

private let log = Logger(subsystem: "com.malpern.watchlaterapp", category: "PlaylistService")

@MainActor
struct RealPlaylistService: PlaylistService {
    func fetchPlaylists() async throws -> PlaylistLibrarySnapshot {
        log.info("Fetching playlists via playlists --json")
        let result = try await CLIProcessRunner.run(arguments: CLIBackendPaths.commonCLIArguments + ["playlists", "--json"])
        let decoder = JSONDecoder()
        let payload = try decoder.decode(PlaylistsResponse.self, from: result.stdout)
        try CLIAppContract.validate(payload, surface: .playlists)

        guard payload.ok else {
            let errorText = payload.error ?? fallbackErrorMessage(from: result)
            log.error("Playlist fetch failed: \(errorText, privacy: .public)")
            throw CLIProcessError(description: errorText)
        }

        log.info("Loaded \(payload.playlists?.count ?? 0) playlists, watchLater=\(payload.watchLater?.videoCount ?? 0) videos")
        return PlaylistLibrarySnapshot(
            watchLater: WatchLaterSummary(
                videoCount: payload.watchLater?.videoCount ?? 0,
                maxItems: payload.watchLater?.maxItems ?? 5_000
            ),
            playlists: (payload.playlists ?? []).map {
                PlaylistSummary(
                    id: $0.playlistId ?? $0.title,
                    title: $0.title,
                    visibility: $0.visibility ?? "Unknown",
                    videoCount: $0.videoCount ?? 0,
                    isDraft: false
                )
            }
        )
    }

    private func fallbackErrorMessage(from result: CLIProcessResult) -> String {
        let stderr = String(decoding: result.stderr, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if !stderr.isEmpty {
            return stderr
        }

        return "Playlist loading failed."
    }
}

private struct PlaylistsResponse: CLIAppContractPayload {
    let appContractVersion: Int
    let appContractSurface: String
    let ok: Bool
    let error: String?
    let watchLater: PlaylistsWatchLaterPayload?
    let playlists: [PlaylistPayload]?
}

private struct PlaylistsWatchLaterPayload: Decodable {
    let videoCount: Int?
    let maxItems: Int?
}

private struct PlaylistPayload: Decodable {
    let playlistId: String?
    let title: String
    let visibility: String?
    let videoCount: Int?
}
