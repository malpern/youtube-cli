import SwiftUI
import AppKit

struct TransferView: View {
    @Bindable var model: TransferViewModel

    private var minimumHeight: CGFloat {
        preferredWindowHeight
    }

    private var preferredWindowHeight: CGFloat {
        if model.shouldShowProgressCard {
            return MainWindowSizing.progressHeight
        }

        return model.isEditingDestination ? MainWindowSizing.expandedSetupHeight : MainWindowSizing.collapsedSetupHeight
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppStyle.sectionSpacing) {
            content
        }
        .padding(.horizontal, AppStyle.windowPadding)
        .padding(.bottom, AppStyle.windowPadding)
        .padding(.top, AppStyle.windowPadding + 8)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .frame(
            minWidth: 456,
            minHeight: minimumHeight,
            alignment: .topLeading
        )
        .background(AppColors.mainSurfaceColor)
        .task {
            await model.loadPlaylistsIfNeeded()
        }
        .task {
            await model.runPlaylistPolling()
        }
        .onAppear {
            MainWindowSizing.resizeMainWindow(height: preferredWindowHeight, animated: false)
        }
        .onChange(of: model.isEditingDestination) { _, _ in
            MainWindowSizing.resizeMainWindow(height: preferredWindowHeight, animated: false)
        }
        .onChange(of: model.shouldShowProgressCard) { _, _ in
            MainWindowSizing.resizeMainWindow(height: preferredWindowHeight)
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.shouldShowProgressCard {
            TransferHeaderCardView(
                title: "Moving your Watch Later videos",
                subtitle: "Transferring to \(model.destinationSummary)"
            )
            HeroProgressCardView(model: model)
        } else {
            TransferHeaderCardView()
            if model.requiresAuthenticationGate {
                AuthenticationGateView(model: model)
            } else {
                DestinationCardView(model: model)
            }
        }
    }
}
