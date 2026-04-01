import Foundation

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let style: Style
    let duration: TimeInterval

    enum Style: Equatable {
        case info
        case warning
        case error

        var symbolName: String {
            switch self {
            case .info: "checkmark.circle.fill"
            case .warning: "exclamationmark.triangle.fill"
            case .error: "xmark.octagon.fill"
            }
        }

        var tintColorName: String {
            switch self {
            case .info: "toast.info"
            case .warning: "toast.warning"
            case .error: "toast.error"
            }
        }
    }

    static func info(_ message: String, duration: TimeInterval = 3) -> Toast {
        Toast(message: message, style: .info, duration: duration)
    }

    static func warning(_ message: String, duration: TimeInterval = 5) -> Toast {
        Toast(message: message, style: .warning, duration: duration)
    }

    static func error(_ message: String, duration: TimeInterval = 6) -> Toast {
        Toast(message: message, style: .error, duration: duration)
    }
}
