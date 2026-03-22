import SwiftUI

struct AboutView: View {
    private let githubURL = URL(string: "https://github.com/malpern/youtube-cli")!
    private let twitterURL = URL(string: "http://x.com/malpern")!

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            Text("Move videos out of Watch Later and into a playlist you can actually use.")
                .font(.title3)
                .foregroundStyle(.secondary)

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Text("Made by Micah Alpern")
                    .font(.headline)

                Text("You Watch Later is open source software released under the MIT License.")
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                Link(destination: githubURL) {
                    Label("GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                }
                .buttonStyle(.link)
                .pointingHandCursor()

                Link(destination: twitterURL) {
                    Label("@malpern on X", systemImage: "link")
                }
                .buttonStyle(.link)
                .pointingHandCursor()
            }

            Spacer(minLength: 0)
        }
        .padding(28)
        .frame(minWidth: 460, minHeight: 260, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack(spacing: 16) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: .black.opacity(0.16), radius: 10, y: 4)

            VStack(alignment: .leading, spacing: 6) {
                Text("You Watch Later")
                    .font(.system(size: 30, weight: .semibold))

                Text("A simple Mac app for cleaning up your YouTube Watch Later queue.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
