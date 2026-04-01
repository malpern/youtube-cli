import Foundation
import Accelerate

/// K-means clustering over dense vectors using Accelerate for fast distance computation.
public struct KMeansClustering: Sendable {
    public let k: Int
    public let maxIterations: Int

    public init(k: Int, maxIterations: Int = 100) {
        self.k = k
        self.maxIterations = maxIterations
    }

    public struct ClusterResult: Sendable {
        /// Cluster assignment for each input vector (0-based cluster index).
        public let assignments: [Int]
        /// Centroid vectors, one per cluster.
        public let centroids: [[Double]]
        /// Number of iterations that were run.
        public let iterations: Int
    }

    /// Run k-means on the given vectors. Each vector must have the same dimension.
    public func cluster(vectors: [[Double]]) -> ClusterResult {
        guard !vectors.isEmpty else {
            return ClusterResult(assignments: [], centroids: [], iterations: 0)
        }

        let n = vectors.count
        let dim = vectors[0].count

        // Flatten to contiguous array for Accelerate
        var flat = vectors.flatMap { $0 }

        // Initialize centroids via k-means++ seeding
        var centroids = kMeansPlusPlusSeed(flat: flat, n: n, dim: dim, k: k)
        var assignments = [Int](repeating: 0, count: n)
        var iteration = 0

        for iter in 0..<maxIterations {
            iteration = iter + 1

            // Assign each vector to the nearest centroid
            var changed = false
            for i in 0..<n {
                let vecStart = i * dim
                var bestCluster = 0
                var bestDist = Double.greatestFiniteMagnitude

                for c in 0..<k {
                    let centStart = c * dim
                    let dist = squaredEuclideanDistance(
                        flat, vecStart,
                        centroids, centStart,
                        dim
                    )
                    if dist < bestDist {
                        bestDist = dist
                        bestCluster = c
                    }
                }

                if assignments[i] != bestCluster {
                    assignments[i] = bestCluster
                    changed = true
                }
            }

            if !changed {
                break
            }

            // Recompute centroids
            var newCentroids = [Double](repeating: 0, count: k * dim)
            var counts = [Int](repeating: 0, count: k)

            for i in 0..<n {
                let c = assignments[i]
                counts[c] += 1
                let vecStart = i * dim
                let centStart = c * dim
                for d in 0..<dim {
                    newCentroids[centStart + d] += flat[vecStart + d]
                }
            }

            for c in 0..<k {
                let count = Double(max(counts[c], 1))
                let centStart = c * dim
                for d in 0..<dim {
                    newCentroids[centStart + d] /= count
                }
            }

            centroids = newCentroids
        }

        // Unflatten centroids
        var centroidVectors: [[Double]] = []
        for c in 0..<k {
            let start = c * dim
            centroidVectors.append(Array(centroids[start..<start + dim]))
        }

        return ClusterResult(
            assignments: assignments,
            centroids: centroidVectors,
            iterations: iteration
        )
    }

    // MARK: - Private

    private func squaredEuclideanDistance(
        _ a: [Double], _ aOffset: Int,
        _ b: [Double], _ bOffset: Int,
        _ dim: Int
    ) -> Double {
        var sum = 0.0
        for d in 0..<dim {
            let diff = a[aOffset + d] - b[bOffset + d]
            sum += diff * diff
        }
        return sum
    }

    private func kMeansPlusPlusSeed(flat: [Double], n: Int, dim: Int, k: Int) -> [Double] {
        var centroids = [Double](repeating: 0, count: k * dim)
        var rng = SystemRandomNumberGenerator()

        // Pick first centroid randomly
        let first = Int.random(in: 0..<n, using: &rng)
        for d in 0..<dim {
            centroids[d] = flat[first * dim + d]
        }

        // Pick subsequent centroids with probability proportional to squared distance
        var distances = [Double](repeating: Double.greatestFiniteMagnitude, count: n)

        for c in 1..<k {
            // Update distances to nearest existing centroid
            for i in 0..<n {
                let dist = squaredEuclideanDistance(flat, i * dim, centroids, (c - 1) * dim, dim)
                distances[i] = min(distances[i], dist)
            }

            let totalDist = distances.reduce(0, +)
            var threshold = Double.random(in: 0..<totalDist, using: &rng)
            var chosen = 0

            for i in 0..<n {
                threshold -= distances[i]
                if threshold <= 0 {
                    chosen = i
                    break
                }
            }

            let centStart = c * dim
            for d in 0..<dim {
                centroids[centStart + d] = flat[chosen * dim + d]
            }
        }

        return centroids
    }
}
