import Foundation

/// What the audio engine still owes the voice session: one receipt per response, once its audio has stopped.
///
/// The engine owns the player and its buffers; this owns the counting, so the rule is testable without audio.
/// A response is over when the backend has finished it and its last buffer has played, or when the player is
/// stopped under it. A response that is never reported keeps the session on Speaking.
public struct VoicePlaybackLedger: Sendable {
    public struct Receipt: Equatable, Sendable {
        public let responseID: String
        /// Whether any of the response's audio reached the player.
        public let audible: Bool
    }

    private struct Progress {
        var pending = 0
        var finished = false
        var scheduled = false
    }

    private var responses: [String: Progress] = [:]

    public init() {}

    /// One more buffer of this response is queued on the player.
    public mutating func bufferScheduled(responseID: String) {
        var progress = responses[responseID, default: Progress()]
        progress.pending += 1
        progress.scheduled = true
        responses[responseID] = progress
    }

    /// A queued buffer of this response has played.
    public mutating func bufferPlayed(responseID: String) -> Receipt? {
        guard var progress = responses[responseID] else { return nil }
        progress.pending = max(0, progress.pending - 1)
        return settle(responseID, progress)
    }

    /// The backend has sent all the audio of this response.
    public mutating func responseFinished(responseID: String) -> Receipt? {
        var progress = responses[responseID, default: Progress()]
        progress.finished = true
        return settle(responseID, progress)
    }

    /// The player was stopped, so nothing queued will play: every response it held is over.
    public mutating func playbackStopped() -> [Receipt] {
        let receipts = responses
            .map { Receipt(responseID: $0.key, audible: $0.value.scheduled) }
            .sorted { $0.responseID < $1.responseID }
        responses.removeAll()
        return receipts
    }

    private mutating func settle(_ responseID: String, _ progress: Progress) -> Receipt? {
        guard progress.finished, progress.pending == 0 else {
            responses[responseID] = progress
            return nil
        }
        responses.removeValue(forKey: responseID)
        return Receipt(responseID: responseID, audible: progress.scheduled)
    }
}
