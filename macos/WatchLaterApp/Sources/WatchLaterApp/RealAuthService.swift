import Foundation

@MainActor
struct RealAuthService: AuthService {
    func checkAuthentication() async throws -> AuthCheckResult {
        let result = try await CLIProcessRunner.run(arguments: CLIBackendPaths.commonCLIArguments + ["doctor", "--json"])
        let payload = try JSONDecoder().decode(DoctorResponse.self, from: result.stdout)
        return buildResult(from: payload)
    }

    func openLogin() async throws {
        try FileManager.default.createDirectory(at: CLIBackendPaths.chromeProfileURL, withIntermediateDirectories: true)
        try AutomationBrowserLauncher.openLogin()
    }

    private func buildResult(from response: DoctorResponse) -> AuthCheckResult {
        let browserLaunch = response.checks.first(where: { $0.name == "browser.launch" })
        let youtubeAuth = response.checks.first(where: { $0.name == "youtube.auth" })
        let browserConfig = response.checks.first(where: { $0.name == "browser.config" })

        if browserConfig?.ok == false {
            return AuthCheckResult(
                isAuthenticated: false,
                title: "Browser not configured",
                detail: browserConfig?.message ?? "The backend browser connection is not configured.",
                accountLabel: nil
            )
        }

        if browserLaunch?.ok == false {
            return AuthCheckResult(
                isAuthenticated: false,
                title: "Chrome not connected",
                detail: browserLaunch?.message ?? "The app could not attach to the dedicated Chrome session.",
                accountLabel: nil
            )
        }

        if youtubeAuth?.ok == false {
            return AuthCheckResult(
                isAuthenticated: false,
                title: "Sign in to YouTube",
                detail: youtubeAuth?.message ?? "You are not signed in to YouTube in the dedicated Chrome profile.",
                accountLabel: youtubeAuth?.details?.accountLabel
            )
        }

        return AuthCheckResult(
            isAuthenticated: true,
            title: "Signed in to YouTube",
            detail: youtubeAuth?.message ?? "The backend can access your YouTube account.",
            accountLabel: youtubeAuth?.details?.accountLabel
        )
    }
}

private struct DoctorResponse: Decodable {
    let ok: Bool
    let checks: [DoctorCheckPayload]
}

private struct DoctorCheckPayload: Decodable {
    let name: String
    let ok: Bool
    let message: String
    let details: DoctorCheckDetails?
}

private struct DoctorCheckDetails: Decodable {
    let accountLabel: String?
}
