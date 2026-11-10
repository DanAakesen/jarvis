import Foundation

public struct FactoryTimelineEntry: Identifiable, Equatable, Sendable {
    public enum Kind: Sendable { case activity, message, notifications, disk }

    public var id: String { events[0].id }
    public let kind: Kind
    public private(set) var events: [FactoryTaskEvent]
    public private(set) var text: String
    public let needsAttention: Bool
    fileprivate let chunkScope: String?

    fileprivate mutating func append(_ entry: Self) {
        events += entry.events
        if kind == .message { text += entry.text }
    }
}

public enum FactoryTaskTimeline {
    public static let previewLimit = 6

    public static func payloadUnavailable(_ event: FactoryTaskEvent) -> Bool {
        event.payloadTruncated || event.payload["truncated"] == .bool(true)
    }

    public static func entries(
        events: [FactoryTaskEvent], taskID: String, language: JarvisAppLanguage
    ) -> [FactoryTimelineEntry] {
        var history = FactoryTaskHistory(taskID: taskID)
        history.mergePage(events, offset: 0, limit: max(1, events.count))
        var entries: [FactoryTimelineEntry] = []
        for event in history.events {
            let entry = entry(for: event, language: language)
            if !entries.isEmpty, !entry.needsAttention, !entries[entries.count - 1].needsAttention,
               entries[entries.count - 1].kind == entry.kind,
               (entry.kind == .notifications || entry.kind == .disk ||
                (entry.kind == .message && entry.chunkScope == entries[entries.count - 1].chunkScope)) {
                entries[entries.count - 1].append(entry)
            } else {
                entries.append(entry)
            }
        }
        return entries
    }

    /// Keep a failure visible even when it precedes the recent activity window.
    public static func preview(_ entries: [FactoryTimelineEntry]) -> [FactoryTimelineEntry] {
        var visible = Array(entries.suffix(previewLimit))
        if let attention = entries.last(where: \.needsAttention),
           !visible.contains(where: { $0.id == attention.id }) {
            visible.insert(attention, at: 0)
        }
        return visible
    }

    private static func entry(for event: FactoryTaskEvent, language: JarvisAppLanguage) -> FactoryTimelineEntry {
        let payload = event.payload
        let data = payload["data"]
        let update = data["params"]["update"]
        let updateType = update["sessionUpdate"].text
        let status = update["status"].text
        let attention = event.type.contains("error") || event.type.contains("fail") ||
            event.type == "disk_low" || event.type == "agent_stderr" ||
            payload["to"].text == "NeedsAttention" || status == "failed" ||
            updateType == "error" || updateType == "failed" ||
            update["error"] != .null || data["error"] != .null ||
            ["failure", "failed", "error"].contains(payload["conclusion"].text ?? "") ||
            (event.summary?.localizedCaseInsensitiveContains("failed") ?? false)
        let summary = event.summary ?? event.type.replacingOccurrences(of: "_", with: " ")
        var kind = FactoryTimelineEntry.Kind.activity
        var text = summary
        var scope: String?
        if event.type == "acp_notification" {
            // Only ACP's public message channel is text. Never traverse thought chunks,
            // tool inputs/outputs, arbitrary notification params or provider metadata.
            if !payloadUnavailable(event), data["method"].text == "session/update",
               updateType == "agent_message_chunk", update["content"]["type"].text == "text",
               let chunk = update["content"]["text"].text {
                kind = .message
                text = chunk
                scope = [
                    payload["invocationId"].text ?? "",
                    data["params"]["sessionId"].text ?? "",
                    update["messageId"].text ?? ""
                ].joined(separator: ":")
            } else if data["method"].text == "session/update",
                      ["tool_call", "tool_call_update"].contains(updateType ?? "") {
                text = [
                    update["title"].text ?? JarvisFactoryLocalization.string(.agentUpdate, language: language),
                    status.map { statusLabel($0, language: language) }
                ].compactMap { $0 }.joined(separator: " · ")
            } else if data["method"].text == "session/update", updateType == "plan",
                      case .array(let items) = update["entries"] {
                text = items.compactMap { item -> String? in
                    guard let content = item["content"].text else { return nil }
                    return [content, item["status"].text.map { statusLabel($0, language: language) }]
                        .compactMap { $0 }.joined(separator: " · ")
                }.joined(separator: "\n")
                if text.isEmpty {
                    kind = .notifications
                    text = JarvisFactoryLocalization.string(.notifications, language: language)
                }
            } else if attention {
                text = [
                    JarvisFactoryLocalization.string(.agentUpdate, language: language),
                    status.map { statusLabel($0, language: language) }
                ]
                    .compactMap { $0 }.joined(separator: " · ")
            } else {
                kind = .notifications
                text = JarvisFactoryLocalization.string(.notifications, language: language)
            }
        } else if event.type == "disk_snapshot" {
            kind = .disk
        } else if event.type == "state_changed",
                  let from = payload["from"].text, let to = payload["to"].text {
            text = "\(stateLabel(from, language: language)) → \(stateLabel(to, language: language))"
            if summary != "Task state changed" { text += "\n\(summary)" }
        }
        return FactoryTimelineEntry(
            kind: kind, events: [event], text: text,
            needsAttention: attention, chunkScope: scope
        )
    }

    private static func stateLabel(_ state: String, language: JarvisAppLanguage) -> String {
        let key: JarvisFactoryLocalizationKey
        switch FactoryTaskState(rawValue: state) {
        case .ready: key = .ready
        case .running: key = .running
        case .pauseRequested: key = .pauseRequested
        case .paused: key = .paused
        case .needsAttention: key = .needsAttention
        case .done: key = .done
        case .cancelled: key = .cancelled
        case nil: return state
        }
        return JarvisFactoryLocalization.string(key, language: language)
    }

    private static func statusLabel(_ status: String, language: JarvisAppLanguage) -> String {
        let key: JarvisFactoryLocalizationKey
        switch status {
        case "pending": key = .checksPending
        case "in_progress": key = .inProgress
        case "completed": key = .done
        case "failed", "error": key = .failed
        case "cancelled": key = .cancelled
        default: return status
        }
        return JarvisFactoryLocalization.string(key, language: language)
    }
}

private extension FactoryJSONValue {
    subscript(_ key: String) -> Self {
        guard case .object(let values) = self else { return .null }
        return values[key] ?? .null
    }

    var text: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }
}
