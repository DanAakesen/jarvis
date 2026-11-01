import AppIntents
import JarvisCore

struct MuteVoiceActivityIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Mute voice session"
    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Session") var sessionID: String
    @Parameter(title: "Muted") var muted: Bool

    init() {}

    init(sessionID: String, muted: Bool) {
        self.sessionID = sessionID
        self.muted = muted
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let id = UUID(uuidString: sessionID) else { throw VoiceLiveActivityError.unavailable }
        try await VoiceLiveActivityActions.perform(sessionID: id, command: .setMuted(muted))
        return .result()
    }
}

struct EndVoiceActivityIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "End voice session"
    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Session") var sessionID: String

    init() {}

    init(sessionID: String) {
        self.sessionID = sessionID
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let id = UUID(uuidString: sessionID) else { throw VoiceLiveActivityError.unavailable }
        try await VoiceLiveActivityActions.perform(sessionID: id, command: .end)
        return .result()
    }
}
