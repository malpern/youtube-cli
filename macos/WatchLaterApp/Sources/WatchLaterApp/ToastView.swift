import SwiftUI

struct ToastView: View {
    let toast: Toast
    let dismiss: () -> Void

    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.style.symbolName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(symbolColor)

            Text(toast.message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 18, height: 18)
                    .background(.quaternary.opacity(isHovering ? 0.6 : 0.3), in: Circle())
            }
            .buttonStyle(.plain)
            .onHover { isHovering = $0 }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(backgroundMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.12), radius: 8, x: 0, y: 4)
        .shadow(color: .black.opacity(0.04), radius: 1, x: 0, y: 1)
    }

    private var backgroundMaterial: some ShapeStyle {
        .ultraThinMaterial
    }

    private var symbolColor: Color {
        switch toast.style {
        case .info: .green
        case .warning: .orange
        case .error: .red
        }
    }

    private var borderColor: Color {
        Color(nsColor: .separatorColor).opacity(0.5)
    }
}

struct ToastOverlayModifier: ViewModifier {
    @Binding var currentToast: Toast?

    @State private var dismissTask: Task<Void, Never>?
    @State private var isVisible = false

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast = currentToast, isVisible {
                    ToastView(toast: toast, dismiss: dismissCurrent)
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .zIndex(1000)
                }
            }
            .onChange(of: currentToast) { _, newToast in
                dismissTask?.cancel()

                if let toast = newToast {
                    withAnimation(.spring(duration: 0.35, bounce: 0.15)) {
                        isVisible = true
                    }
                    dismissTask = Task {
                        try? await Task.sleep(for: .seconds(toast.duration))
                        guard !Task.isCancelled else { return }
                        dismissCurrent()
                    }
                }
            }
    }

    private func dismissCurrent() {
        dismissTask?.cancel()
        withAnimation(.easeOut(duration: 0.25)) {
            isVisible = false
        }
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            currentToast = nil
        }
    }
}

extension View {
    func toastOverlay(toast: Binding<Toast?>) -> some View {
        modifier(ToastOverlayModifier(currentToast: toast))
    }
}
