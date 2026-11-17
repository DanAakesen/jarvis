import Foundation

@MainActor
public final class WatchDictationDeadline {
    public static let seconds: TimeInterval = 30
    public static let duration: Duration = .seconds(seconds)
    /// Direct attempt when no phone fallback is possible; it ends after the server's 20 s deadline answers.
    public static let directSeconds: TimeInterval = 22
    public static let directDuration: Duration = .seconds(directSeconds)
    /// Direct attempt when the iPhone can take over. A healthy request returns in about 4 s, so a slow one
    /// leaves the phone path most of the overall deadline instead of the last few seconds.
    public static let directWithPhoneFallbackSeconds: TimeInterval = 10
    public static let directWithPhoneFallbackDuration: Duration = .seconds(directWithPhoneFallbackSeconds)

    /// Recorded dictation is PCM16 mono at 24 kHz.
    public static let bytesPerSecond = 48_000
    private static let longestSeconds: TimeInterval = 120

    public static func clipSeconds(bytes: Int) -> TimeInterval { Double(max(0, bytes)) / Double(bytesPerSecond) }

    /// A longer recording needs longer to upload and recognise, so the overall wait grows with it.
    public static func duration(clipSeconds: TimeInterval) -> Duration {
        .seconds(min(seconds + max(0, clipSeconds), longestSeconds))
    }

    /// The direct attempt's window. It never exceeds the server's own deadline plus a small margin, and with a
    /// phone fallback it grows with the clip so a 10 s recording is not abandoned while it is still being recognised.
    public static func directWindow(clipSeconds: TimeInterval, phoneFallback: Bool) -> Duration {
        guard phoneFallback else { return directDuration }
        return .seconds(min(directWithPhoneFallbackSeconds + max(0, clipSeconds), directSeconds))
    }

    private let sleep: @MainActor (Duration) async throws -> Void
    private var task: Task<Void, Never>?
    private var generation = UUID()

    public init(sleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.sleep = sleep
    }

    public func start(duration: Duration = WatchDictationDeadline.duration, onTimeout: @escaping @MainActor () -> Void) {
        cancel()
        let current = generation
        let sleep = sleep
        task = Task { [weak self] in
            do { try await sleep(duration) } catch { return }
            guard !Task.isCancelled, let self, self.generation == current else { return }
            self.task = nil
            onTimeout()
        }
    }

    public func cancel() {
        generation = UUID()
        task?.cancel()
        task = nil
    }
}
