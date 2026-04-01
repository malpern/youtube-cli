import SwiftUI

struct IconChromeButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        IconChromeButtonBody(configuration: configuration)
    }
}

private struct IconChromeButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var isHovering = false

    var body: some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(backgroundFill)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(borderColor, lineWidth: 1)
            }
            .animation(.easeOut(duration: 0.12), value: isHovering)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
            .onHover { isHovering = $0 }
    }

    private var backgroundFill: Color {
        let base = Color(nsColor: .controlBackgroundColor)
        if configuration.isPressed {
            return base.opacity(1)
        }

        return base.opacity(isHovering ? 0.98 : 0.94)
    }

    private var borderColor: Color {
        let base = Color(nsColor: .separatorColor)
        return base.opacity(isHovering ? 0.85 : 0.72)
    }
}

struct DisclosureCardButtonStyle: ButtonStyle {
    let isExpanded: Bool

    func makeBody(configuration: Configuration) -> some View {
        DisclosureCardButtonBody(configuration: configuration, isExpanded: isExpanded)
    }
}

private struct DisclosureCardButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let isExpanded: Bool
    @State private var isHovering = false

    var body: some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(backgroundFill)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(borderColor, lineWidth: 1)
            }
            .animation(.easeOut(duration: 0.14), value: isHovering)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
            .onHover { isHovering = $0 }
    }

    private var backgroundFill: Color {
        let base = Color(nsColor: .controlBackgroundColor)
        if configuration.isPressed {
            return base.opacity(0.99)
        }

        if isHovering {
            return base.opacity(0.97)
        }

        return base.opacity(isExpanded ? 0.95 : 0.92)
    }

    private var borderColor: Color {
        let base = Color(nsColor: .separatorColor)
        return base.opacity(isHovering || isExpanded ? 0.95 : 0.75)
    }
}

struct SelectableListRowButtonStyle: ButtonStyle {
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        SelectableListRowButtonBody(configuration: configuration, isSelected: isSelected)
    }
}

private struct SelectableListRowButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let isSelected: Bool
    @State private var isHovering = false

    var body: some View {
        configuration.label
            .background(rowBackground)
            .animation(.easeOut(duration: 0.12), value: isHovering)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
            .onHover { isHovering = $0 }
    }

    @ViewBuilder
    private var rowBackground: some View {
        if isSelected || isHovering {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(backgroundColor)
        } else {
            Color.clear
        }
    }

    private var backgroundColor: Color {
        if isSelected {
            return Color.accentColor.opacity(configuration.isPressed ? 0.28 : 0.22)
        }

        return Color.primary.opacity(configuration.isPressed ? 0.08 : 0.05)
    }
}
