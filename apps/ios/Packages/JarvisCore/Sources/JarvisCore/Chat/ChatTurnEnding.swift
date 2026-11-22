import Foundation

/// How a chat turn is judged when it ends in an error, from what the client actually saw. A turn is only a failure when it really
/// failed: Dan stopping a reply is a stop, and a turn cancelled on this device (the app went to the background, or the screen
/// closed) is not a failure either, whatever error the dying connection reports on its way out.
public enum ChatTurnEnding: Equatable, Sendable {
    case stopped
    case failed

    public static func after(error: any Error, stoppedByUser: Bool, taskCancelled: Bool) -> ChatTurnEnding {
        if stoppedByUser || taskCancelled || error is CancellationError { return .stopped }
        return .failed
    }
}
