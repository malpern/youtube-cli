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

    // TODO: Extend the TypeScript `move --json` event payload to provide channel avatar,
    // view count, and published time so the macOS app can replace this mock metadata.
    var id: Int {
        sourceIndex
    }
}
