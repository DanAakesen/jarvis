import Foundation

public enum ChatLanguage: String, Codable, Equatable, Sendable {
    case da
    case en
}

public enum ConversationChannel: String, Codable, Equatable, Sendable {
    case chat
    case voice
}

public enum ConversationRole: String, Codable, Equatable, Sendable {
    case dan
    case jarvis
}

public enum ChatAttachmentLimits {
    public static let maximumCount = 5
    public static let maximumFileBytes = 20 * 1024 * 1024
    public static let maximumImageBytes = 10 * 1024 * 1024
}

public struct ChatSession: Codable, Equatable, Sendable {
    public let id: String
    public let channel: ConversationChannel
    public let language: ChatLanguage
}

public struct ChatMessage: Codable, Equatable, Sendable {
    public let id: String
    public let sessionId: String
    public let role: ConversationRole
    public let text: String
    public let model: String?
    public let at: String
}

public struct ChatFoodInvitation: Codable, Equatable, Sendable {
    public let id: String
    public let summary: String
    public let expiresAt: String
}

public struct ChatTurnFailure: Codable, Equatable, Sendable {
    public let code: String?
    public let message: String?

    enum CodingKeys: String, CodingKey {
        case code
        case message = "error"
    }
}

public enum ChatEvent: Equatable, Sendable {
    case user(ChatMessage)
    case delta(text: String)
    case acknowledgment(text: String)
    case foodInvitation(ChatFoodInvitation?)
    case interrupted(ChatMessage)
    case done(ChatMessage)
    case error(ChatTurnFailure)
    case unknown(name: String, data: String)
}

public struct ActiveChatTurn: Codable, Equatable, Sendable {
    public let sessionId: String
    public let messageId: String
    public let language: ChatLanguage
}

public enum ActiveChatTurnSelection {
    public static func select(
        turns: [ActiveChatTurn],
        forSessionID sessionID: String?
    ) -> ActiveChatTurn? {
        guard let sessionID,
              let matchingTurn = turns.first(where: { $0.sessionId == sessionID }) else {
            return turns.first
        }
        return matchingTurn
    }
}

public enum ChatToolOutcome: String, Codable, Equatable, Sendable {
    case ok
    case refused
    case error
}

public struct ChatHistoryToolCall: Codable, Equatable, Sendable {
    public let id: String
    public let tool: String
    public let outcome: ChatToolOutcome
    public let taskId: String?
    public let artifactId: String?
}

public struct ChatAttachmentDescriptor: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Equatable, Sendable {
        case uploaded
        case ready
        case failed
    }

    public let id: String
    public let name: String
    public let contentType: String
    public let size: Int
    public let status: Status
}

public struct ChatHistoryAttachment: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let contentType: String
    public let size: Int
}

public struct ChatHistoryMessage: Codable, Equatable, Sendable {
    public let id: String
    public let sessionId: String
    public let channel: ConversationChannel
    public let language: ChatLanguage
    public let role: ConversationRole
    public let text: String
    public let model: String?
    public let interrupted: Bool
    public let voiceMinutes: Double?
    public let at: String
    public let toolCalls: [ChatHistoryToolCall]
    public let attachments: [ChatHistoryAttachment]
}

public struct ChatHistoryPage: Codable, Equatable, Sendable {
    public let messages: [ChatHistoryMessage]
    public let nextCursor: String?
}

public struct ChatAttachmentUpload: Sendable {
    public let fileName: String
    public let contentType: String
    public let data: Data

    public init(fileName: String, contentType: String, data: Data) {
        self.fileName = fileName
        self.contentType = contentType
        self.data = data
    }
}

public enum JarvisChatClientError: Error, Equatable, Sendable {
    case invalidTextLength
    case tooManyAttachments
    case invalidAttachmentIDs
    case invalidScreenContext
    case invalidUpload
    case invalidResponse
    case responseTooLarge
    case turnNotFound
    case reattachTimedOut
    case streamEnded
    case serverEvent(code: String?, message: String?)
}

public struct ReattachPolicy: Sendable {
    public let maximumDuration: Duration
    public let retryInterval: Duration = .seconds(2)

    public init(maximumDuration: Duration = .seconds(15 * 60)) {
        self.maximumDuration = min(max(maximumDuration, .zero), .seconds(15 * 60))
    }
}

public protocol ChatClock: Sendable {
    func now() async -> Duration
    func sleep(for duration: Duration) async throws
}

public struct ContinuousChatClock: ChatClock {
    private let origin = ContinuousClock().now

    public init() {}

    public func now() async -> Duration {
        ContinuousClock().now - origin
    }

    public func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}
