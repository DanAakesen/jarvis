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

    /// Resetting a failed capture can also clear playback's handler. Install it only on the ready graph.
    @MainActor
    public static func startCapture<Capture>(
        isCurrent: () -> Bool,
        start: () throws -> Capture,
        onFailure: (Int, Error) -> Void,
        onReady: () -> Void = {},
        wait: () async throws -> Void = { try await Task.sleep(for: .milliseconds(300)) }
    ) async throws -> Capture {
        var attempt = 1
        while true {
            try Task.checkCancellation()
            guard isCurrent() else { throw CancellationError() }
            do {
                let capture = try start()
                onReady()
                return capture
            } catch {
                onFailure(attempt, error)
                guard attempt < 3 else { throw error }
                attempt += 1
                try await wait()
            }
        }
    }

    /// Reachability alone isn't a recovery: confirm the same phone session within one overall deadline.
    @MainActor
    public static func reconnect(
        now: () -> ContinuousClock.Instant = { .now },
        wait: (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        heartbeat: (Duration) async throws -> Void
    ) async throws {
        let deadline = now().advanced(by: .seconds(reconnectGraceSeconds))
        while true {
            try Task.checkCancellation()
            let remaining = now().duration(to: deadline)
            guard remaining > .zero else { throw WatchFailure.unavailable }
            do {
                try await heartbeat(min(remaining, .seconds(2)))
                try Task.checkCancellation()
                guard now() < deadline else { throw WatchFailure.unavailable }
                return
            } catch WatchFailure.unavailable {
                let remaining = now().duration(to: deadline)
                guard remaining > .zero else { throw WatchFailure.unavailable }
                try await wait(min(remaining, .milliseconds(500)))
            }
        }
    }
}
