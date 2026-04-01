import SwiftUI

struct AllVideosGridView: View {
    @Bindable var store: OrganizerStore
    @Binding var thumbnailSize: Double
    @State private var sections: [TopicSection] = []
    @State private var allVideoIds: [String] = [] // Flat list for keyboard navigation
    @State private var selectedVideoId: String?
    @FocusState private var isFocused: Bool

    private var gridColumns: [GridItem] {
        let min = thumbnailSize
        let max = thumbnailSize + 60
        return [GridItem(.adaptive(minimum: min, maximum: max), spacing: 16)]
    }

    var body: some View {
        ScrollViewReader { proxy in
            scrollContent(proxy: proxy)
                .focusable()
                .focused($isFocused)
                .onKeyPress(.downArrow) { navigateVideo(direction: 1, proxy: proxy); return .handled }
                .onKeyPress(.upArrow) { navigateVideo(direction: -1, proxy: proxy); return .handled }
                .onKeyPress(characters: CharacterSet(charactersIn: "j")) { _ in navigateVideo(direction: 1, proxy: proxy); return .handled }
                .onKeyPress(characters: CharacterSet(charactersIn: "k")) { _ in navigateVideo(direction: -1, proxy: proxy); return .handled }
                .onKeyPress(.pageDown) { navigateVideo(direction: 10, proxy: proxy); return .handled }
                .onKeyPress(.pageUp) { navigateVideo(direction: -10, proxy: proxy); return .handled }
                .onKeyPress(.home) { jumpToEdge(first: true, proxy: proxy); return .handled }
                .onKeyPress(.end) { jumpToEdge(first: false, proxy: proxy); return .handled }
                .onChange(of: selectedVideoId) { _, newId in
                    syncSidebarToVideo(newId)
                }
                .onChange(of: store.selectedTopicId) { _, newId in
                    scrollToTopic(newId, proxy: proxy)
                }
        }
        .task {
            loadSections()
            isFocused = true
            if selectedVideoId == nil, let first = allVideoIds.first {
                selectedVideoId = first
            }
        }
        .onChange(of: store.topics) { _, _ in
            loadSections()
        }
    }

    @ViewBuilder
    private func scrollContent(proxy: ScrollViewProxy) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                ForEach(sections) { section in
                    sectionView(section, proxy: proxy)
                }
            }
        }
    }

    @ViewBuilder
    private func sectionView(_ section: TopicSection, proxy: ScrollViewProxy) -> some View {
        Section {
            LazyVGrid(columns: gridColumns, spacing: 16) {
                ForEach(section.videos) { video in
                    Button { selectVideo(video.id, proxy: proxy) } label: {
                        VideoGridItem(video: video, isSelected: selectedVideoId == video.id)
                    }
                    .buttonStyle(.plain)
                    .id(video.id)
                    .contextMenu { videoContextMenu(for: video, topicId: section.topicId) }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        } header: {
            SectionHeaderView(name: section.topicName, count: section.videos.count, topicId: section.topicId)
                .id("header-\(section.topicId)")
        }
    }

    private func syncSidebarToVideo(_ videoId: String?) {
        if let vid = videoId, let section = sections.first(where: { $0.videos.contains(where: { $0.id == vid }) }) {
            store.selectedTopicId = section.topicId
        }
    }

    private func scrollToTopic(_ topicId: Int64?, proxy: ScrollViewProxy) {
        guard let topicId else { return }
        withAnimation {
            proxy.scrollTo("header-\(topicId)", anchor: .top)
        }
        if let section = sections.first(where: { $0.topicId == topicId }),
           let firstVideo = section.videos.first {
            selectedVideoId = firstVideo.id
        }
    }

    // MARK: - Data Loading

    private func loadSections() {
        var newSections: [TopicSection] = []
        var flatIds: [String] = []

        for topic in store.topics {
            let videos = store.videosForTopic(topic.id).map { v in
                VideoGridItemModel(
                    id: v.videoId,
                    title: v.title,
                    channelName: v.channelName,
                    thumbnailUrl: v.thumbnailUrl
                )
            }
            if !videos.isEmpty {
                newSections.append(TopicSection(topicId: topic.id, topicName: topic.name, videos: videos))
                flatIds.append(contentsOf: videos.map(\.id))
            }
        }

        sections = newSections
        allVideoIds = flatIds
    }

    // MARK: - Navigation

    private func selectVideo(_ id: String, proxy: ScrollViewProxy) {
        selectedVideoId = id
        isFocused = true
    }

    private func navigateVideo(direction: Int, proxy: ScrollViewProxy) {
        guard !allVideoIds.isEmpty else { return }
        let currentIndex = selectedVideoId.flatMap { allVideoIds.firstIndex(of: $0) } ?? -1
        let newIndex = max(0, min(allVideoIds.count - 1, currentIndex + direction))
        let newId = allVideoIds[newIndex]
        selectedVideoId = newId
        withAnimation {
            proxy.scrollTo(newId, anchor: .center)
        }
    }

    private func jumpToEdge(first: Bool, proxy: ScrollViewProxy) {
        guard !allVideoIds.isEmpty else { return }
        let id = first ? allVideoIds.first! : allVideoIds.last!
        selectedVideoId = id
        withAnimation {
            proxy.scrollTo(id, anchor: first ? .top : .bottom)
        }
    }

    // MARK: - Context Menu

    @ViewBuilder
    private func videoContextMenu(for video: VideoGridItemModel, topicId: Int64) -> some View {
        let otherTopics = store.topics.filter { $0.id != topicId }
        Menu("Move to…") {
            ForEach(otherTopics) { other in
                Button(other.name) {
                    store.moveVideo(videoId: video.id, toTopicId: other.id)
                }
            }
        }
    }
}

// MARK: - Section Header

private struct SectionHeaderView: View {
    let name: String
    let count: Int
    let topicId: Int64

    var body: some View {
        HStack(spacing: 10) {
            Text(name)
                .font(.title3.bold())

            Text("\(count)")
                .font(.caption.monospacedDigit().bold())
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(.quaternary, in: Capsule())

            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

// MARK: - Grid Item

struct VideoGridItem: View {
    let video: VideoGridItemModel
    let isSelected: Bool

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
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.accentColor, lineWidth: 3)
                }
            }

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

// MARK: - Models

struct TopicSection: Identifiable {
    let topicId: Int64
    let topicName: String
    let videos: [VideoGridItemModel]
    var id: Int64 { topicId }
}

struct VideoGridItemModel: Identifiable, Equatable {
    let id: String
    let title: String
    let channelName: String?
    let thumbnailUrl: URL?
}
