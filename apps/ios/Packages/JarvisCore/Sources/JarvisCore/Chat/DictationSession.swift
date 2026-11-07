import Foundation

/// Owns recognition callbacks, including callbacks already queued when a session stops.
public struct DictationSession: Sendable {
    private var id: UUID?
    private var transcript = DictationTranscript(base: "")

    public init() {}

    public mutating func start(base: String) -> UUID {
        let id = UUID()
        self.id = id
        transcript = DictationTranscript(base: base)
        return id
    }

    public func isActive(_ id: UUID) -> Bool { self.id == id }

    public mutating func update(_ text: String, sessionID: UUID) -> String? {
        guard isActive(sessionID) else { return nil }
        return transcript.update(text)
    }

    public mutating func stop() { id = nil }
}
