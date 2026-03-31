import SwiftUI

struct HeroProgressPanelView: View {
    @Bindable var model: TransferViewModel
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @State private var isHoveringDisclosure = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.isShowingCompletedState {
                completedSummary
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                progressDisclosure
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Migration progress")
                    .accessibilityValue(model.accessibilityProgressSummary)
                    .accessibilityHint(model.isProgressExpanded ? "Hides progress details." : "Shows progress details.")
                    .accessibilityInputLabels(["Migration progress", "Progress details", "Workflow progress"])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(accessibilityReduceMotion ? .easeOut(duration: 0.12) : .easeInOut(duration: 0.16), value: model.isProgressExpanded)
    }

    private var progressDisclosure: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: toggleExpansion) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .center, spacing: 12) {
                        ExpandTriangleControl(
                            isExpanded: model.isProgressExpanded,
                            isHighlighted: isHoveringDisclosure
                        )

                        PhasedProgressBarView(
                            progress: model.overallProgress,
                            markers: model.overallPhaseMarkerPositions
                        )
                    }

                    ThumbnailPlaceholderContentView(model: model)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(disclosureBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
            .onHover { isHovering in
                isHoveringDisclosure = isHovering
            }

            if model.isProgressExpanded {
                Divider()
                PhaseProgressListView(model: model)
                    .transition(.opacity)
                    .padding(.top, 2)
            }
        }
    }

    private func toggleExpansion() {
        model.isProgressExpanded.toggle()
    }

    private var disclosureBackground: some ShapeStyle {
        if isHoveringDisclosure {
            return AnyShapeStyle(.quaternary.opacity(0.32))
        }

        return AnyShapeStyle(.clear)
    }

    private var completedSummary: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.green)

                Text(model.completedSummaryText)
                    .font(.title3)
            }

            if let completedErrorText = model.completedErrorText {
                Label(completedErrorText, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ExpandTriangleControl: View {
    let isExpanded: Bool
    let isHighlighted: Bool

    var body: some View {
        Image(systemName: "play.fill")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(triangleFill)
            .rotationEffect(.degrees(isExpanded ? 90 : 0))
            .shadow(color: .black.opacity(isHighlighted ? 0.16 : 0.1), radius: 1.2, x: 0, y: 0.5)
            .padding(6)
            .background(backgroundFill, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }

    private var triangleFill: some ShapeStyle {
        LinearGradient(
            colors: [
                Color(nsColor: .controlTextColor).opacity(0.96),
                Color(nsColor: .secondaryLabelColor).opacity(0.92)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var backgroundFill: some ShapeStyle {
        if isHighlighted {
            return AnyShapeStyle(.quaternary.opacity(0.24))
        }

        return AnyShapeStyle(.quaternary.opacity(0.14))
    }
}
