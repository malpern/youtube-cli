import Foundation

enum CLIAppContract {
    static let supportedVersion = 1

    static func validate(_ payload: some CLIAppContractPayload, surface: CLIAppContractSurface) throws {
        guard payload.appContractVersion == supportedVersion else {
            throw CLIProcessError(
                description: "Unsupported CLI app contract version \(payload.appContractVersion) for \(surface.rawValue). Expected \(supportedVersion)."
            )
        }

        guard payload.appContractSurface == surface.rawValue else {
            throw CLIProcessError(
                description: "Unexpected CLI app contract surface '\(payload.appContractSurface)' while decoding \(surface.rawValue)."
            )
        }
    }
}

enum CLIAppContractSurface: String {
    case doctor
    case playlists
    case move
}

protocol CLIAppContractPayload: Decodable {
    var appContractVersion: Int { get }
    var appContractSurface: String { get }
}
