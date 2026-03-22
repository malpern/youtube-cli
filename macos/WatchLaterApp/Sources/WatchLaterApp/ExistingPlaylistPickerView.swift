import SwiftUI

struct ExistingPlaylistPickerView: View {
    @Bindable var model: TransferViewModel

    private var realPlaylists: [PlaylistSummary] {
        model.availablePlaylists.filter { !$0.isDraft }
    }

    private var showsUnavailableView: Bool {
        realPlaylists.isEmpty && !model.isLoadingPlaylists
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showsUnavailableView {
                unavailableView
            } else {
                playlistList
            }
        }
    }

    private var unavailableView: some View {
        VStack(alignment: .center, spacing: 14) {
            ContentUnavailableView(
                "No Playlists",
                systemImage: "music.note.list",
                description: Text("Create a playlist to get started.")
            )

            Button("Create Playlist", action: model.presentNewPlaylistSheet)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .pointingHandCursor()
                .disabled(model.isRunningTransfer)
        }
        .frame(maxWidth: .infinity)
    }

    private var playlistList: some View {
        ZStack {
            Color(nsColor: .controlBackgroundColor)

            List {
                ForEach(realPlaylists) { playlist in
                    PlaylistSelectionRowView(
                        playlist: playlist,
                        isSelected: model.selectedPlaylistID == playlist.id,
                        select: { model.selectPlaylist(id: playlist.id) }
                    )
                }
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.visible)
        .disabled(model.isRunningTransfer)
        .frame(height: AppStyle.playlistListHeight)
    }
}
