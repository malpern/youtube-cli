import SwiftUI

struct ThumbnailPlaceholderContentView: View {
    @Bindable var model: TransferViewModel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: placeholderSymbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(iconTint)

            Text(placeholderTitle)
                .font(.subheadline.weight(.semibold))

            Text(placeholderSubtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(.primary)
    }

    private var iconTint: some ShapeStyle {
        if model.latestResult?.ok == true {
            return AnyShapeStyle(.green)
        }

        return AnyShapeStyle(.primary)
    }

    private var placeholderSymbol: String {
        if model.latestResult?.ok == true {
            return "checkmark.circle.fill"
        }

        return switch model.currentPhase {
        case .verify:
            "checkmark.seal"
        case .setup, .inventory:
            "arrow.trianglehead.2.clockwise.rotate.90"
        case .delete:
            "trash"
        case .copy, .none:
            "play.square.stack"
        }
    }

    private var placeholderTitle: String {
        if model.latestResult?.ok == true {
            return "complete"
        }

        return switch model.currentPhase {
        case .verify:
            "verifying"
        case .setup:
            "preparing"
        case .inventory:
            "scanning"
        case .delete:
            "removing"
        case .copy:
            "copying"
        case .none:
            model.latestResult?.ok == true ? "complete" : "ready"
        }
    }

    private var placeholderSubtitle: String {
        if model.latestResult?.ok == true {
            return "saved to \(model.destinationSummary)"
        }

        switch model.currentPhase {
        case .copy:
            return progressCountText(for: model.copyProgress, unit: "videos")
        case .verify:
            return progressCountText(for: model.verifyProgress, unit: "videos")
        case .delete:
            return progressCountText(for: model.deleteProgress, unit: "videos")
        case .setup, .inventory, .none:
            return model.heroMessage
        }
    }

    private func progressCountText(for snapshot: PhaseProgressSnapshot, unit: String) -> String {
        guard snapshot.total > 0 else {
            return model.heroMessage
        }

        return "\(snapshot.completed) of \(snapshot.total) \(unit)"
    }
}
