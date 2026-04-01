import SwiftUI

struct ExistingPlaylistPickerView: View {
    @Bindable var model: TransferViewModel

    private var realPlaylists: [PlaylistSummary] {
        model.availablePlaylists.filter { !$0.isDraft }
    }

    private var showsUnavailableView: Bool {
        realPlaylists.isEmpty && model.hasLoadedPlaylists && !model.isLoadingPlaylists
    }

    private var showsLoadingSpinner: Bool {
        realPlaylists.isEmpty && !model.hasLoadedPlaylists
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showsLoadingSpinner {
                loadingView
            } else if showsUnavailableView {
                unavailableView
            } else {
                playlistList
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: 10) {
            ProgressView()
                .controlSize(.regular)
            Text("Loading playlists…")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: AppStyle.playlistListHeight)
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

            ScrollViewReader { proxy in
                List {
                    ForEach(realPlaylists) { playlist in
                        PlaylistSelectionRowView(
                            playlist: playlist,
                            isSelected: model.selectedPlaylistID == playlist.id,
                            select: { model.selectPlaylist(id: playlist.id) }
                        )
                        .id(playlist.id)
                    }
                }
                .onAppear {
                    if let selectedID = model.selectedPlaylistID {
                        proxy.scrollTo(selectedID, anchor: .center)
                    }
                }
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.visible, axes: .vertical)
        .scrollBounceBehavior(.basedOnSize)
        .disabled(model.isRunningTransfer)
        .frame(height: AppStyle.playlistListHeight)
    }
}
