import Foundation

/// Bounds for Watch capture and voice recovery.
public enum WatchVoiceRecovery {
    /// How long the Watch waits for the iPhone to become reachable again before it ends a live session.
    public static let reconnectGraceSeconds: TimeInterval = 10
    /// The phone waits longer, including room for the debounced disconnect callback. Active voice can
    /// notice a gap and start recovery before that callback.
    public static let phoneGraceSeconds: TimeInterval = 15
    public static let startAttempts = 3
    /// Only a quick failure is retried: a slow one has already used most of the start budget.
    public static let startRetryWindowSeconds: TimeInterval = 12
    public static let startRetryDelay: Duration = .milliseconds(750)

    public struct RouteBudget {
        public enum Decision: Equatable { case unchanged, restart, repeatRestart, exhausted }

        public static let settleDelay: Duration = .milliseconds(250)
        private var restarts: [ContinuousClock.Instant] = []

        public init() {}

        /// Only a change that still needs a restart after settling uses this capture's budget.
        public mutating func decide(needsRestart: Bool, at now: ContinuousClock.Instant = .now) -> Decision {
            guard needsRestart else { return .unchanged }
            restarts.removeAll { $0.duration(to: now) >= .seconds(10) }
            guard restarts.count < 2 else { return .exhausted }
            restarts.append(now)
            return restarts.count == 1 ? .restart : .repeatRestart
        }
    }

    /// Retrying a start request is safe because the phone answers a repeated request ID from its reply cache
    /// or reports it as busy while the first copy is still running; it never opens a second session.
    public static func shouldRetryStart(_ failure: Error, attempt: Int, elapsed: TimeInterval) -> Bool {
        guard let failure = failure as? WatchFailure, failure == .unavailable || failure == .busy else { return false }
        return attempt < startAttempts && elapsed < startRetryWindowSeconds
    }

    /// A lost WatchConnectivity acknowledgement can leave the phone waiting for audio that already played.
    @MainActor
    public static func deliverPlaybackReceipt(
        _ receipt: WatchRequest,
        isCurrent: @MainActor () -> Bool,
        send: @MainActor (WatchRequest) async throws -> Void,
        wait: @MainActor () async throws -> Void = { try await Task.sleep(for: .seconds(2)) }
    ) async {
        while !Task.isCancelled, isCurrent() {
            do {
                try await send(receipt)
                return
            } catch let failure as WatchFailure where failure == .unavailable || failure == .busy || failure == .network {
                do { try await wait() } catch { return }
            } catch {
                return
            }
        }
    }

    /// Resetting a failed capture can also clear playback's handler. Install it only on the ready graph.
    @MainActor
    public static func startCapture<Capture>(
        isCurrent: @MainActor () -> Bool,
        start: @MainActor (_ attempt: Int) async throws -> Capture,
        onFailure: @MainActor (Int, Error) -> Void,
        onReady: @MainActor () -> Void = {},
        wait: @MainActor () async throws -> Void = { try await Task.sleep(for: .milliseconds(300)) }
    ) async throws -> Capture {
        var attempt = 1
        while true {
            try Task.checkCancellation()
            guard isCurrent() else { throw CancellationError() }
            do {
                let capture = try await start(attempt)
                try Task.checkCancellation()
                guard isCurrent() else { throw CancellationError() }
                onReady()
                return capture
            } catch {
                try Task.checkCancellation()
                guard isCurrent() else { throw CancellationError() }
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
        now: @MainActor () -> ContinuousClock.Instant = { .now },
        wait: @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        heartbeat: @MainActor (Duration) async throws -> Void
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
