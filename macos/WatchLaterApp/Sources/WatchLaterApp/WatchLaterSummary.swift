import Foundation

struct WatchLaterSummary: Equatable {
    let videoCount: Int
    let maxItems: Int

    var remainingCapacity: Int {
        max(maxItems - videoCount, 0)
    }

    var utilization: Double {
        guard maxItems > 0 else {
            return 0
        }

        return min(Double(videoCount) / Double(maxItems), 1)
    }

    var nearCapacity: Bool {
        videoCount >= Int(Double(maxItems) * 0.9) && !atCapacity
    }

    var atCapacity: Bool {
        videoCount >= maxItems
    }

    var countLabel: String {
        "\(videoCount.formatted()) videos"
    }

    var remainingLabel: String {
        "\(remainingCapacity.formatted()) slots left"
    }
}
