import Foundation

public enum WatchDictationError: Error, Equatable, Sendable {
    case timedOut

    public static func forHTTPStatus(_ status: Int) -> Self? {
        status == 504 ? .timedOut : nil
    }

    public var message: String {
        switch self {
        case .timedOut: "Transcription timed out. Try again, or tap Message to type."
        }
    }
}

/// Transcription is safe to fall back; chat/voice mutations must never use this policy.
@MainActor
public enum WatchDictationRouting {
    public static func transcribe(
        direct: (@MainActor () async throws -> String)?,
        phone: () async throws -> String,
        onDirectFailure: (Error) throws -> Void = { _ in },
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) async throws -> String {
        try Task.checkCancellation()
        var directFailure: Error?
        if let direct {
            do {
                let text = try await boundedDirect(direct, sleep: sleep)
                try Task.checkCancellation()
                return text
            }
            catch {
                try checkCancellation(error)
                directFailure = error
                try onDirectFailure(error)
            }
        }
        try Task.checkCancellation()
        do {
            let text = try await phone()
            try Task.checkCancellation()
            return text
        }
        catch {
            try checkCancellation(error)
            if directFailure as? WatchDictationError == .timedOut {
                switch error as? WatchFailure {
                case .unavailable, .network, .failed, nil: throw WatchDictationError.timedOut
                default: break
                }
            }
            if error as? WatchFailure == .unavailable {
                if let directFailure { throw directFailure }
                if direct == nil { throw WatchFailure.dictationSetup }
            }
            throw error
        }
    }

    private static func boundedDirect(
        _ direct: @escaping @MainActor () async throws -> String,
        sleep: @escaping @MainActor (Duration) async throws -> Void
    ) async throws -> String {
        let race = DirectRace()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                race.start(continuation: continuation, direct: direct, sleep: sleep)
            }
        } onCancel: {
            Task { @MainActor in race.finish(.failure(CancellationError())) }
        }
    }

    private static func checkCancellation(_ error: Error) throws {
        try Task.checkCancellation()
        if error is CancellationError || (error as? URLError)?.code == .cancelled {
            throw CancellationError()
        }
    }
}

@MainActor
final class DirectRace {
    private var continuation: CheckedContinuation<String, Error>?
    private var request: Task<Void, Never>?
    private var timer: Task<Void, Never>?
    private var finished = false
    private var earlyResult: Result<String, Error>?

    func start(
        continuation: CheckedContinuation<String, Error>,
        direct: @escaping @MainActor () async throws -> String,
        sleep: @escaping @MainActor (Duration) async throws -> Void
    ) {
        if let earlyResult {
            self.earlyResult = nil
            continuation.resume(with: earlyResult)
            return
        }
        if Task.isCancelled {
            finished = true
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        request = Task { [weak self] in
            do {
                try Task.checkCancellation()
                self?.finish(.success(try await direct()))
            }
            catch { self?.finish(.failure(error)) }
        }
        timer = Task { [weak self] in
            do { try await sleep(WatchDictationDeadline.directDuration) }
            catch { return }
            guard !Task.isCancelled else { return }
            self?.finish(.failure(WatchDictationError.timedOut))
        }
    }

    func finish(_ result: Result<String, Error>) {
        guard !finished else { return }
        finished = true
        guard let continuation else { earlyResult = result; return }
        self.continuation = nil
        request?.cancel(); request = nil
        timer?.cancel(); timer = nil
        continuation.resume(with: result)
    }
}
