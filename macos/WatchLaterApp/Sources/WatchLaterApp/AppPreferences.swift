import Foundation
import Observation

@MainActor
@Observable
final class AppPreferences {
    static let avoidDuplicateAdditionsKey = "avoid-duplicate-additions"
    static let backendModeKey = "backend-mode"
    static let developmentTransferLimitKey = "development-transfer-limit"
    static let playlistPollingEnabledKey = "playlist-polling-enabled"

    var avoidDuplicateAdditionsToPlaylists: Bool {
        didSet {
            userDefaults.set(avoidDuplicateAdditionsToPlaylists, forKey: Self.avoidDuplicateAdditionsKey)
        }
    }

    var backendMode: BackendMode {
        didSet {
            userDefaults.set(backendMode.rawValue, forKey: Self.backendModeKey)
        }
    }

    var developmentTransferLimit: DevelopmentTransferLimit {
        didSet {
            userDefaults.set(developmentTransferLimit.rawValue, forKey: Self.developmentTransferLimitKey)
        }
    }

    var playlistPollingEnabled: Bool {
        didSet {
            userDefaults.set(playlistPollingEnabled, forKey: Self.playlistPollingEnabledKey)
        }
    }

    @ObservationIgnored private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults

        if userDefaults.object(forKey: Self.avoidDuplicateAdditionsKey) == nil {
            self.avoidDuplicateAdditionsToPlaylists = true
            userDefaults.set(true, forKey: Self.avoidDuplicateAdditionsKey)
        } else {
            self.avoidDuplicateAdditionsToPlaylists = userDefaults.bool(forKey: Self.avoidDuplicateAdditionsKey)
        }

        if let rawMode = userDefaults.string(forKey: Self.backendModeKey),
           let backendMode = BackendMode(rawValue: rawMode) {
            self.backendMode = backendMode
        } else {
            self.backendMode = .mock
            userDefaults.set(BackendMode.mock.rawValue, forKey: Self.backendModeKey)
        }

        if let rawLimit = userDefaults.string(forKey: Self.developmentTransferLimitKey),
           let developmentTransferLimit = DevelopmentTransferLimit(rawValue: rawLimit) {
            self.developmentTransferLimit = developmentTransferLimit
        } else {
            self.developmentTransferLimit = .five
            userDefaults.set(DevelopmentTransferLimit.five.rawValue, forKey: Self.developmentTransferLimitKey)
        }

        if userDefaults.object(forKey: Self.playlistPollingEnabledKey) == nil {
            self.playlistPollingEnabled = false
            userDefaults.set(false, forKey: Self.playlistPollingEnabledKey)
        } else {
            self.playlistPollingEnabled = userDefaults.bool(forKey: Self.playlistPollingEnabledKey)
        }
    }
}
