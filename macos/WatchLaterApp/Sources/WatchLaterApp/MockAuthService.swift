import Foundation

struct MockAuthService: AuthService {
    func checkAuthentication() async throws -> AuthCheckResult {
        AuthCheckResult(
            isAuthenticated: true,
            title: "Mock backend ready",
            detail: "Mock mode does not require YouTube authentication.",
            accountLabel: "Mock User"
        )
    }

    func openLogin() async throws {}
    func restartBrowser() async throws {}
}
