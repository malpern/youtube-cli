import Foundation

@MainActor
protocol MoveService {
    func runMove(to destination: TransferDestination, options: MoveExecutionOptions) -> AsyncThrowingStream<MoveEvent, Error>
}
