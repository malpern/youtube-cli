import AppKit
import Foundation

enum AutomationBrowserLauncher {
    static func openYouTube() throws {
        let config = try loadConfig()
        try open(configuration: config)
    }

    static func openLogin() throws {
        let config = try loadConfig()
        try open(configuration: config)
    }

    private static func open(configuration config: CLIBrowserConfig) throws {
        let launchPlan = try buildLaunchPlan(from: config)

        let process = Process()
        process.executableURL = launchPlan.executableURL
        process.arguments = launchPlan.arguments
        try process.run()
    }

    private static func loadConfig() throws -> CLIBrowserConfig {
        let configURL = CLIBackendPaths.repositoryRootURL.appending(path: "config.local.json")
        guard FileManager.default.fileExists(atPath: configURL.path(percentEncoded: false)) else {
            throw AutomationBrowserLauncherError(
                description: "Could not find config.local.json. Create it from config.example.json to open YouTube in the automation browser."
            )
        }

        let data = try Data(contentsOf: configURL)
        let decoder = JSONDecoder()
        return try decoder.decode(CLIBrowserConfig.self, from: data)
    }

    private static func buildLaunchPlan(from config: CLIBrowserConfig) throws -> BrowserLaunchPlan {
        let youtubeURL = URL(string: config.youtubeBaseURL ?? "https://www.youtube.com")!
        let executableURL = try resolveExecutableURL(from: config)
        let remoteDebuggingPort = parseRemoteDebuggingPort(from: config.browserCDPURL)
        let profileDir = config.profileDir ?? CLIBackendPaths.chromeProfileURL.path(percentEncoded: false)

        var arguments: [String] = [
            "--remote-debugging-port=\(remoteDebuggingPort)",
            "--user-data-dir=\(profileDir)"
        ]

        if let width = config.browserWindowWidth, let height = config.browserWindowHeight {
            arguments.append("--window-size=\(width),\(height)")
        }

        if let x = config.browserWindowPositionX, let y = config.browserWindowPositionY {
            arguments.append("--window-position=\(x),\(y)")
        }

        arguments.append("--new-window")
        arguments.append(youtubeURL.absoluteString)

        return BrowserLaunchPlan(executableURL: executableURL, arguments: arguments)
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

        throw AutomationBrowserLauncherError(
            description: "Could not determine the automation browser executable from config.local.json."
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
    let profileDir: String?
    let browserChannel: String?
    let browserExecutablePath: String?
    let browserCDPURL: String?
    let browserWindowWidth: Int?
    let browserWindowHeight: Int?
    let browserWindowPositionX: Int?
    let browserWindowPositionY: Int?
    let youtubeBaseURL: String?

    enum CodingKeys: String, CodingKey {
        case profileDir
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
    let arguments: [String]
}

private struct AutomationBrowserLauncherError: LocalizedError {
    let description: String

    var errorDescription: String? {
        description
    }
}
