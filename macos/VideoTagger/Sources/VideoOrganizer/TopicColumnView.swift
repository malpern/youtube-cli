import SwiftUI

struct TopicColumnView: View {
    @Bindable var store: OrganizerStore
    let topic: TopicViewModel
    @State private var videos: [VideoViewModel] = []
    @State private var subTopics: [String] = [] // Placeholder for sub-topic capsules

    private let columnWidth: CGFloat = 300

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Column header with topic capsule
            columnHeader
            Divider()

            // Sub-topic capsules (if discovered)
            if !subTopics.isEmpty {
                subTopicCapsules
                Divider()
            }

            // Vertical scrolling video cards
            ScrollView(.vertical, showsIndicators: true) {
                LazyVStack(spacing: 8) {
                    ForEach(videos) { video in
                        VideoCardView(video: video)
                            .contextMenu {
                                videoContextMenu(for: video)
                            }
                    }
                }
                .padding(8)
            }
        }
        .frame(width: columnWidth)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(.rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
        }
        .task(id: topic.id) {
            videos = store.videosForTopic(topic.id)
        }
        .onChange(of: store.topics) { _, _ in
            videos = store.videosForTopic(topic.id)
        }
    }

    // MARK: - Column Header

    private var columnHeader: some View {
        HStack {
            Text(topic.name)
                .font(.headline)
                .lineLimit(1)

            Spacer()

            Text("\(topic.videoCount)")
                .font(.caption.monospacedDigit().bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(.blue, in: Capsule())

            Menu {
                Button("Split Topic…") {
                    Task { await store.splitTopic(topic.id) }
                }
                Button("Rename…") { }
                Divider()
                Button("Delete Topic", role: .destructive) {
                    store.deleteTopic(topic.id)
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .frame(width: 20)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    // MARK: - Sub-topic Capsules

    private var subTopicCapsules: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(subTopics, id: \.self) { sub in
                    Text(sub)
                        .font(.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.accentColor.opacity(0.12), in: Capsule())
                        .foregroundStyle(Color.accentColor)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
    }

    // MARK: - Context Menu

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
