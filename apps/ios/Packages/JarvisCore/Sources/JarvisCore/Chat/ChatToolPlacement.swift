import Foundation

/// Storage associates tool calls with the request. Presentation associates them with
/// the next assistant reply in that same transport session, never a voice/test reply.
public struct ChatToolPlacement: Sendable {
    public struct Message: Sendable {
        public let id: String
        public let sessionID: String
        public let channel: ConversationChannel
        public let role: ConversationRole
        public let tools: [ChatHistoryToolCall]
        public let interrupted: Bool

        public init(id: String, sessionID: String, channel: ConversationChannel,
                    role: ConversationRole, tools: [ChatHistoryToolCall], interrupted: Bool = false) {
            self.id = id
            self.sessionID = sessionID
            self.channel = channel
            self.role = role
            self.tools = tools
            self.interrupted = interrupted
        }
    }

    public private(set) var replies: [String: [ChatHistoryToolCall]] = [:]
    /// Unanswered requests retain a separate assistant activity group, not a user attachment.
    public private(set) var unanswered: [String: [ChatHistoryToolCall]] = [:]

    public init(messages: [Message]) {
        var pending: [String: (anchor: String, tools: [ChatHistoryToolCall])] = [:]
        for message in messages {
            let key = "\(message.channel.rawValue):\(message.sessionID)"
            if message.role == .dan {
                let tools = (pending[key]?.tools ?? []) + message.tools
                if !tools.isEmpty { pending[key] = (message.id, tools) }
            } else if message.interrupted {
                if !message.tools.isEmpty { replies[message.id] = Self.unique(message.tools) }
            } else {
                let tools = (pending.removeValue(forKey: key)?.tools ?? []) + message.tools
                if !tools.isEmpty { replies[message.id] = Self.unique(tools) }
            }
        }
        for group in pending.values { unanswered[group.anchor] = Self.unique(group.tools) }
    }

    private static func unique(_ tools: [ChatHistoryToolCall]) -> [ChatHistoryToolCall] {
        var seen = Set<String>()
        return tools.filter { seen.insert($0.id).inserted }
    }
}
