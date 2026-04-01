import SwiftUI

struct OrganizerView: View {
    @Bindable var store: OrganizerStore

    var body: some View {
        NavigationSplitView {
            TopicSidebar(store: store)
                .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
        } detail: {
            if let topicId = store.selectedTopicId,
               let topic = store.topics.first(where: { $0.id == topicId }) {
                TopicDetailView(store: store, topic: topic)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "rectangle.stack")
                        .font(.system(size: 48))
                        .foregroundStyle(.tertiary)
                    Text("Select a Topic")
                        .font(.title2)
                    Text("Choose a topic from the sidebar to browse its videos.")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
