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

    private let sleep: @MainActor (Duration) async throws -> Void
    private var task: Task<Void, Never>?
    private var generation = UUID()

    public init(sleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.sleep = sleep
    }

    public func start(onTimeout: @escaping @MainActor () -> Void) {
        cancel()
        let current = generation
        let sleep = sleep
        task = Task { [weak self] in
            do { try await sleep(Self.duration) } catch { return }
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
