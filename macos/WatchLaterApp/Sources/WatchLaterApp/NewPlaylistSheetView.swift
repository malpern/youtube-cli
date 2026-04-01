import SwiftUI

struct NewPlaylistSheetView: View {
    @Bindable var model: TransferViewModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isNameFieldFocused: Bool

    private var isAddDisabled: Bool {
        model.newPlaylistDraftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            nameField
            actions
        }
        .padding(24)
        .frame(width: 420)
        .onAppear {
            isNameFieldFocused = true
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "play.square.stack.fill")
                .font(.title2)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text("New Playlist")
                    .font(.title3.weight(.semibold))

                Text("Create a playlist for videos you want to move out of Watch Later.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var nameField: some View {
        TextField("Old Watch", text: $model.newPlaylistDraftName)
            .textFieldStyle(.roundedBorder)
            .font(.title2)
            .focused($isNameFieldFocused)
            .onSubmit(confirm)
    }

    private var actions: some View {
        HStack {
            Spacer()

            Button("Cancel", role: .cancel) {
                model.dismissNewPlaylistSheet()
                dismiss()
            }
            .pointingHandCursor()

            Button("Add Playlist", action: confirm)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .pointingHandCursor()
                .disabled(isAddDisabled)
        }
    }

    private func confirm() {
        model.confirmNewPlaylist()
        if !model.isShowingNewPlaylistSheet {
            dismiss()
        }
    }
}
