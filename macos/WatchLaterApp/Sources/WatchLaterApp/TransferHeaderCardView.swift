import SwiftUI

struct TransferHeaderCardView: View {
    let title: String
    let subtitle: String

    init(
        title: String = "Clean up your YouTube Watch Later",
        subtitle: String = "Move videos out of Watch Later and into a playlist built for what you actually want to watch next."
    ) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            YouTubeLogoMarkView()
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.title.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                Text(subtitle)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .layoutPriority(1)
        }
        .padding(.vertical, 8)
    }
}
