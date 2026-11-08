import Foundation

/// Presentation only: distinct attempts remain distinct, while adjacent calls to
/// the same tool share a disclosure row. Never expose arguments or private errors.
public struct ChatToolActivityGroup: Equatable, Sendable, Identifiable {
    public struct Call: Equatable, Sendable, Identifiable {
        public let id: String
        public let toolName: String
        public let outcome: ChatToolOutcome?
    }

    public var id: String { calls[0].id }
    public var toolName: String { calls[0].toolName }
    public private(set) var calls: [Call]

    public static func grouping(_ activity: [ChatToolActivity]) -> [Self] {
        group(activity.map { Call(id: $0.id, toolName: $0.toolName, outcome: $0.outcome) })
    }

    public static func grouping(_ history: [ChatHistoryToolCall]) -> [Self] {
        group(history.map { Call(id: $0.id, toolName: $0.tool, outcome: $0.outcome) })
    }

    private static func group(_ events: [Call]) -> [Self] {
        var calls: [Call] = []
        var indices: [String: Int] = [:]
        for event in events {
            if let index = indices[event.id] {
                // A replayed start must not turn a completed call back into Running.
                if calls[index].outcome == nil || event.outcome != nil { calls[index] = event }
            } else {
                indices[event.id] = calls.count
                calls.append(event)
            }
        }
        var groups: [Self] = []
        for call in calls {
            if groups.last?.toolName == call.toolName {
                groups[groups.count - 1].calls.append(call)
            } else {
                groups.append(Self(calls: [call]))
            }
        }
        return groups
    }
}
