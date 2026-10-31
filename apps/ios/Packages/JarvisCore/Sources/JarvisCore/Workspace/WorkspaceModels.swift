import Foundation

public struct WorkspaceWindow: Codable, Equatable, Sendable {
    public let viewId: String
    public let title: String

    public init(viewId: String, title: String) {
        self.viewId = viewId
        self.title = title
    }
}

public struct WorkspaceDevice: Codable, Equatable, Sendable {
    public let kind: Kind
    public let label: String?

    public enum Kind: String, Codable, Equatable, Sendable {
        case phone
    }

    public init(kind: Kind = .phone, label: String? = nil) {
        self.kind = kind
        self.label = label
    }
}

public struct WorkspaceSnapshot: Codable, Equatable, Sendable {
    public let windows: [WorkspaceWindow]
    public let contextPanelOpen: Bool
    public let device: WorkspaceDevice?

    public init(
        windows: [WorkspaceWindow],
        contextPanelOpen: Bool,
        device: WorkspaceDevice? = nil
    ) {
        self.windows = windows
        self.contextPanelOpen = contextPanelOpen
        self.device = device
    }
}

public struct WorkspaceCommand: Decodable, Equatable, Sendable {
    public let commandId: String
    public let operation: String
    public let fields: [String: JSONValue]

    public init(commandId: String, operation: String, fields: [String: JSONValue]) {
        self.commandId = commandId
        self.operation = operation
        self.fields = fields
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        var object = try container.decode([String: JSONValue].self)
        guard case .string(let commandId)? = object["commandId"],
              case .string(let operation)? = object["operation"],
              commandId.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil,
              !operation.isEmpty,
              operation.utf8.count <= 64 else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid workspace command"
            )
        }
        object.removeValue(forKey: "commandId")
        object.removeValue(forKey: "operation")
        self.commandId = commandId
        self.operation = operation
        self.fields = object
    }
}

public enum WorkspaceCommandOutcome: String, Codable, Equatable, Sendable {
    case refused
    case error
}

public enum WorkspaceEvent: Equatable, Sendable {
    case pendingConfirmationsChanged
    case activityChanged
    case workspaceReady(sessionId: String)
    case workspaceCommand(command: WorkspaceCommand, expiresAtMilliseconds: Int64)
    case workspaceCancel(commandId: String)
    case unknown(name: String, data: String)
}

public enum JarvisWorkspaceClientError: Error, Equatable, Sendable {
    case invalidSnapshot
    case invalidAcknowledgement
    case invalidResponse
    case noActiveConnection
    case staleConnection
    case commandNoLongerPending
    case acknowledgementExpired
}

public struct WorkspaceReconnectPolicy: Sendable {
    public let initialDelay: Duration
    public let maximumDelay: Duration

    public init(
        initialDelay: Duration = .seconds(1),
        maximumDelay: Duration = .seconds(30)
    ) {
        let hardMaximum = min(max(maximumDelay, .milliseconds(1)), .seconds(30))
        self.maximumDelay = hardMaximum
        self.initialDelay = min(max(initialDelay, .milliseconds(1)), hardMaximum)
    }

    public func delay(afterAttempt attempt: Int) -> Duration {
        var delay = initialDelay
        guard attempt > 1 else { return delay }
        for _ in 1..<attempt {
            if delay >= maximumDelay { return maximumDelay }
            delay = min(delay + delay, maximumDelay)
        }
        return delay
    }
}

public protocol WorkspaceClock: Sendable {
    func now() async -> Date
    func sleep(for duration: Duration) async throws
}

public struct ContinuousWorkspaceClock: WorkspaceClock {
    public init() {}

    public func now() async -> Date { Date() }

    public func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}
