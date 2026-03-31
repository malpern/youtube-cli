import Foundation
import Observation

@MainActor
@Observable
final class AppPreferences {
    static let avoidDuplicateAdditionsKey = "avoid-duplicate-additions"
    static let backendModeKey = "backend-mode"
    static let developmentTransferLimitKey = "development-transfer-limit"
    static let playlistPollingEnabledKey = "playlist-polling-enabled"
    static let showBrowserWindowKey = "show-browser-window"
    static let resumableRunIDKey = "resumable-run-id"
    static let resumableDestinationNameKey = "resumable-destination-name"
    static let resumableDestinationIDKey = "resumable-destination-id"
    static let resumableSourceRunIDKey = "resumable-source-run-id"
    static let resumableStartIndexKey = "resumable-start-index"

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

    var showBrowserWindow: Bool {
        didSet {
            userDefaults.set(showBrowserWindow, forKey: Self.showBrowserWindowKey)
        }
    }

    var resumableRunID: String? {
        didSet {
            if let resumableRunID {
                userDefaults.set(resumableRunID, forKey: Self.resumableRunIDKey)
            } else {
                userDefaults.removeObject(forKey: Self.resumableRunIDKey)
            }
        }
    }

    var resumableDestinationName: String? {
        didSet {
            if let resumableDestinationName {
                userDefaults.set(resumableDestinationName, forKey: Self.resumableDestinationNameKey)
            } else {
                userDefaults.removeObject(forKey: Self.resumableDestinationNameKey)
            }
        }
    }

    var resumableDestinationID: String? {
        didSet {
            if let resumableDestinationID {
                userDefaults.set(resumableDestinationID, forKey: Self.resumableDestinationIDKey)
            } else {
                userDefaults.removeObject(forKey: Self.resumableDestinationIDKey)
            }
        }
    }

    var resumableSourceRunID: String? {
        didSet {
            if let resumableSourceRunID {
                userDefaults.set(resumableSourceRunID, forKey: Self.resumableSourceRunIDKey)
            } else {
                userDefaults.removeObject(forKey: Self.resumableSourceRunIDKey)
            }
        }
    }

    var resumableStartIndex: Int {
        didSet {
            userDefaults.set(resumableStartIndex, forKey: Self.resumableStartIndexKey)
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

        if userDefaults.object(forKey: Self.showBrowserWindowKey) == nil {
            self.showBrowserWindow = false
            userDefaults.set(false, forKey: Self.showBrowserWindowKey)
        } else {
            self.showBrowserWindow = userDefaults.bool(forKey: Self.showBrowserWindowKey)
        }

        self.resumableRunID = userDefaults.string(forKey: Self.resumableRunIDKey)
        self.resumableDestinationName = userDefaults.string(forKey: Self.resumableDestinationNameKey)
        self.resumableDestinationID = userDefaults.string(forKey: Self.resumableDestinationIDKey)
        self.resumableSourceRunID = userDefaults.string(forKey: Self.resumableSourceRunIDKey)
        self.resumableStartIndex = userDefaults.integer(forKey: Self.resumableStartIndexKey)
    }

    func clearResumableRun() {
        resumableRunID = nil
        resumableDestinationName = nil
        resumableDestinationID = nil
        resumableSourceRunID = nil
        resumableStartIndex = 1
    }

    func saveResumableRun(runID: String, destination: TransferDestination, sourceRunID: String?) {
        resumableRunID = runID
        resumableDestinationName = destination.displayName
        resumableSourceRunID = sourceRunID
        switch destination {
        case .existingPlaylist(let id, _):
            resumableDestinationID = id
        case .newPlaylist:
            resumableDestinationID = nil
        }
    }
}
