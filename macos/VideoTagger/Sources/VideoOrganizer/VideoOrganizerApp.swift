import SwiftUI
import TaggingKit

@main
struct VideoOrganizerApp: App {
    @State private var store: OrganizerStore?
    @State private var loadError: String?

    var body: some Scene {
        WindowGroup("Video Organizer") {
            Group {
                if let store {
                    OrganizerView(store: store)
                } else if let loadError {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text("Database Error")
                            .font(.title2)
                        Text(loadError)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ProgressView("Loading…")
                }
            }
            .task {
                await initializeStore()
            }
        }
        .defaultSize(width: 1200, height: 800)
    }

    private func initializeStore() async {
        do {
            let client = try? ClaudeClient()
            let dbPath = resolveDbPath()
            let newStore = try OrganizerStore(dbPath: dbPath, claudeClient: client)
            newStore.loadTopics()
            store = newStore
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func resolveDbPath() -> String {
        // Look for existing DB, or create in the repo's runs directory
        let candidates = [
            "/tmp/full-tagger-v2.db",
            FileManager.default.currentDirectoryPath + "/video-tagger.db"
        ]

        for path in candidates {
            if FileManager.default.fileExists(atPath: path) {
                return path
            }
        }

        return candidates.last!
    }
}
