import Foundation

@MainActor
struct AppAuthService: AuthService {
    let preferences: AppPreferences
    let mockService: any AuthService
    let realService: any AuthService

    func checkAuthentication() async throws -> AuthCheckResult {
        switch preferences.backendMode {
        case .mock:
            try await mockService.checkAuthentication()
        case .real:
            try await realService.checkAuthentication()
        }
    }

    func openLogin() async throws {
        switch preferences.backendMode {
        case .mock:
            try await mockService.openLogin()
        case .real:
            try await realService.openLogin()
        }
    }

    func restartBrowser() async throws {
        switch preferences.backendMode {
        case .mock:
            try await mockService.restartBrowser()
        case .real:
            try await realService.restartBrowser()
        }
    }
}
