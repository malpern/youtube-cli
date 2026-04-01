import SwiftUI

struct OrganizerView: View {
    @Bindable var store: OrganizerStore
    @State private var thumbnailSize: Double = 220

    var body: some View {
        NavigationSplitView {
            TopicSidebar(store: store)
                .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
        } detail: {
            AllVideosGridView(store: store, thumbnailSize: $thumbnailSize)
                .toolbar {
                    ToolbarItemGroup {
                        if store.isLoading {
                            ProgressView().controlSize(.small)
                        }

                        HStack(spacing: 4) {
                            Image(systemName: "photo")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Slider(value: $thumbnailSize, in: 120...400, step: 20)
                                .frame(width: 100)
                            Image(systemName: "photo")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
        }
    }
}
