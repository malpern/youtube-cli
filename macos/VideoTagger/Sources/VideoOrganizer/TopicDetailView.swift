import SwiftUI

struct TopicDetailView: View {
    @Bindable var store: OrganizerStore
    let topic: TopicViewModel
    @State private var videos: [VideoViewModel] = []
    @State private var searchText = ""

    private var filteredVideos: [VideoViewModel] {
        guard !searchText.isEmpty else { return videos }
        return videos.filter {
            $0.title.localizedStandardContains(searchText) ||
            ($0.channelName?.localizedStandardContains(searchText) ?? false)
        }
    }

    private let gridColumns = [
        GridItem(.adaptive(minimum: 200, maximum: 280), spacing: 16)
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: gridColumns, spacing: 20) {
                ForEach(filteredVideos) { video in
                    VideoGridItem(video: video)
                        .contextMenu { videoContextMenu(for: video) }
                }
            }
            .padding(20)
        }
        .searchable(text: $searchText, prompt: "Search videos")
        .navigationTitle(topic.name)
        .navigationSubtitle("\(filteredVideos.count) videos")
        .toolbar {
            ToolbarItemGroup {
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

// MARK: - Grid Item

private struct VideoGridItem: View {
    let video: VideoViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: video.thumbnailUrl) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(16/9, contentMode: .fill)
                case .failure:
                    placeholder
                default:
                    placeholder
                        .overlay { ProgressView().controlSize(.small) }
                }
            }
            .aspectRatio(16/9, contentMode: .fit)
            .clipShape(.rect(cornerRadius: 6))

            Text(video.title)
                .font(.caption.weight(.medium))
                .lineLimit(2)
                .frame(height: 32, alignment: .top)

            if let channel = video.channelName {
                Text(channel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var placeholder: some View {
        Color(nsColor: .quaternaryLabelColor)
            .aspectRatio(16/9, contentMode: .fit)
            .overlay {
                Image(systemName: "play.rectangle.fill")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
    }
}
