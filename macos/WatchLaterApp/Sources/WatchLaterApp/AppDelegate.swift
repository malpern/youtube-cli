import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowDidBecomeMain(_:)),
            name: NSWindow.didBecomeMainNotification,
            object: nil
        )

        DispatchQueue.main.async { [weak self] in
            self?.applyPreferredSizeToMainWindow()
        }
    }

    @objc
    private func windowDidBecomeMain(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else {
            return
        }

        applyPreferredSize(to: window)
    }

    private func applyPreferredSizeToMainWindow() {
        guard let window = NSApp.windows.first(where: { isMainTransferWindow($0) }) else {
            return
        }

        applyPreferredSize(to: window)
    }

    private func applyPreferredSize(to window: NSWindow) {
        guard isMainTransferWindow(window) else {
            return
        }

        window.backgroundColor = AppColors.mainSurface

        let desiredContentSize = NSSize(
            width: MainWindowSizing.width,
            height: MainWindowSizing.collapsedSetupHeight
        )
        if window.contentLayoutRect.size != desiredContentSize {
            window.setContentSize(desiredContentSize)
            window.center()
        }
    }

    private func isMainTransferWindow(_ window: NSWindow) -> Bool {
        window.title == "You Watch Later"
    }
}
