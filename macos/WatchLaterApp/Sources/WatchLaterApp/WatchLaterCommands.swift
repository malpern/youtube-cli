import AppKit
import SwiftUI

struct WatchLaterCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .appInfo) {
            Button("About You Watch Later") {
                openWindow(id: WindowID.about)
            }
        }

        CommandGroup(replacing: .newItem) {
            Button("'Watch Later' to Playlist...") {
                openWindow(id: WindowID.transfer)
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        }

        CommandGroup(after: .newItem) {
            Button(action: openYouTubeInAutomationBrowser) {
                Label("Open YouTube", systemImage: "play.rectangle.fill")
            }
        }
    }

    private func openYouTubeInAutomationBrowser() {
        do {
            try AutomationBrowserLauncher.openYouTube()
        } catch {
            NSAlert(error: error).runModal()
        }
    }
}
