import AppKit

enum MainWindowSizing {
    static let width: CGFloat = 492
    static let collapsedSetupHeight: CGFloat = 382
    static let resumeBannerSetupHeight: CGFloat = 510
    static let expandedSetupHeight: CGFloat = 688
    static let progressHeight: CGFloat = 390

    @MainActor
    static func resizeMainWindow(height: CGFloat, animated: Bool = true) {
        guard let window = NSApp.windows.first(where: { !$0.title.contains("About") }) else {
            return
        }

        let targetContentSize = NSSize(width: width, height: height)
        let targetFrame = window.frameRect(forContentRect: NSRect(origin: .zero, size: targetContentSize))

        var newFrame = window.frame
        newFrame.origin.y += newFrame.height - targetFrame.height
        newFrame.size.width = targetFrame.width
        newFrame.size.height = targetFrame.height

        if animated {
            window.animator().setFrame(newFrame, display: true)
        } else {
            window.setFrame(newFrame, display: true)
        }
    }
}
