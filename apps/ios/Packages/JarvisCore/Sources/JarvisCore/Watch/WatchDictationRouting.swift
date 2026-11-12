import Foundation

/// Transcription is safe to fall back; chat/voice mutations must never use this policy.
@MainActor
public enum WatchDictationRouting {
    public static func transcribe(
        direct: (() async throws -> String)?,
        phone: () async throws -> String,
        onDirectFailure: (Error) throws -> Void = { _ in }
    ) async throws -> String {
        try Task.checkCancellation()
        var directFailure: Error?
        if let direct {
            do {
                let text = try await direct()
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
            if error as? WatchFailure == .unavailable {
                if let directFailure { throw directFailure }
                if direct == nil { throw WatchFailure.dictationSetup }
            }
            throw error
        }
    }

    private static func checkCancellation(_ error: Error) throws {
        try Task.checkCancellation()
        if error is CancellationError || (error as? URLError)?.code == .cancelled {
            throw CancellationError()
        }
    }
}
