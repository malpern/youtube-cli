import SwiftUI

struct PhaseProgressRowView: View {
    let snapshot: PhaseProgressSnapshot
    @Environment(\.accessibilityDifferentiateWithoutColor) private var accessibilityDifferentiateWithoutColor

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: 6) {
                if accessibilityDifferentiateWithoutColor {
                    Image(systemName: statusSymbol)
                        .foregroundStyle(tintColor)
                }

                Text(snapshot.phase.title)
                    .font(.body.weight(.medium))
            }
            .frame(width: 78, alignment: .leading)

            ProgressView(value: snapshot.fraction)
                .progressViewStyle(.linear)
                .tint(tintColor)

            VStack(alignment: .trailing, spacing: 2) {
                Text(snapshot.countLabel)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)

                if accessibilityDifferentiateWithoutColor {
                    Text(statusText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 78, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(snapshot.phase.title) progress")
        .accessibilityValue("\(snapshot.countLabel). \(statusText).")
    }

    private var tintColor: Color {
        switch snapshot.status {
        case .pending:
            return Color.gray
        case .running:
            return Color.accentColor
        case .completed:
            return Color.green
        }
    }

    private var statusText: String {
        switch snapshot.status {
        case .pending:
            return "Pending"
        case .running:
            return "Running"
        case .completed:
            return "Complete"
        }
    }

    private var statusSymbol: String {
        switch snapshot.status {
        case .pending:
            return "circle.dotted"
        case .running:
            return "arrow.trianglehead.2.clockwise.rotate.90"
        case .completed:
            return "checkmark.circle.fill"
        }
    }
}
