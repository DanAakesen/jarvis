import Foundation

/// Runs its body once, however many times it is called and from whichever thread.
///
/// URLSession's WebSocket completion handlers can fire again when the socket closes (a ping answered, then
/// cancelled), and resuming a checked continuation a second time traps the app. Resume through this instead.
public final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    public init() {}

    /// Returns true when this call ran `body`.
    @discardableResult
    public func run(_ body: () -> Void) -> Bool {
        lock.lock()
        let first = !done
        done = true
        lock.unlock()
        if first { body() }
        return first
    }
}
