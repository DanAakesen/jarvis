import Foundation

@MainActor
public final class WatchDictationDeadline {
    /// Allow the server's 30 s upload and 20 s recognition windows, plus transit.
    public static let directSeconds: TimeInterval = 55
    public static let directDuration: Duration = .seconds(directSeconds)

    private let sleep: @MainActor (Duration) async throws -> Void
    private var task: Task<Void, Never>?
    private var generation = UUID()

    public init(sleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.sleep = sleep
    }

    public func start(duration: Duration, onTimeout: @escaping @MainActor () -> Void) {
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
