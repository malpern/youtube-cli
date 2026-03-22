import SwiftUI

struct CompletedThumbnailMosaicView: View {
    let items: [MoveItemSnapshot]

    private let columns = 3
    private let rows = 3
    private let spacing: CGFloat = 2

    var body: some View {
        GeometryReader { geometry in
            let cellWidth = (geometry.size.width - (CGFloat(columns - 1) * spacing)) / CGFloat(columns)
            let cellHeight = (geometry.size.height - (CGFloat(rows - 1) * spacing)) / CGFloat(rows)

            VStack(spacing: spacing) {
                ForEach(0..<rows, id: \.self) { row in
                    HStack(spacing: spacing) {
                        ForEach(0..<columns, id: \.self) { column in
                            let index = (row * columns) + column
                            MosaicCellView(item: items[safe: index])
                                .frame(width: cellWidth, height: cellHeight)
                        }
                    }
                }
            }
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

private struct MosaicCellView: View {
    let item: MoveItemSnapshot?

    var body: some View {
        Group {
            if let thumbnailURL = item?.thumbnailURL {
                AsyncImage(url: thumbnailURL) { phase in
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
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(nsColor: .controlBackgroundColor),
                        Color(nsColor: .quaternaryLabelColor).opacity(0.18)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else {
            return nil
        }

        return self[index]
    }
}
