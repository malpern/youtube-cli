import SwiftUI

struct PlaylistSelectionRowView: View {
    let playlist: PlaylistSummary
    let isSelected: Bool
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            HStack(spacing: 12) {
                Image(systemName: leadingSymbol)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 27)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(playlist.title)
                            .font(.body.weight(.medium))

                        if playlist.isPrivate {
                            Image(systemName: "person.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                    }

                    HStack(spacing: 6) {
                        Text(playlist.countLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        visibilityView
                    }
                }
            }
            .contentShape(Rectangle())
            .padding(.vertical, 6)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(SelectableListRowButtonStyle(isSelected: isSelected))
        .listRowBackground(Color.clear)
        .pointingHandCursor()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(playlist.title)
        .accessibilityValue("\(playlist.visibility), \(playlist.countLabel)")
        .accessibilityHint("Selects this playlist as the transfer destination.")
    }

    private var leadingSymbol: String {
        return "play.square.stack"
    }

    @ViewBuilder
    private var visibilityView: some View {
        if playlist.visibility == "Unlisted" {
            Image(systemName: "eye.slash")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Unlisted")
        }
    }
}
