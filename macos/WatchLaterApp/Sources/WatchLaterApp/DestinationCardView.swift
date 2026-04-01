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
            if model.hasResumableRun {
                resumeBanner
            }
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

    private var resumeBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.clockwise.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.orange)

                Text("Previous Transfer Interrupted")
                    .font(.subheadline.weight(.semibold))
            }

            if let description = model.resumableRunDescription {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 10) {
                Toggle("Resume where it left off", isOn: $model.resumeEnabled)
                    .toggleStyle(.checkbox)
                    .font(.subheadline)
                    .accessibilityLabel("Resume previous transfer")
                    .accessibilityHint("When enabled, continues the interrupted transfer instead of starting over.")

                Spacer()

                Button("Discard") {
                    model.clearResumableRun()
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Discard previous transfer")
                .accessibilityHint("Removes the interrupted transfer record and starts fresh.")
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.orange.opacity(0.08))
        )
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.orange.opacity(0.25), lineWidth: 1)
        }
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
