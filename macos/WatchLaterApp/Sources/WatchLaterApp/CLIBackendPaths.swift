import Foundation

enum CLIBackendPaths {
    static let repositoryRootURL: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 {
            url.deleteLastPathComponent()
        }
        return url
    }()

    static let tsxURL = repositoryRootURL.appending(path: "node_modules/.bin/tsx")
    static let cliURL = repositoryRootURL.appending(path: "src/cli.ts")
    static let youtubeURL = URL(string: "https://www.youtube.com")!
    static let browserCDPURL = "http://127.0.0.1:9222"
    static let remoteDebuggingPort = 9222
    static let chromeProfileURL = repositoryRootURL.appending(path: ".local/canary-youtube-profile")

    static var commonCLIArguments: [String] {
        ["--browser-cdp-url", browserCDPURL]
    }
}
