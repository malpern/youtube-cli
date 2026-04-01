import Foundation

struct MoveExecutionOptions: Equatable {
    var avoidDuplicateAdditions: Bool
    var resumeRunID: String?
    var sourceRunID: String?
    var confirmDelete: Bool = false
    var chunkSize: Int = 50
    var startIndex: Int = 1

    var useChunkedMove: Bool = true
}
