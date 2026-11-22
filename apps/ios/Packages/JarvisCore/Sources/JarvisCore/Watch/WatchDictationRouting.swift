import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum WatchDictationError: Error, Equatable, Sendable {
    case timedOut, noSpeech

    public static func forHTTPStatus(_ status: Int) -> Self? {
        status == 504 ? .timedOut : nil
    }

    public var message: String {
        switch self {
        case .timedOut: "Transcription timed out. Try again, or tap Message to type."
        case .noSpeech: "No words were recognised. Speak clearly and try again, or tap Message to type."
        }
    }
}

/// Transcription is safe to fall back; chat/voice mutations must never use this policy.
@MainActor
public enum WatchDictationRouting {
    public static func directSessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        #if canImport(Darwin)
        // An unavailable direct route should fall back to the phone, not use the recognition window.
        configuration.waitsForConnectivity = false
        #endif
        configuration.timeoutIntervalForResource = WatchDictationDeadline.directSeconds
        return configuration
    }

    public static func transcribe(
        direct: (@MainActor () async throws -> String)?,
        phone: () async throws -> String,
        onDirectFailure: (Error) throws -> Void = { _ in },
        directWindow: Duration = WatchDictationDeadline.directDuration,
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) async throws -> String {
        try Task.checkCancellation()
        var directFailure: Error?
        if let direct {
            do {
                let text = try await boundedDirect(direct, window: directWindow, sleep: sleep)
                try Task.checkCancellation()
                return try transcript(text)
            }
            catch {
                try checkCancellation(error)
                // A completed recognition with no words isn't a transport failure. Both paths use the same transcriber.
                if error as? WatchDictationError == .noSpeech { throw error }
                directFailure = error
                try onDirectFailure(error)
            }
        }
        try Task.checkCancellation()
        do {
            let text = try await phone()
            try Task.checkCancellation()
            return try transcript(text)
        }
        catch {
            try checkCancellation(error)
            if error as? WatchDictationError == .noSpeech { throw error }
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

    private static func transcript(_ text: String) throws -> String {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw WatchDictationError.noSpeech }
        guard text.utf8.count <= 8_000 else { throw WatchFailure.failed }
        return text
    }

    private static func boundedDirect(
        _ direct: @escaping @MainActor () async throws -> String,
        window: Duration,
        sleep: @escaping @MainActor (Duration) async throws -> Void
    ) async throws -> String {
        let race = DirectRace()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                race.start(continuation: continuation, direct: direct, window: window, sleep: sleep)
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
        window: Duration = WatchDictationDeadline.directDuration,
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
            do { try await sleep(window) }
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
