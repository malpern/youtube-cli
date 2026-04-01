import SwiftUI

struct VideoCardView: View {
    let video: VideoViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Thumbnail
            AsyncImage(url: video.thumbnailUrl) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(16/9, contentMode: .fill)
                case .failure:
                    thumbnailPlaceholder
                default:
                    thumbnailPlaceholder
                        .overlay { ProgressView().controlSize(.small) }
                }
            }
            .frame(height: 158)
            .clipShape(.rect(cornerRadius: 8))

            // Title
            Text(video.title)
                .font(.subheadline)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Channel
            if let channel = video.channelName {
                Text(channel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(6)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(.rect(cornerRadius: 10))
    }

    private var thumbnailPlaceholder: some View {
        Rectangle()
            .fill(.quaternary)
            .aspectRatio(16/9, contentMode: .fill)
            .overlay {
                Image(systemName: "play.rectangle.fill")
                    .font(.title)
                    .foregroundStyle(.tertiary)
            }
    }
}
