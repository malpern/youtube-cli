import Foundation

@MainActor
protocol AuthService {
    func checkAuthentication() async throws -> AuthCheckResult
    func openLogin() async throws
    func restartBrowser() async throws
}
