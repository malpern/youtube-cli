import Foundation

struct MoveItemSnapshot: Identifiable, Equatable {
    let sourceIndex: Int
    let title: String
    let channelName: String?
    let channelAvatarURL: URL?
    let viewCountText: String?
    let publishedTimeText: String?
    let videoID: String?
    let videoURL: URL?
    let thumbnailURL: URL?
    let result: String

    var id: Int {
        sourceIndex
    }
}
