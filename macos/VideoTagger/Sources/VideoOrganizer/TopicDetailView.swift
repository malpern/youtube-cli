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

    var body: some View {
        VStack(spacing: 0) {
            // Header
            TopicHeaderView(topic: topic, videoCount: videos.count, store: store)

            Divider()

            // Video list
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    ForEach(filteredVideos) { video in
                        VideoRowView(video: video, isSelected: store.selectedVideoIds.contains(video.id))
                            .contentShape(Rectangle())
                            .onTapGesture {
                                toggleSelection(video.id)
                            }
                            .contextMenu {
                                videoContextMenu(for: video)
                            }
                            .draggable(video.id)
                    }
                }
                .padding(.horizontal)
            }
        }
        .searchable(text: $searchText, prompt: "Search videos")
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
                    if store.selectedVideoIds.contains(video.id), store.selectedVideoIds.count > 1 {
                        store.moveVideos(videoIds: store.selectedVideoIds, toTopicId: other.id)
                    } else {
                        store.moveVideo(videoId: video.id, toTopicId: other.id)
                    }
                }
            }
        }

        if let url = video.videoUrl.flatMap({ URL(string: $0) }) {
            Divider()
            Link("Open on YouTube", destination: url)
        }
    }

    private func toggleSelection(_ videoId: String) {
        if NSEvent.modifierFlags.contains(.command) {
            if store.selectedVideoIds.contains(videoId) {
                store.selectedVideoIds.remove(videoId)
            } else {
                store.selectedVideoIds.insert(videoId)
            }
        } else {
            store.selectedVideoIds = [videoId]
        }
    }
}

// MARK: - Topic Header

private struct TopicHeaderView: View {
    let topic: TopicViewModel
    let videoCount: Int
    let store: OrganizerStore

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(topic.name)
                    .font(.title2.bold())

                Text("\(videoCount) videos")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if store.isLoading {
                ProgressView()
                    .controlSize(.small)
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
                    .font(.title3)
            }
            .menuStyle(.borderlessButton)
            .frame(width: 30)
        }
        .padding()
    }
}

// MARK: - Video Row

struct VideoRowView: View {
    let video: VideoViewModel
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            // Thumbnail
            AsyncImage(url: video.thumbnailUrl) { image in
                image.resizable().aspectRatio(16/9, contentMode: .fill)
            } placeholder: {
                Rectangle()
                    .fill(.quaternary)
                    .overlay {
                        Image(systemName: "play.rectangle")
                            .foregroundStyle(.tertiary)
                    }
            }
            .frame(width: 120, height: 68)
            .clipShape(.rect(cornerRadius: 6))

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(video.title)
                    .font(.body)
                    .lineLimit(2)

                if let channel = video.channelName {
                    Text(channel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(isSelected ? Color.accentColor.opacity(0.15) : .clear, in: .rect(cornerRadius: 8))
    }
}
