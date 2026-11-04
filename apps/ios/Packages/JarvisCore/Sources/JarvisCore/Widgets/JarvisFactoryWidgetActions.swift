import Foundation

/// One tap on a widget button that the app has yet to run. It names the action and the task or confirmation only.
public struct JarvisFactoryWidgetPendingAction: Codable, Equatable, Sendable {
    public var action: JarvisFactoryWidgetData.Action
    public var id: String
    public var requestedAt: Date

    public init(action: JarvisFactoryWidgetData.Action, id: String, requestedAt: Date = Date()) {
        self.action = action
        self.id = id
        self.requestedAt = requestedAt
    }
}

/// Where a widget tap waits when the intent runs in the extension process, which holds no credentials. The app
/// drains it when it next runs. Taps older than `maximumAge` are dropped, so an old tap never fires by surprise.
public struct JarvisFactoryWidgetActionQueue: Sendable {
    public static let fileName = "widget-pending-actions.json"
    public static let maximumAge: TimeInterval = 15 * 60
    static let maximumCount = 20

    private let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    private var fileURL: URL { directory.appendingPathComponent(Self.fileName) }

    private func read() -> [JarvisFactoryWidgetPendingAction] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([JarvisFactoryWidgetPendingAction].self, from: data)) ?? []
    }

    public func enqueue(_ pending: JarvisFactoryWidgetPendingAction) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let queue = Array((read() + [pending]).suffix(Self.maximumCount))
        try encoder.encode(queue).write(to: fileURL, options: .atomic)
    }

    /// Returns the fresh pending actions and empties the queue.
    public func drain(now: Date = Date()) -> [JarvisFactoryWidgetPendingAction] {
        let pending = read().filter { now.timeIntervalSince($0.requestedAt) <= Self.maximumAge }
        try? FileManager.default.removeItem(at: fileURL)
        return pending
    }
}

/// The immediate Factory actions a widget button can run. The App Intents call `perform`. In the app process the
/// installed handler holds the authenticated clients; elsewhere the tap is queued for the app, so no token ever
/// sits in the shared container.
@MainActor
public enum JarvisFactoryWidgetActions {
    public static var handler: (@MainActor (JarvisFactoryWidgetData.Action, String) async throws -> Void)?
    public static var queue: JarvisFactoryWidgetActionQueue?

    public enum Failure: Error, Equatable {
        case unavailable
    }

    public static func perform(_ action: JarvisFactoryWidgetData.Action, id: String) async throws {
        if let handler {
            try await handler(action, id)
        } else if let queue {
            try queue.enqueue(.init(action: action, id: id))
        } else {
            throw Failure.unavailable
        }
    }
}
