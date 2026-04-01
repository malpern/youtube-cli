import Foundation

/// Generates human-readable labels for clusters by analyzing the most frequent
/// meaningful words and channel names within each cluster.
public enum ClusterLabeler {
    public struct TaggedCluster: Codable, Sendable {
        public let clusterIndex: Int
        public let label: String
        public let videoCount: Int
        public let topChannels: [String]
        public let topTerms: [String]
        public let videoIds: [String]
    }

    /// Generate labels for each cluster based on term frequency.
    public static func label(
        clusters: KMeansClustering.ClusterResult,
        videos: [VideoItem],
        embeddedIndices: [Int]
    ) -> [TaggedCluster] {
        let k = clusters.centroids.count
        var clusterVideos: [[VideoItem]] = Array(repeating: [], count: k)

        for (assignmentIdx, clusterIdx) in clusters.assignments.enumerated() {
            let videoIdx = embeddedIndices[assignmentIdx]
            clusterVideos[clusterIdx].append(videos[videoIdx])
        }

        return (0..<k).map { clusterIdx in
            let vids = clusterVideos[clusterIdx]
            let topTerms = extractTopTerms(from: vids, maxTerms: 5)
            let topChannels = extractTopChannels(from: vids, maxChannels: 3)
            let label = topTerms.prefix(3).joined(separator: ", ")

            return TaggedCluster(
                clusterIndex: clusterIdx,
                label: label.isEmpty ? "Cluster \(clusterIdx)" : label,
                videoCount: vids.count,
                topChannels: topChannels,
                topTerms: topTerms,
                videoIds: vids.compactMap(\.videoId)
            )
        }
    }

    private static func extractTopTerms(from videos: [VideoItem], maxTerms: Int) -> [String] {
        var termCounts: [String: Int] = [:]

        let stopWords: Set<String> = [
            "the", "a", "an", "is", "it", "in", "on", "at", "to", "for",
            "of", "and", "or", "but", "not", "with", "from", "by", "as",
            "this", "that", "my", "your", "i", "you", "we", "they", "he",
            "she", "how", "what", "why", "when", "where", "who", "which",
            "do", "does", "did", "will", "can", "could", "would", "should",
            "have", "has", "had", "be", "been", "are", "was", "were",
            "just", "about", "get", "got", "all", "new", "one", "first",
            "most", "more", "very", "so", "too", "no", "up", "out",
            "video", "watch", "episode", "part", "best", "make", "made",
            "use", "using", "way", "things", "need", "know", "like",
            "every", "really", "don", "won", "can", "now", "here"
        ]

        for video in videos {
            guard let title = video.title else { continue }
            // Split on non-letter characters, filter to meaningful words
            let words = title
                .components(separatedBy: CharacterSet.letters.inverted)
                .map { $0.lowercased() }
                .filter { $0.count >= 3 && !stopWords.contains($0) }

            for word in words {
                termCounts[word, default: 0] += 1
            }
        }

        return termCounts
            .sorted { $0.value > $1.value }
            .prefix(maxTerms)
            .map(\.key)
    }

    private static func extractTopChannels(from videos: [VideoItem], maxChannels: Int) -> [String] {
        var channelCounts: [String: Int] = [:]

        for video in videos {
            guard let channel = video.channelName, !channel.isEmpty else { continue }
            channelCounts[channel, default: 0] += 1
        }

        return channelCounts
            .sorted { $0.value > $1.value }
            .prefix(maxChannels)
            .map(\.key)
    }
}
