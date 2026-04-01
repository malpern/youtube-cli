import SwiftUI

struct OrganizerView: View {
    @Bindable var store: OrganizerStore

    var body: some View {
        NavigationSplitView {
            TopicSidebar(store: store)
        } detail: {
            if let topicId = store.selectedTopicId,
               let topic = store.topics.first(where: { $0.id == topicId }) {
                TopicDetailView(store: store, topic: topic)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "list.bullet")
                        .font(.system(size: 48))
                        .foregroundStyle(.tertiary)
                    Text("Select a Topic")
                        .font(.title2)
                    Text("Choose a topic from the sidebar to browse its videos.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
    }
}
