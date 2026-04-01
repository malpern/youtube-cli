import AppKit
import Foundation

enum AutomationBrowserLauncher {
    static func openYouTube(showWindow: Bool = true) throws {
        let config = loadConfig()
        try open(configuration: config, showWindow: showWindow)
    }

    static func openLogin(showWindow: Bool = true) throws {
        let config = loadConfig()
        try open(configuration: config, showWindow: showWindow)
    }

    private static func open(configuration config: CLIBrowserConfig, showWindow: Bool) throws {
        let launchPlan = try buildLaunchPlan(from: config, showWindow: showWindow)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [
            "-a", launchPlan.appBundlePath,
            launchPlan.openURL.absoluteString,
            "--args"
        ] + launchPlan.arguments
        try process.run()
    }

    private static func loadConfig() -> CLIBrowserConfig {
        let configURL = CLIBackendPaths.repositoryRootURL.appending(path: "config.local.json")
        if FileManager.default.fileExists(atPath: configURL.path(percentEncoded: false)),
           let data = try? Data(contentsOf: configURL),
           let config = try? JSONDecoder().decode(CLIBrowserConfig.self, from: data) {
            return config
        }

        return CLIBrowserConfig()
    }

    private static func isCdpPortListening(_ port: Int) -> Bool {
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = UInt16(port).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }

        let result = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.connect(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }

    private static func buildLaunchPlan(from config: CLIBrowserConfig, showWindow: Bool) throws -> BrowserLaunchPlan {
        let youtubeURL = URL(string: config.youtubeBaseURL ?? "https://www.youtube.com")!
        let executableURL = try resolveExecutableURL(from: config)
        let remoteDebuggingPort = parseRemoteDebuggingPort(from: config.browserCDPURL)
        let profileDir = config.profileDir ?? CLIBackendPaths.chromeProfileURL.path(percentEncoded: false)
        let browserAlreadyRunning = isCdpPortListening(remoteDebuggingPort)

        var arguments: [String] = [
            "--remote-debugging-port=\(remoteDebuggingPort)",
            "--user-data-dir=\(profileDir)"
        ]

        if let profileDirectory = config.profileDirectory {
            arguments.append("--profile-directory=\(profileDirectory)")
        }

        let hasExplicitSize = config.browserWindowWidth != nil && config.browserWindowHeight != nil
        let hasExplicitPosition = config.browserWindowPositionX != nil && config.browserWindowPositionY != nil

        if hasExplicitSize {
            arguments.append("--window-size=\(config.browserWindowWidth!),\(config.browserWindowHeight!)")
        } else if !showWindow {
            arguments.append("--window-size=800,600")
        }

        if hasExplicitPosition {
            arguments.append("--window-position=\(config.browserWindowPositionX!),\(config.browserWindowPositionY!)")
        } else if !showWindow {
            arguments.append("--window-position=-32000,-32000")
        }

        if !browserAlreadyRunning {
            arguments.append("--new-window")
        }

        let appBundlePath = executableURL
            .deletingLastPathComponent() // MacOS
            .deletingLastPathComponent() // Contents
            .deletingLastPathComponent() // .app
            .path(percentEncoded: false)

        return BrowserLaunchPlan(executableURL: executableURL, appBundlePath: appBundlePath, arguments: arguments, openURL: youtubeURL)
    }

    private static func resolveExecutableURL(from config: CLIBrowserConfig) throws -> URL {
        if let browserExecutablePath = config.browserExecutablePath,
           FileManager.default.isExecutableFile(atPath: browserExecutablePath) {
            return URL(fileURLWithPath: browserExecutablePath)
        }

        if let browserChannel = config.browserChannel,
           let channelExecutablePath = executablePath(for: browserChannel),
           FileManager.default.isExecutableFile(atPath: channelExecutablePath) {
            return URL(fileURLWithPath: channelExecutablePath)
        }

        // Fall back to the first installed Chrome variant
        for channel in ["chrome", "chrome-canary", "chrome-beta", "chrome-dev"] {
            if let path = executablePath(for: channel),
               FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }

        throw AutomationBrowserLauncherError(
            description: "Google Chrome is not installed. Install Chrome and try again."
        )
    }

    private static func executablePath(for browserChannel: String) -> String? {
        switch browserChannel {
        case "chrome":
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        case "chrome-beta":
            "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
        case "chrome-dev":
            "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"
        case "chrome-canary":
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
        default:
            nil
        }
    }

    private static func parseRemoteDebuggingPort(from browserCDPURL: String?) -> Int {
        guard let browserCDPURL, let url = URL(string: browserCDPURL) else {
            return CLIBackendPaths.remoteDebuggingPort
        }

        return url.port ?? CLIBackendPaths.remoteDebuggingPort
    }
}

private struct CLIBrowserConfig: Decodable {
    var profileDir: String?
    var profileDirectory: String?
    var browserChannel: String?
    var browserExecutablePath: String?
    var browserCDPURL: String?
    var browserWindowWidth: Int?
    var browserWindowHeight: Int?
    var browserWindowPositionX: Int?
    var browserWindowPositionY: Int?
    var youtubeBaseURL: String?

    init(
        profileDir: String? = nil,
        profileDirectory: String? = nil,
        browserChannel: String? = nil,
        browserExecutablePath: String? = nil,
        browserCDPURL: String? = nil,
        browserWindowWidth: Int? = nil,
        browserWindowHeight: Int? = nil,
        browserWindowPositionX: Int? = nil,
        browserWindowPositionY: Int? = nil,
        youtubeBaseURL: String? = nil
    ) {
        self.profileDir = profileDir
        self.profileDirectory = profileDirectory
        self.browserChannel = browserChannel
        self.browserExecutablePath = browserExecutablePath
        self.browserCDPURL = browserCDPURL
        self.browserWindowWidth = browserWindowWidth
        self.browserWindowHeight = browserWindowHeight
        self.browserWindowPositionX = browserWindowPositionX
        self.browserWindowPositionY = browserWindowPositionY
        self.youtubeBaseURL = youtubeBaseURL
    }

    enum CodingKeys: String, CodingKey {
        case profileDir
        case profileDirectory
        case browserChannel
        case browserExecutablePath
        case browserCDPURL = "browserCdpUrl"
        case browserWindowWidth
        case browserWindowHeight
        case browserWindowPositionX
        case browserWindowPositionY
        case youtubeBaseURL = "youtubeBaseUrl"
    }
}

private struct BrowserLaunchPlan {
    let executableURL: URL
    let appBundlePath: String
    let arguments: [String]
    let openURL: URL
}

private struct AutomationBrowserLauncherError: LocalizedError {
    let description: String

    var errorDescription: String? {
        description
    }
}
