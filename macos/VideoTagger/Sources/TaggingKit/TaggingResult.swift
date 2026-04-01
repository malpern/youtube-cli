import Foundation

/// The output of a tagging run — clusters with labels and video assignments.
public struct TaggingResult: Codable, Sendable {
    public let generatedAt: String
    public let sourceInventoryPath: String
    public let totalVideos: Int
    public let embeddedVideos: Int
    public let clusterCount: Int
    public let iterations: Int
    public let clusters: [ClusterLabeler.TaggedCluster]

    public init(
        sourceInventoryPath: String,
        totalVideos: Int,
        embeddedVideos: Int,
        clusterCount: Int,
        iterations: Int,
        clusters: [ClusterLabeler.TaggedCluster]
    ) {
        self.generatedAt = ISO8601DateFormatter().string(from: Date())
        self.sourceInventoryPath = sourceInventoryPath
        self.totalVideos = totalVideos
        self.embeddedVideos = embeddedVideos
        self.clusterCount = clusterCount
        self.iterations = iterations
        self.clusters = clusters
    }
}
