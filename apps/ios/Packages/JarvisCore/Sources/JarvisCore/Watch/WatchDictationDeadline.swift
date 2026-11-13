import Foundation

@MainActor
public final class WatchDictationDeadline {
    public static let seconds: TimeInterval = 25
    public static let duration: Duration = .seconds(seconds)
    public static let directSeconds: TimeInterval = 22
    public static let directDuration: Duration = .seconds(directSeconds)

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
