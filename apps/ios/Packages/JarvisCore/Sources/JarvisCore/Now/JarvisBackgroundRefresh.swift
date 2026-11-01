import Foundation

@MainActor
public final class JarvisBackgroundRefresh {
    private var work: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var completion: ((Bool) -> Void)?

    public init(completion: @escaping (Bool) -> Void) {
        self.completion = completion
    }

    public func start(
        timeout: Duration,
        operation: @escaping @MainActor () async throws -> Void
    ) {
        guard completion != nil, work == nil else { return }
        work = Task {
            do {
                try Task.checkCancellation()
                try await operation()
                try Task.checkCancellation()
                finish(success: true)
            } catch {
                finish(success: false)
            }
        }
        deadline = Task {
            do {
                try await Task.sleep(for: timeout)
                cancel()
            } catch {}
        }
    }

    public func cancel() {
        finish(success: false)
    }

    private func finish(success: Bool) {
        guard let completion else { return }
        self.completion = nil
        work?.cancel()
        deadline?.cancel()
        work = nil
        deadline = nil
        completion(success)
    }
}
