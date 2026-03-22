import SwiftUI

struct DestinationCardView: View {
    @Bindable var model: TransferViewModel

    private var showsInlineNewPlaylistButton: Bool {
        model.availablePlaylists.contains(where: { !$0.isDraft })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppStyle.groupSpacing) {
            WatchLaterSummaryView(summary: model.watchLaterSummary)
            transferDestinationSection
            transferActionRow
        }
        .sheet(isPresented: $model.isShowingNewPlaylistSheet) {
            NewPlaylistSheetView(model: model)
        }
    }

    private var transferDestinationSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Transfer to")
                .font(.headline)

            transferDestinationCard
        }
    }

    private var transferDestinationCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            summaryRow
            lowerDisclosureSection
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipped()
    }

    private var summaryRow: some View {
        Button(action: toggleDestinationEditing) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: "play.square.stack.fill")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)

                VStack(alignment: .leading, spacing: 6) {
                    Text(model.selectedPlaylistTitle)
                        .font(.title3.weight(.semibold))

                    if model.isSelectedPlaylistDraft {
                        Text("New Playlist")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color(nsColor: .controlColor), in: Capsule())
                    }
                }

                Spacer()

                if model.isEditingDestination && model.isLoadingPlaylists {
                    ProgressView()
                        .controlSize(.small)
                }

                caretIcon
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(DisclosureCardButtonStyle(isExpanded: model.isEditingDestination))
        .focusable(false)
        .focusEffectDisabled()
        .disabled(model.isRunningTransfer)
        .pointingHandCursor()
        .accessibilityLabel("Transfer destination")
        .accessibilityHint(model.isEditingDestination ? "Collapses the playlist chooser." : "Expands the playlist chooser.")
    }

    private var newPlaylistButton: some View {
        Button(action: model.presentNewPlaylistSheet) {
            Image(systemName: "square.and.pencil")
                .font(.body.weight(.semibold))
                .frame(width: 18, height: 18)
                .padding(8)
        }
        .buttonStyle(IconChromeButtonStyle())
        .focusable(false)
        .focusEffectDisabled()
        .disabled(model.isLoadingPlaylists || model.isRunningTransfer)
        .pointingHandCursor()
        .accessibilityLabel("New Playlist")
        .accessibilityHint("Creates a new playlist and adds it to the top of the list.")
    }

    private var caretIcon: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(width: 20, height: 20)
            .rotationEffect(.degrees(model.isEditingDestination ? 180 : 0))
            .animation(.easeInOut(duration: 0.16), value: model.isEditingDestination)
    }

    private var transferActionRow: some View {
        HStack {
            Button("Transfer", action: model.beginTransfer)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(minWidth: AppStyle.footerButtonMinWidth)
                .keyboardShortcut(.defaultAction)
                .disabled(!model.canRunTransfer)
                .pointingHandCursor()
                .accessibilityLabel("Transfer")
                .accessibilityHint("Starts the mock migration using the selected destination.")
                .accessibilityInputLabels(["Transfer", "Start transfer", "Start migration"])
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.top, AppStyle.footerTopPadding)
    }

    private var lowerDisclosureSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
                .padding(.horizontal, 14)

            VStack(alignment: .leading, spacing: 12) {
                ExistingPlaylistPickerView(model: model)

                if showsInlineNewPlaylistButton {
                    HStack {
                        Spacer()
                        newPlaylistButton
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
            .padding(.top, 12)
        }
        .frame(
            maxWidth: .infinity,
            minHeight: 0,
            maxHeight: model.isEditingDestination ? AppStyle.destinationDisclosureHeight : 0,
            alignment: .top
        )
        .clipped()
        .opacity(model.isEditingDestination ? 1 : 0)
        .allowsHitTesting(model.isEditingDestination)
        .animation(.easeInOut(duration: 0.16), value: model.isEditingDestination)
    }

    private func toggleDestinationEditing() {
        withAnimation(.easeInOut(duration: 0.16)) {
            model.toggleDestinationEditing()
        }
    }
}
