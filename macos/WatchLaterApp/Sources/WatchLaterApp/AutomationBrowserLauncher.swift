import AppKit
import Foundation

enum AutomationBrowserLauncher {
    static func openYouTube() throws {
        let config = try loadConfig()
        let youtubeURL = URL(string: config.youtubeBaseURL ?? "https://www.youtube.com")!
        let executableURL = try resolveExecutableURL(from: config)

        let process = Process()
        process.executableURL = executableURL

        var arguments: [String] = []
        if let profileDir = config.profileDir, !profileDir.isEmpty {
            arguments.append("--user-data-dir=\(profileDir)")
        }
        arguments.append(youtubeURL.absoluteString)

        process.arguments = arguments
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
}

private struct CLIBrowserConfig: Decodable {
    let profileDir: String?
    let browserChannel: String?
    let browserExecutablePath: String?
    let youtubeBaseURL: String?

    enum CodingKeys: String, CodingKey {
        case profileDir
        case browserChannel
        case browserExecutablePath
        case youtubeBaseURL = "youtubeBaseUrl"
    }
}

private struct AutomationBrowserLauncherError: LocalizedError {
    let description: String

    var errorDescription: String? {
        description
    }
}
