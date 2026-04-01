import SwiftUI

struct ThumbnailPreviewView: View {
    @Bindable var model: TransferViewModel
    private let loadingThumbnailURL = URL(string: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            artwork
                .frame(width: AppStyle.thumbnailWidth, height: AppStyle.thumbnailHeight)
                .clipped()
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Color(nsColor: .separatorColor), lineWidth: 1)
                }

            if !model.isShowingCompletedState {
                metadataSection
            }
        }
        .frame(width: AppStyle.thumbnailWidth, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.thumbnailAccessibilityLabel)
        .accessibilityValue(model.thumbnailAccessibilityValue)
    }

    @ViewBuilder
    private var artwork: some View {
        if model.isShowingCompletedState, !model.completedMosaicItems.isEmpty {
            CompletedThumbnailMosaicView(items: model.completedMosaicItems)
        } else if let currentItem = model.currentItem {
            ThumbnailArtworkView(item: currentItem)
        } else {
            if let loadingThumbnailURL {
                AsyncImage(url: loadingThumbnailURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure, .empty:
                        fallbackPlaceholder
                    @unknown default:
                        fallbackPlaceholder
                    }
                }
            } else {
                fallbackPlaceholder
            }
        }
    }

    private var metadataSection: some View {
        HStack(alignment: .top, spacing: 10) {
            ChannelAvatarView(url: channelAvatarURL)

            VStack(alignment: .leading, spacing: 4) {
                Text(currentTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)

                if let channelMetadata {
                    Text(channelMetadata)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .lineLimit(1)
                }

                if let engagementMetadata {
                    Text(engagementMetadata)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var currentTitle: String {
        if let title = model.currentItem?.title, !title.isEmpty {
            return Self.initialCapped(title)
        }

        return model.latestResult?.ok == true ? "Migration complete" : "Never Gonna Give You Up"
    }

    private var channelMetadata: String? {
        if let channelName = model.currentItem?.channelName, !channelName.isEmpty {
            return channelName
        }

        return model.latestResult?.ok == true ? nil : "RICK ASTLEY"
    }

    private var engagementMetadata: String? {
        let views = model.currentItem?.viewCountText?.trimmingCharacters(in: .whitespacesAndNewlines)
        let published = model.currentItem?.publishedTimeText?.trimmingCharacters(in: .whitespacesAndNewlines)

        switch (views, published) {
        case let (views?, published?) where !views.isEmpty && !published.isEmpty:
            return "\(views) • \(published)"
        case let (views?, _) where !views.isEmpty:
            return views
        case let (_, published?) where !published.isEmpty:
            return published
        default:
            return model.latestResult?.ok == true ? nil : "1.6B views • 14 years ago"
        }
    }

    private var channelAvatarURL: URL? {
        model.currentItem?.channelAvatarURL ?? (model.latestResult?.ok == true ? nil : loadingThumbnailURL)
    }

    private static func initialCapped(_ text: String) -> String {
        guard let index = text.firstIndex(where: \.isLetter) else {
            return text
        }

        let letter = String(text[index]).uppercased()
        var normalized = text
        normalized.replaceSubrange(index ... index, with: letter)
        return normalized
    }

    private var fallbackPlaceholder: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color(nsColor: .controlBackgroundColor))
            .overlay {
                Image(systemName: "play.rectangle")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
    }
}

private struct ChannelAvatarView: View {
    let url: URL?

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure, .empty:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 36, height: 36)
        .clipShape(Circle())
    }

    private var placeholder: some View {
        Circle()
            .fill(Color(nsColor: .controlColor))
            .overlay {
                Image(systemName: "person.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
    }
}

private struct ThumbnailArtworkView: View {
    let item: MoveItemSnapshot

    var body: some View {
        if let thumbnailURL = item.thumbnailURL {
            AsyncImage(url: thumbnailURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure, .empty:
                    MockThumbnailArtworkView(item: item)
                @unknown default:
                    MockThumbnailArtworkView(item: item)
                }
            }
        } else {
            MockThumbnailArtworkView(item: item)
        }
    }
}
