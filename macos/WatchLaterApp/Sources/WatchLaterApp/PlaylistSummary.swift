import Foundation

struct PlaylistSummary: Identifiable, Equatable {
    var id: String
    var title: String
    var visibility: String
    var videoCount: Int
    var isDraft: Bool

    init(
        id: String? = nil,
        title: String,
        visibility: String,
        videoCount: Int = 0,
        isDraft: Bool = false
    ) {
        self.id = id ?? title
        self.title = title
        self.visibility = visibility
        self.videoCount = videoCount
        self.isDraft = isDraft
    }

    var isPrivate: Bool {
        visibility == "Private"
    }

    var countLabel: String {
        "\(videoCount) video" + (videoCount == 1 ? "" : "s")
    }
}
