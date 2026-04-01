import Testing
@testable import TaggingKit

@Suite("TopicStore")
struct TopicStoreTests {
    @Test("creates topics and assigns videos")
    func createAndAssign() throws {
        let store = try TopicStore(inMemory: true)
        let items = (0..<5).map { i in
            VideoItem(sourceIndex: i, title: "Video \(i)", videoUrl: nil,
                      videoId: "vid-\(i)", channelName: "Ch", metadataText: nil, unavailableKind: "none")
        }
        try store.importVideos(items)

        let topicId = try store.createTopic(name: "Test Topic")
        try store.assignVideos(indices: [0, 1, 2], toTopic: topicId)

        let topics = try store.listTopics()
        #expect(topics.count == 1)
        #expect(topics[0].videoCount == 3)
        #expect(topics[0].name == "Test Topic")

        let videos = try store.videosForTopic(id: topicId)
        #expect(videos.count == 3)

        #expect(try store.unassignedCount() == 2)
    }

    @Test("merges topics")
    func mergeTopics() throws {
        let store = try TopicStore(inMemory: true)
        let items = (0..<6).map { i in
            VideoItem(sourceIndex: i, title: "V\(i)", videoUrl: nil,
                      videoId: "v\(i)", channelName: nil, metadataText: nil, unavailableKind: "none")
        }
        try store.importVideos(items)

        let t1 = try store.createTopic(name: "A")
        let t2 = try store.createTopic(name: "B")
        try store.assignVideos(indices: [0, 1, 2], toTopic: t1)
        try store.assignVideos(indices: [3, 4, 5], toTopic: t2)

        try store.mergeTopic(sourceId: t2, intoId: t1)

        let topics = try store.listTopics()
        #expect(topics.count == 1)
        #expect(topics[0].videoCount == 6)
        #expect(topics[0].name == "A")
    }

    @Test("delete topic unassigns videos")
    func deleteTopic() throws {
        let store = try TopicStore(inMemory: true)
        let items = [VideoItem(sourceIndex: 0, title: "V", videoUrl: nil,
                               videoId: "v0", channelName: nil, metadataText: nil, unavailableKind: "none")]
        try store.importVideos(items)

        let topicId = try store.createTopic(name: "Gone")
        try store.assignVideos(indices: [0], toTopic: topicId)
        #expect(try store.unassignedCount() == 0)

        try store.deleteTopic(id: topicId)
        #expect(try store.listTopics().count == 0)
        #expect(try store.unassignedCount() == 1)
    }

    @Test("sync plan collapses net effects")
    func syncPlanCollapse() throws {
        let store = try TopicStore(inMemory: true)

        // Video moved A→B then B→C — should only sync A→C
        try store.queueCommit(action: "add_to_playlist", videoId: "v1", playlist: "Playlist B")
        try store.queueCommit(action: "add_to_playlist", videoId: "v1", playlist: "Playlist C")

        let plan = try store.pendingSyncPlan()
        #expect(plan.count == 1)
        #expect(plan[0].playlist == "Playlist C")
    }
}
