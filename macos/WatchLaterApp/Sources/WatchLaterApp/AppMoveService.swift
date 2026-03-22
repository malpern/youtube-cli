import Foundation

@MainActor
struct AppMoveService: MoveService {
    let preferences: AppPreferences
    let mockService: any MoveService
    let realService: any MoveService

    func runMove(to destination: TransferDestination, options: MoveExecutionOptions) -> AsyncThrowingStream<MoveEvent, Error> {
        switch preferences.backendMode {
        case .mock:
            mockService.runMove(to: destination, options: options)
        case .real:
            realService.runMove(to: destination, options: options)
        }
    }
}
