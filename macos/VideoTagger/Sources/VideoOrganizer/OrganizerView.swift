import SwiftUI

struct OrganizerView: View {
    @Bindable var store: OrganizerStore

    var body: some View {
        VStack(spacing: 0) {
            // Top bar
            TopBar(store: store)
            Divider()

            // Multi-column deck
            ScrollView(.horizontal, showsIndicators: true) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(store.topics) { topic in
                        TopicColumnView(store: store, topic: topic)
                    }
                }
                .padding(12)
            }
            .background(Color(nsColor: .windowBackgroundColor))
        }
    }
}

// MARK: - Top Bar

private struct TopBar: View {
    let store: OrganizerStore

    var body: some View {
        HStack {
            Text("Video Organizer")
                .font(.title2.bold())

            Spacer()

            Text("\(store.totalVideoCount) videos in \(store.topics.count) topics")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if store.isLoading {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }
}
