import Foundation

/// Uses Claude to suggest topics for a batch of video titles.
public actor TopicSuggester {
    private let client: ClaudeClient

    public init(client: ClaudeClient) {
        self.client = client
    }

    public struct SuggestedTopic: Codable, Sendable {
        public let name: String
        public let videoIndices: [Int]
    }

    public struct SuggestionResult: Sendable {
        public let topics: [SuggestedTopic]
        public let batchCount: Int
    }

    /// Suggest initial topics for a set of videos. Uses Haiku for speed/cost.
    /// Processes in batches to stay within context limits.
    public func suggestTopics(
        videos: [VideoItem],
        targetTopicCount: Int = 12,
        batchSize: Int = 200,
        onProgress: (@Sendable (Int, Int) -> Void)? = nil
    ) async throws -> SuggestionResult {
        let batches = stride(from: 0, to: videos.count, by: batchSize).map { start in
            let end = min(start + batchSize, videos.count)
            return (offset: start, items: Array(videos[start..<end]))
        }

        var allAssignments: [(videoIndex: Int, topicName: String)] = []

        for (batchIdx, batch) in batches.enumerated() {
            onProgress?(batchIdx + 1, batches.count)

            let titleList = batch.items.enumerated().map { i, v in
                let channel = v.channelName.map { " [\($0)]" } ?? ""
                return "\(batch.offset + i). \(v.title ?? "Untitled")\(channel)"
            }.joined(separator: "\n")

            let prompt = """
            Organize these YouTube video titles into \(targetTopicCount) topics.
            Each video belongs to exactly one topic.

            Return ONLY valid JSON — no markdown, no explanation. Format:
            [{"topic": "Topic Name", "indices": [0, 5, 12, ...]}]

            Use short, descriptive topic names (2-4 words).

            Videos:
            \(titleList)
            """

            let system = """
            You are a video librarian. Organize videos into clear, intuitive topic categories.
            Prefer specific topics ("Mechanical Keyboards", "SwiftUI Development") over vague ones ("Technology", "Interesting").
            If a video could fit multiple topics, pick the most specific one.
            """

            let response = try await client.complete(
                prompt: prompt,
                system: system,
                model: .haiku,
                maxTokens: 4096
            )

            let batchTopics = try parseTopicResponse(response)
            for topic in batchTopics {
                for index in topic.videoIndices {
                    if index >= batch.offset && index < batch.offset + batch.items.count {
                        allAssignments.append((videoIndex: index, topicName: topic.name))
                    }
                }
            }
        }

        // Consolidate across batches — merge topics with the same or similar names
        let topics = consolidateTopics(assignments: allAssignments)

        return SuggestionResult(topics: topics, batchCount: batches.count)
    }

    /// Split a topic into sub-topics. Uses Sonnet for better quality.
    public func splitTopic(
        topicName: String,
        videos: [VideoItem],
        videoIndices: [Int],
        targetSubTopics: Int = 3
    ) async throws -> [SuggestedTopic] {
        let titleList = zip(videoIndices, videos).map { idx, v in
            let channel = v.channelName.map { " [\($0)]" } ?? ""
            return "\(idx). \(v.title ?? "Untitled")\(channel)"
        }.joined(separator: "\n")

        let prompt = """
        This topic "\(topicName)" has \(videos.count) videos. Split it into \(targetSubTopics) more specific sub-topics.
        Each video belongs to exactly one sub-topic.

        Return ONLY valid JSON:
        [{"topic": "Sub-Topic Name", "indices": [0, 5, 12, ...]}]

        Videos:
        \(titleList)
        """

        let response = try await client.complete(
            prompt: prompt,
            system: "You are a video librarian splitting a broad topic into specific sub-categories.",
            model: .sonnet,
            maxTokens: 4096
        )

        return try parseTopicResponse(response)
    }

    /// Suggest a better name for a topic based on its videos. Uses Sonnet.
    public func renameTopic(
        currentName: String,
        videos: [VideoItem]
    ) async throws -> String {
        let sampleTitles = videos.prefix(20).compactMap(\.title).joined(separator: "\n")

        let prompt = """
        This topic is currently named "\(currentName)" and contains \(videos.count) videos.
        Here are some titles:

        \(sampleTitles)

        Suggest a better 2-4 word topic name. Return ONLY the name, nothing else.
        """

        return try await client.complete(
            prompt: prompt,
            model: .sonnet,
            maxTokens: 50
        ).trimmingCharacters(in: .whitespacesAndNewlines.union(.init(charactersIn: "\"")))
    }

    // MARK: - Private

    private struct ParsedTopic: Decodable {
        let topic: String
        let indices: [Int]
        let name: String?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.topic = (try? container.decode(String.self, forKey: .topic))
                ?? (try? container.decode(String.self, forKey: .name))
                ?? "Unknown"
            self.name = try? container.decode(String.self, forKey: .name)
            self.indices = try container.decode([Int].self, forKey: .indices)
        }

        enum CodingKeys: String, CodingKey {
            case topic, indices, name
        }
    }

    private func parseTopicResponse(_ response: String) throws -> [SuggestedTopic] {
        // Extract JSON from response (handle markdown code blocks)
        let cleaned = response
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard let data = cleaned.data(using: .utf8) else {
            throw TopicSuggesterError.invalidJSON(response.prefix(200).description)
        }

        let parsed = try JSONDecoder().decode([ParsedTopic].self, from: data)
        return parsed.map { SuggestedTopic(name: $0.topic, videoIndices: $0.indices) }
    }

    private func consolidateTopics(
        assignments: [(videoIndex: Int, topicName: String)]
    ) -> [SuggestedTopic] {
        var topicMap: [String: [Int]] = [:]

        for (index, name) in assignments {
            // Normalize topic names for merging across batches
            let normalized = name.trimmingCharacters(in: .whitespacesAndNewlines)
            topicMap[normalized, default: []].append(index)
        }

        return topicMap.map { SuggestedTopic(name: $0.key, videoIndices: $0.value) }
            .sorted { $0.videoIndices.count > $1.videoIndices.count }
    }
}

public enum TopicSuggesterError: LocalizedError {
    case invalidJSON(String)

    public var errorDescription: String? {
        switch self {
        case .invalidJSON(let preview):
            "Could not parse Claude's response as JSON: \(preview)"
        }
    }
}
