import Foundation

public enum JarvisSignInRequestError: Error, Sendable {
    case timedOut
}

@MainActor
public final class JarvisSignInRequest {
    public typealias Completion = @MainActor @Sendable (Result<String, Error>) -> Void

    private let timeout: Duration
    private let sleep: @Sendable (Duration) async throws -> Void
    private var continuation: CheckedContinuation<String, Error>?
    private var deadline: Task<Void, Never>?
    private var cancel: (@MainActor () -> Void)?
    private var hasStarted = false

    public init(
        timeout: Duration = .seconds(120),
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.timeout = max(timeout, .zero)
        self.sleep = sleep
    }

    public func token(
        start: (@escaping Completion) -> Void,
        cancel: @escaping @MainActor () -> Void
    ) async throws -> String {
        try Task.checkCancellation()
        guard !hasStarted else { throw JarvisClientError.invalidRequest }
        hasStarted = true
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                self.cancel = cancel
                deadline = Task {
                    do {
                        try await sleep(timeout)
                        try Task.checkCancellation()
                        finish(.failure(JarvisSignInRequestError.timedOut), cancelRequest: true)
                    } catch {
                        if !Task.isCancelled { finish(.failure(error), cancelRequest: true) }
                    }
                }
                start { result in
                    self.finish(result)
                }
            }
        } onCancel: {
            Task { @MainActor in
                self.finish(.failure(CancellationError()), cancelRequest: true)
            }
        }
    }

    private func finish(_ result: Result<String, Error>, cancelRequest: Bool = false) {
        guard let continuation else { return }
        self.continuation = nil
        deadline?.cancel()
        deadline = nil
        let cancel = self.cancel
        self.cancel = nil
        if cancelRequest { cancel?() }
        continuation.resume(with: result)
    }
}
