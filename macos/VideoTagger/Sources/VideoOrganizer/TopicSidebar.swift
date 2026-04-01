import SwiftUI

struct TopicSidebar: View {
    @Bindable var store: OrganizerStore
    @State private var searchText = ""
    @State private var renamingTopicId: Int64?
    @State private var renameText = ""

    private var filteredTopics: [TopicViewModel] {
        guard !searchText.isEmpty else { return store.topics }
        return store.topics.filter { $0.name.localizedStandardContains(searchText) }
    }

    var body: some View {
        List(selection: $store.selectedTopicId) {
            Section {
                ForEach(filteredTopics) { topic in
                    TopicRow(topic: topic, isRenaming: renamingTopicId == topic.id, renameText: $renameText)
                        .tag(topic.id)
                        .contextMenu { contextMenu(for: topic) }
                        .onSubmit {
                            if renamingTopicId == topic.id {
                                commitRename(topic.id)
                            }
                        }
                }
            } header: {
                HStack {
                    Text("Topics")
                    Spacer()
                    Text("\(store.totalVideoCount) videos")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if store.unassignedCount > 0 {
                Section {
                    Label("\(store.unassignedCount) unassigned", systemImage: "questionmark.folder")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .searchable(text: $searchText, placement: .sidebar, prompt: "Filter topics")
        .navigationTitle("Video Organizer")
    }

    @ViewBuilder
    private func contextMenu(for topic: TopicViewModel) -> some View {
        Button("Rename…") {
            renameText = topic.name
            renamingTopicId = topic.id
        }

        Divider()

        Menu("Move Selected Here") {
            Text("Drop videos onto this topic")
        }
        .disabled(store.selectedVideoIds.isEmpty)

        Divider()

        Button("Split Topic…") {
            Task { await store.splitTopic(topic.id) }
        }

        if let selectedId = store.selectedTopicId, selectedId != topic.id {
            Button("Merge into \(store.topics.first { $0.id == selectedId }?.name ?? "selected")") {
                store.mergeTopics(sourceId: topic.id, intoId: selectedId)
            }
        }

        Divider()

        Button("Delete Topic", role: .destructive) {
            store.deleteTopic(topic.id)
        }
    }

    private func commitRename(_ topicId: Int64) {
        let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            store.renameTopic(topicId, to: trimmed)
        }
        renamingTopicId = nil
    }
}

// MARK: - Topic Row

private struct TopicRow: View {
    let topic: TopicViewModel
    let isRenaming: Bool
    @Binding var renameText: String

    var body: some View {
        HStack {
            if isRenaming {
                TextField("Topic name", text: $renameText)
                    .textFieldStyle(.roundedBorder)
            } else {
                Text(topic.name)
                    .lineLimit(1)
            }

            Spacer()

            Text("\(topic.videoCount)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(.quaternary, in: Capsule())
        }
    }
}
