import SwiftUI

struct AuthenticationGateView: View {
    @Bindable var model: TransferViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: AppStyle.groupSpacing) {
            Text("Connect YouTube")
                .font(.headline)

            VStack(alignment: .leading, spacing: 18) {
                Text(model.authGateTitle)
                    .font(.title3.weight(.semibold))

                Text(model.authGateDetail)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 10) {
                    Button(action: model.openYouTubeLogin) {
                        HStack(spacing: 12) {
                            YouTubeLogoMarkView()
                                .frame(width: 34, height: 24)

                            VStack(alignment: .leading, spacing: 1) {
                                Text("Sign in to YouTube")
                                    .font(.headline)
                                    .foregroundStyle(Color.black.opacity(0.92))

                                Text("Open Google Chrome and use the dedicated profile")
                                    .font(.caption)
                                    .foregroundStyle(Color.black.opacity(0.62))
                            }

                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color.white)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isCheckingAuthentication)
                    .pointingHandCursor()

                    Button("I've signed in. Check again") {
                        Task {
                            await model.refreshAuthenticationStatus(announce: true)
                        }
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .disabled(model.isCheckingAuthentication)
                    .pointingHandCursor()
                }

                if model.isCheckingAuthentication {
                    HStack(spacing: 10) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Checking YouTube sign-in…")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
            }
        }
    }
}
