import Foundation

public enum JarvisGateDecision: Equatable, Sendable {
    case signIn
    case locked
    case unlocked
    case denied
}

public struct JarvisGatePolicy: Sendable {
    public static let defaultLockInterval: TimeInterval = 60

    public let lockInterval: TimeInterval

    public init(lockInterval: TimeInterval = Self.defaultLockInterval) {
        self.lockInterval = max(lockInterval, 0)
    }

    public func shouldLock(
        lastBackgroundedAt: Date?,
        now: Date,
        isColdStart: Bool = false
    ) -> Bool {
        guard !isColdStart else { return true }
        guard let lastBackgroundedAt else { return false }
        return now.timeIntervalSince(lastBackgroundedAt) >= lockInterval
    }

    public func decision(
        tokenPresent: Bool,
        tokenExpired: Bool = false,
        accountDenied: Bool = false,
        isLocked: Bool
    ) -> JarvisGateDecision {
        if accountDenied { return .denied }
        guard tokenPresent, !tokenExpired else { return .signIn }
        return isLocked ? .locked : .unlocked
    }
}
