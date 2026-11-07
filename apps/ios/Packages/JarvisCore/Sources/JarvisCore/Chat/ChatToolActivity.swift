import Foundation

/// Public activity metadata only; arguments, results and private tool errors never enter this view.
public struct ChatToolActivity: Decodable, Equatable, Sendable, Identifiable {
    public let activityId: String
    public let messageId: String
    public let toolName: String
    public let outcome: ChatToolOutcome?
    public var id: String { activityId }

    private enum CodingKeys: String, CodingKey { case type, source, activityId, messageId, toolName, outcome }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let type = try values.decode(String.self, forKey: .type)
        let source = try values.decode(String.self, forKey: .source)
        activityId = try values.decode(String.self, forKey: .activityId)
        messageId = try values.decode(String.self, forKey: .messageId)
        toolName = try values.decode(String.self, forKey: .toolName)
        outcome = try values.decodeIfPresent(ChatToolOutcome.self, forKey: .outcome)
        guard source == "chat",
              ["tool-call-started", "tool-call-finished"].contains(type),
              activityId.range(of: #"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"#, options: .regularExpression) != nil,
              messageId.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil,
              Int64(messageId) != nil,
              toolName.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil,
              (type == "tool-call-finished") == (outcome != nil) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid chat tool activity"))
        }
    }
}
