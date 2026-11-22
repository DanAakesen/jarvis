import Foundation

/// How a stream ended when this device did not receive a saved reply.
public enum ChatTurnEnding: Equatable, Sendable {
    case detached
    case stopped
    case failed
    case unconfirmed

    public static func after(error: any Error, taskCancelled: Bool, accepted: Bool) -> ChatTurnEnding {
        if taskCancelled || error is CancellationError { return .detached }
        if let failure = (error as? JarvisChatClientError)?.serverFailure {
            return failure.code == "stopped" ? .stopped : .failed
        }
        return accepted ? .unconfirmed : .failed
    }
}
