import SwiftUI

struct WatchLaterSummaryView: View {
    let summary: WatchLaterSummary

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "play.square.stack.fill")
                .font(.headline)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text("Watch Later")
                    .font(.headline)

                Text("\(summary.videoCount.formatted()) of \(summary.maxItems.formatted()) videos")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if summary.atCapacity {
                statusBadge("Full", color: .red)
            } else if summary.nearCapacity {
                statusBadge("Near Max", color: .orange)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Watch Later")
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        if summary.atCapacity {
            return "\(summary.videoCount.formatted()) of \(summary.maxItems.formatted()) videos. Full."
        }

        if summary.nearCapacity {
            return "\(summary.videoCount.formatted()) of \(summary.maxItems.formatted()) videos. Near max."
        }

        return "\(summary.videoCount.formatted()) of \(summary.maxItems.formatted()) videos."
    }

    private func statusBadge(_ title: String, color: Color) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
    }
}
