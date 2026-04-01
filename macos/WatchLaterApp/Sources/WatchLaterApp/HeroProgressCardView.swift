import SwiftUI

struct HeroProgressCardView: View {
    @Bindable var model: TransferViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: AppStyle.groupSpacing) {
            HStack(alignment: .top, spacing: 16) {
                ThumbnailPreviewView(model: model)
                HeroProgressPanelView(model: model)
            }

            if let errorMessage = model.errorMessage, !model.isShowingCompletedState {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .accessibilityLabel("Migration error")
                    .accessibilityValue(errorMessage)
            }

            HStack {
                Button("Done", action: model.acknowledgeCompletion)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(minWidth: AppStyle.footerButtonMinWidth)
                    .disabled(!model.canAcknowledgeCompletion)
                    .pointingHandCursor()
                    .accessibilityLabel("Done")
                    .accessibilityHint(model.canAcknowledgeCompletion ? "Closes the completed migration state and returns to idle." : "Available after the migration finishes successfully.")
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.top, AppStyle.footerTopPadding)
        }
    }
}
