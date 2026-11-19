import Foundation

/// Identifies one microphone capture so a delayed action (the silence recovery) can tell whether the capture
/// it was scheduled for is still the live one. A stop or a restart invalidates every earlier token.
public struct WatchCaptureGeneration: Sendable {
    public struct Token: Equatable, Sendable { fileprivate let value: UInt64 }

    private var current: UInt64 = 0
    private var live = false
    public init() {}

    /// A new capture begins; earlier tokens stop being current.
    public mutating func begin() -> Token {
        current &+= 1
        live = true
        return Token(value: current)
    }

    /// The capture ended; nothing scheduled for it may act any more.
    public mutating func end() { live = false; current &+= 1 }

    public func isCurrent(_ token: Token) -> Bool { live && token.value == current }
}
