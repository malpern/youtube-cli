import SwiftUI

struct MockThumbnailArtworkView: View {
    let item: MoveItemSnapshot

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(backgroundGradient)

            Circle()
                .fill(.white.opacity(0.14))
                .frame(width: 120, height: 120)
                .offset(x: 70, y: -30)

            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.white.opacity(0.12))
                .frame(width: 140, height: 12)
                .offset(x: 20, y: -86)

            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.white.opacity(0.1))
                .frame(width: 96, height: 12)
                .offset(x: 20, y: -66)

            VStack(alignment: .leading, spacing: 6) {
                Text(item.title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)

                if let channelName = item.channelName {
                    Text(channelName)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.82))
                        .lineLimit(1)
                }
            }
            .padding(14)
        }
    }

    private var backgroundGradient: LinearGradient {
        let palette = palettes[(item.sourceIndex - 1) % palettes.count]
        return LinearGradient(colors: palette, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var palettes: [[Color]] {
        [
            [Color(red: 0.90, green: 0.42, blue: 0.24), Color(red: 0.46, green: 0.18, blue: 0.20)],
            [Color(red: 0.22, green: 0.48, blue: 0.92), Color(red: 0.09, green: 0.23, blue: 0.55)],
            [Color(red: 0.46, green: 0.33, blue: 0.83), Color(red: 0.18, green: 0.12, blue: 0.42)],
            [Color(red: 0.80, green: 0.58, blue: 0.18), Color(red: 0.36, green: 0.26, blue: 0.08)]
        ]
    }
}
