import Foundation

/// Orchestrates the full tagging pipeline: load → embed → cluster → label.
public enum TaggingPipeline {
    public struct Options: Sendable {
        public let clusterCount: Int
        public let maxIterations: Int

        public init(clusterCount: Int = 20, maxIterations: Int = 100) {
            self.clusterCount = clusterCount
            self.maxIterations = maxIterations
        }
    }

    public static func run(
        inventoryPath: URL,
        options: Options = Options()
    ) throws -> TaggingResult {
        // 1. Load inventory
        let snapshot = try InventoryLoader.load(from: inventoryPath)
        let videos = snapshot.items

        // 2. Embed titles
        let embedder = try VideoEmbedder()
        let (indices, vectors) = embedder.embedVideos(videos)

        guard !vectors.isEmpty else {
            throw TaggingPipelineError.noEmbeddableVideos
        }

        // 3. Cluster
        let clustering = KMeansClustering(k: options.clusterCount, maxIterations: options.maxIterations)
        let result = clustering.cluster(vectors: vectors)

        // 4. Label
        let taggedClusters = ClusterLabeler.label(
            clusters: result,
            videos: videos,
            embeddedIndices: indices
        )

        return TaggingResult(
            sourceInventoryPath: inventoryPath.path,
            totalVideos: videos.count,
            embeddedVideos: vectors.count,
            clusterCount: options.clusterCount,
            iterations: result.iterations,
            clusters: taggedClusters.sorted { $0.videoCount > $1.videoCount }
        )
    }
}

public enum TaggingPipelineError: LocalizedError {
    case noEmbeddableVideos

    public var errorDescription: String? {
        switch self {
        case .noEmbeddableVideos:
            "No videos had embeddable text (titles). Cannot cluster."
        }
    }
}
