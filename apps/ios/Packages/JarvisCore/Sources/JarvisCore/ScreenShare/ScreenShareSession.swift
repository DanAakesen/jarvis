import Foundation

public enum ScreenShareState: Equatable, Sendable {
    case idle
    case starting
    case live
    case stopped
    case extensionMissing
    case failed
}

/// Tracks one screen-sharing attempt. The system broadcast picker reports nothing back to the app, so the
/// broadcast extension's heartbeat (`isSharing`) is the only signal that a broadcast actually began.
public struct ScreenShareSession: Equatable, Sendable {
    public static let startTimeout: TimeInterval = 20

    public private(set) var state: ScreenShareState = .idle
    private var startedAt: Date?
    private var awaitingBroadcastEnd = false

    public init() {}

    public var isBusy: Bool { state == .starting || state == .live }

    /// Returns true when the system broadcast picker should be presented now.
    public mutating func requestStart(extensionInstalled: Bool, now: Date = Date()) -> Bool {
        guard !isBusy else { return false }
        guard extensionInstalled else {
            state = .extensionMissing
            startedAt = nil
            return false
        }
        state = .starting
        startedAt = now
        awaitingBroadcastEnd = false
        return true
    }

    public mutating func requestStop() {
        guard isBusy else { return }
        state = .stopped
        startedAt = nil
        awaitingBroadcastEnd = true
    }

    public mutating func observe(isSharing: Bool, now: Date = Date()) {
        if awaitingBroadcastEnd {
            if !isSharing { awaitingBroadcastEnd = false }
            return
        }
        switch state {
        case .starting:
            if isSharing {
                state = .live
                startedAt = nil
            } else if let startedAt, now.timeIntervalSince(startedAt) > Self.startTimeout {
                state = .failed
                self.startedAt = nil
            }
        case .live:
            if !isSharing { state = .stopped }
        case .idle, .stopped, .failed, .extensionMissing:
            if isSharing { state = .live }
        }
    }
}
