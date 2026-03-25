import Foundation

struct MoveExecutionOptions: Equatable {
    var avoidDuplicateAdditions: Bool
    var resumeRunID: String?
}
