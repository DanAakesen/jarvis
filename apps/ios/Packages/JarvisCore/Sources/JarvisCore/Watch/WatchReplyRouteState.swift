/// Keeps an exact reply target queued until the Watch can leave chat, voice or transcription work safely.
public struct WatchReplyRouteState: Equatable, Sendable {
    public private(set) var pending: JarvisReplyNotificationTarget?
    private var opening: JarvisReplyNotificationTarget?

    public init() {}

    public mutating func receive(_ target: JarvisReplyNotificationTarget) {
        guard pending != target else { return }
        pending = target
    }

    public mutating func takeWhenAvailable(
        reachable: Bool,
        busy: Bool,
        startingVoice: Bool,
        voiceActive: Bool,
        dictating: Bool
    ) -> JarvisReplyNotificationTarget? {
        guard reachable, !busy, !startingVoice, !voiceActive, !dictating,
              opening == nil, let pending else {
            return nil
        }
        opening = pending
        return pending
    }

    public mutating func opened(_ target: JarvisReplyNotificationTarget) {
        if opening == target { opening = nil }
        if pending == target { pending = nil }
    }

    public mutating func failed(_ target: JarvisReplyNotificationTarget) {
        guard opening == target else { return }
        opening = nil
    }

    public mutating func clear() {
        pending = nil
        opening = nil
    }
}
