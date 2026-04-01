import SwiftUI

struct SettingsView: View {
    @Bindable var preferences: AppPreferences

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
                .ignoresSafeArea()

            Form {
                Section("Backend") {
                    Picker("Data Source", selection: $preferences.backendMode) {
                        ForEach(BackendMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                }

                if preferences.backendMode == .real {
                    Section("Development") {
                        Picker("Real Transfer Limit", selection: $preferences.developmentTransferLimit) {
                            ForEach(DevelopmentTransferLimit.allCases) { limit in
                                Text(limit.title).tag(limit)
                            }
                        }

                        Toggle("Enable background playlist polling", isOn: $preferences.playlistPollingEnabled)
                    }
                }

                Section("Playlist Handling") {
                    Toggle("Don't add duplicate additions to playlists", isOn: $preferences.avoidDuplicateAdditionsToPlaylists)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .padding(20)
        }
        .frame(width: 460)
    }
}
