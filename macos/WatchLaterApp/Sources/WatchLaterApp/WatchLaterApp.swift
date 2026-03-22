import SwiftUI

@main
struct WatchLaterApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var preferences: AppPreferences
    @State private var transferModel: TransferViewModel

    init() {
        let sharedPreferences = AppPreferences()
        let playlistService = AppPlaylistService(
            preferences: sharedPreferences,
            mockService: MockPlaylistService(),
            realService: RealPlaylistService()
        )
        let authService = AppAuthService(
            preferences: sharedPreferences,
            mockService: MockAuthService(),
            realService: RealAuthService()
        )
        let moveService = AppMoveService(
            preferences: sharedPreferences,
            mockService: MockMoveService(),
            realService: RealMoveService(preferences: sharedPreferences)
        )
        _preferences = State(initialValue: sharedPreferences)
        _transferModel = State(
            initialValue: TransferViewModel(
                playlistService: playlistService,
                moveService: moveService,
                authService: authService,
                preferences: sharedPreferences
            )
        )
    }

    var body: some Scene {
        WindowGroup(id: WindowID.transfer) {
            TransferView(model: transferModel)
                .task(id: preferences.backendMode) {
                    await transferModel.reloadPlaylistsForBackendChange()
                }
        }
        .defaultSize(width: MainWindowSizing.width, height: MainWindowSizing.collapsedSetupHeight)
        .windowResizability(.contentSize)
        .commands {
            WatchLaterCommands()
        }

        Window("About You Watch Later", id: WindowID.about) {
            AboutView()
        }
        .windowResizability(.contentSize)

        Settings {
            SettingsView(preferences: preferences)
        }
    }
}
