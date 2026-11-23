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
        var lastBuffer = 0
        var finished = false
    }

    private var responses: [String: Progress] = [:]
    private var lastScheduled = 0
    private var playedThrough = 0

    public init() {}

    /// One more buffer of this response is queued on the player.
    @discardableResult
    public mutating func bufferScheduled(responseID: String) -> Int {
        lastScheduled += 1
        responses[responseID, default: Progress()].lastBuffer = lastScheduled
        return lastScheduled
    }

    /// A queued buffer of this response has played.
    public mutating func bufferPlayed(_ sequence: Int) -> [Receipt] {
        // Buffers play in schedule order on this player. A later callback also confirms earlier buffers.
        guard sequence > playedThrough, sequence <= lastScheduled else { return [] }
        playedThrough = sequence
        let finished = responses.filter { $0.value.finished && $0.value.lastBuffer <= playedThrough }
        return finished.sorted { $0.value.lastBuffer < $1.value.lastBuffer }.map { id, _ in
            responses.removeValue(forKey: id)
            return Receipt(responseID: id, audible: true)
        }
    }

    /// The backend has sent all the audio of this response.
    public mutating func responseFinished(responseID: String) -> Receipt? {
        var progress = responses[responseID, default: Progress()]
        progress.finished = true
        if progress.lastBuffer <= playedThrough {
            responses.removeValue(forKey: responseID)
            return Receipt(responseID: responseID, audible: progress.lastBuffer != 0)
        }
        responses[responseID] = progress
        return nil
    }

    /// The player was stopped, so nothing queued will play: every response it held is over.
    public mutating func playbackStopped() -> [Receipt] {
        let receipts = responses
            .map { Receipt(responseID: $0.key, audible: $0.value.lastBuffer != 0) }
            .sorted { $0.responseID < $1.responseID }
        responses.removeAll()
        playedThrough = lastScheduled
        return receipts
    }
}
