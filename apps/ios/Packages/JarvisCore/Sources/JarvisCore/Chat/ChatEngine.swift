import Foundation

/// TEST-ONLY chat engine switch. Delete this file, `PiStatus.swift` and their call sites at phase 8.
/// `current` is the old engine; `pi` is the managed Microsoft Copilot harness agent behind the backend.
/// There is no runtime fallback: a failing `pi` turn reports an honest error and never reroutes to `current`.
public enum ChatEngine: String, Codable, Sendable, CaseIterable, Hashable {
    case current
    case pi
}

/// Persists the owner's engine choice. The default is `pi`; unknown stored values read as `pi`.
public enum ChatEngineSelection {
    public static let key = "jarvis.test.chatEngine"

    public static func load(from defaults: UserDefaults = .standard) -> ChatEngine {
        defaults.string(forKey: key).flatMap(ChatEngine.init(rawValue:)) ?? .pi
    }

    public static func save(_ engine: ChatEngine, to defaults: UserDefaults = .standard) {
        defaults.set(engine.rawValue, forKey: key)
    }
}

/// Client-side limit for the paid PI warm-up: at most one attempt per interval per app run.
public struct PiWarmThrottle: Sendable {
    public let interval: TimeInterval
    private var lastAttempt: Date?

    public init(interval: TimeInterval = 300) {
        self.interval = interval
    }

    /// Returns true and records the attempt when the interval has passed since the previous one.
    public mutating func shouldWarm(now: Date = Date()) -> Bool {
        if let lastAttempt, now.timeIntervalSince(lastAttempt) < interval { return false }
        lastAttempt = now
        return true
    }
}
