import Foundation

struct AuthCheckResult: Equatable {
    let isAuthenticated: Bool
    let title: String
    let detail: String
    let accountLabel: String?
}
