import Foundation

/// Bounds for voice startup and for short WatchConnectivity gaps during a live session.
public enum WatchVoiceRecovery {
    /// How long the Watch waits for the iPhone to become reachable again before it ends a live session.
    public static let reconnectGraceSeconds: TimeInterval = 10
    /// The Watch notices a gap after 3 s and then waits `reconnectGraceSeconds`; the phone waits longer so it
    /// never ends a session the Watch is about to recover.
    public static let phoneGraceSeconds: TimeInterval = 15
    public static let startAttempts = 3
    /// Only a quick failure is retried: a slow one has already used most of the start budget.
    public static let startRetryWindowSeconds: TimeInterval = 12
    public static let startRetryDelay: Duration = .milliseconds(750)

    /// Retrying a start request is safe because the phone answers a repeated request ID from its reply cache
    /// or reports it as busy while the first copy is still running; it never opens a second session.
    public static func shouldRetryStart(_ failure: Error, attempt: Int, elapsed: TimeInterval) -> Bool {
        guard let failure = failure as? WatchFailure, failure == .unavailable || failure == .busy else { return false }
        return attempt < startAttempts && elapsed < startRetryWindowSeconds
    }
}
