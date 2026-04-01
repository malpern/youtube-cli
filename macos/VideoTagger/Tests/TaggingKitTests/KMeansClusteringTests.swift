import Testing
@testable import TaggingKit

@Suite("KMeansClustering")
struct KMeansClusteringTests {
    @Test("clusters simple 2D vectors into expected groups")
    func clustersSimpleVectors() {
        // Two obvious clusters: around (0,0) and around (10,10)
        let vectors: [[Double]] = [
            [0.1, 0.2], [0.3, 0.1], [-0.1, 0.3], [0.2, -0.1],
            [10.1, 10.2], [10.3, 10.1], [9.9, 10.3], [10.2, 9.9]
        ]

        let clustering = KMeansClustering(k: 2)
        let result = clustering.cluster(vectors: vectors)

        #expect(result.assignments.count == 8)
        #expect(result.centroids.count == 2)

        // First 4 should be in one cluster, last 4 in another
        let firstGroup = result.assignments[0]
        let secondGroup = result.assignments[4]
        #expect(firstGroup != secondGroup)

        for i in 0..<4 {
            #expect(result.assignments[i] == firstGroup)
        }
        for i in 4..<8 {
            #expect(result.assignments[i] == secondGroup)
        }
    }

    @Test("handles empty input")
    func handlesEmptyInput() {
        let clustering = KMeansClustering(k: 3)
        let result = clustering.cluster(vectors: [])

        #expect(result.assignments.isEmpty)
        #expect(result.centroids.isEmpty)
        #expect(result.iterations == 0)
    }

    @Test("converges within max iterations")
    func convergesWithinLimit() {
        let vectors: [[Double]] = (0..<20).map { i in
            [Double(i % 5), Double(i / 5)]
        }

        let clustering = KMeansClustering(k: 4, maxIterations: 50)
        let result = clustering.cluster(vectors: vectors)

        #expect(result.iterations <= 50)
        #expect(result.assignments.count == 20)
    }
}
