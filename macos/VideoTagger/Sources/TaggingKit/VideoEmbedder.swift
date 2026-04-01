import Foundation
@preconcurrency import NaturalLanguage

/// Embeds video titles into vector space using Apple's on-device NLEmbedding.
public final class VideoEmbedder: Sendable {
    private let embedding: NLEmbedding

    public init(language: NLLanguage = .english) throws {
        guard let embedding = NLEmbedding.sentenceEmbedding(for: language) else {
            throw VideoEmbedderError.embeddingUnavailable(language: language.rawValue)
        }
        self.embedding = embedding
    }

    /// The dimensionality of the embedding vectors.
    public var dimension: Int {
        embedding.dimension
    }

    /// Embed a single text string. Returns nil if the embedding model can't process it.
    public func embed(_ text: String) -> [Double]? {
        embedding.vector(for: text)
    }

    /// Embed all videos that have usable text. Returns parallel arrays of
    /// (indices into the input array, vectors).
    public func embedVideos(_ videos: [VideoItem]) -> (indices: [Int], vectors: [[Double]]) {
        var indices: [Int] = []
        var vectors: [[Double]] = []

        for (i, video) in videos.enumerated() {
            guard let text = video.embeddingText,
                  let vector = embed(text) else {
                continue
            }
            indices.append(i)
            vectors.append(vector)
        }

        return (indices, vectors)
    }
}

public enum VideoEmbedderError: LocalizedError {
    case embeddingUnavailable(language: String)

    public var errorDescription: String? {
        switch self {
        case .embeddingUnavailable(let language):
            "NLEmbedding for sentence embedding is not available for language '\(language)'. Ensure macOS 14+ with the language model downloaded."
        }
    }
}
