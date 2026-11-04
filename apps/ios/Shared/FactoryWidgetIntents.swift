import AppIntents
import JarvisCore

/// The four immediate actions a Factory widget button may run. Each acts on one task or confirmation and needs no
/// sheet or dialog; the app (or its queue) holds the credentials.
struct ApproveFactoryTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Approve"
    static var openAppWhenRun = false
    static var isDiscoverable = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Confirmation") var targetID: String

    init() {}
    init(targetID: String) { self.targetID = targetID }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await JarvisFactoryWidgetActions.perform(.approve, id: targetID)
        return .result()
    }
}

struct PauseFactoryTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Pause"
    static var openAppWhenRun = false
    static var isDiscoverable = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Task") var targetID: String

    init() {}
    init(targetID: String) { self.targetID = targetID }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await JarvisFactoryWidgetActions.perform(.pause, id: targetID)
        return .result()
    }
}

struct ResumeFactoryTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Resume"
    static var openAppWhenRun = false
    static var isDiscoverable = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Task") var targetID: String

    init() {}
    init(targetID: String) { self.targetID = targetID }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await JarvisFactoryWidgetActions.perform(.resume, id: targetID)
        return .result()
    }
}

struct RetryFactoryTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Retry"
    static var openAppWhenRun = false
    static var isDiscoverable = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Task") var targetID: String

    init() {}
    init(targetID: String) { self.targetID = targetID }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await JarvisFactoryWidgetActions.perform(.retry, id: targetID)
        return .result()
    }
}
