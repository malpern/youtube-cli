import SwiftUI

struct TopicDetailView: View {
    @Bindable var store: OrganizerStore
    let topic: TopicViewModel
    @State private var videos: [VideoViewModel] = []
    @State private var searchText = ""
    @State private var columnCount = 3

    private var filteredVideos: [VideoViewModel] {
        guard !searchText.isEmpty else { return videos }
        return videos.filter {
            $0.title.localizedStandardContains(searchText) ||
            ($0.channelName?.localizedStandardContains(searchText) ?? false)
        }
    }

    /// Split videos into columns for masonry layout
    private var columns: [[VideoViewModel]] {
        var cols = Array(repeating: [VideoViewModel](), count: columnCount)
        for (i, video) in filteredVideos.enumerated() {
            cols[i % columnCount].append(video)
        }
        return cols
    }

    var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 12) {
                ForEach(0..<columnCount, id: \.self) { col in
                    LazyVStack(spacing: 12) {
                        ForEach(columns[col]) { video in
                            VideoCard(video: video)
                                .contextMenu { videoContextMenu(for: video) }
                        }
                    }
                }
            }
            .padding(16)
        }
        .searchable(text: $searchText, prompt: "Search videos")
        .navigationTitle(topic.name)
        .navigationSubtitle("\(topic.videoCount) videos")
        .toolbar {
            ToolbarItemGroup {
                Picker("Columns", selection: $columnCount) {
                    Image(systemName: "rectangle.split.2x1").tag(2)
                    Image(systemName: "rectangle.split.3x1").tag(3)
                    Image(systemName: "square.grid.2x2").tag(4)
                }
                .pickerStyle(.segmented)
                .frame(width: 100)

                if store.isLoading {
                    ProgressView().controlSize(.small)
                }

                Menu {
                    Button("Split Topic…") {
                        Task { await store.splitTopic(topic.id) }
                    }
                    Button("Delete Topic", role: .destructive) {
                        store.deleteTopic(topic.id)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task(id: topic.id) {
            videos = store.videosForTopic(topic.id)
        }
        .onChange(of: store.topics) { _, _ in
            videos = store.videosForTopic(topic.id)
        }
    }

    @ViewBuilder
    private func videoContextMenu(for video: VideoViewModel) -> some View {
        Menu("Move to…") {
            ForEach(store.topics.filter({ $0.id != topic.id })) { other in
                Button(other.name) {
                    store.moveVideo(videoId: video.id, toTopicId: other.id)
                }
            }
        }

        if let urlString = video.videoUrl, let url = URL(string: urlString) {
            Divider()
            Link("Open on YouTube", destination: url)
        }
    }
}

// MARK: - Video Card

private struct VideoCard: View {
    let video: VideoViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Thumbnail
            AsyncImage(url: video.thumbnailUrl) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(16/9, contentMode: .fill)
                case .failure:
                    thumbnailPlaceholder
                default:
                    thumbnailPlaceholder
                        .overlay { ProgressView().controlSize(.small) }
                }
            }
            .aspectRatio(16/9, contentMode: .fit)
            .clipShape(.rect(cornerRadius: 8))

            // Title
            Text(video.title)
                .font(.subheadline.weight(.medium))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            // Channel
            if let channel = video.channelName {
                Text(channel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(8)
        .background(Color(nsColor: .controlBackgroundColor), in: .rect(cornerRadius: 10))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
    }

    private var thumbnailPlaceholder: some View {
        Color(nsColor: .quaternaryLabelColor)
            .aspectRatio(16/9, contentMode: .fit)
            .overlay {
                Image(systemName: "play.rectangle.fill")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
    }
}
