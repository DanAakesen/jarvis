public struct VoiceCaptionEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public let speaker: ConversationRole
    public internal(set) var text: String

    public init(id: String, speaker: ConversationRole, text: String) {
        self.id = id
        self.speaker = speaker
        self.text = text
    }
}

public struct VoiceCaptions: Equatable, Sendable {
    private static let maximumEventIDs = 8_192

    public private(set) var entries: [VoiceCaptionEntry] = []
    private var seenEventIDs = Set<String>()

    public init() {}

    public var user: String {
        entries.last(where: { $0.speaker == .dan })?.text ?? ""
    }

    public var assistant: String {
        entries.last(where: { $0.speaker == .jarvis })?.text ?? ""
    }

    public mutating func receive(_ message: VoiceServerMessage) {
        switch message {
        case .transcriptionDelta(let delta, let itemID, let eventID):
            guard markEvent(eventID) else { return }
            append(delta, to: itemID, speaker: .dan)
        case .transcriptionCompleted(let transcript, let itemID):
            upsert(transcript, id: itemID, speaker: .dan)
        case .responseCreated(let responseID, _):
            if !entries.contains(where: { $0.id == responseID && $0.speaker == .jarvis }) {
                entries.append(.init(id: responseID, speaker: .jarvis, text: ""))
            }
        case .assistantTranscriptDelta(let delta, let responseID, let eventID):
            guard markEvent(eventID) else { return }
            append(delta, to: responseID, speaker: .jarvis)
        case .responseCancelled(let responseID):
            guard let index = entries.firstIndex(where: { $0.id == responseID }),
                  entries[index].speaker == .jarvis,
                  entries[index].text.isEmpty else { return }
            entries.remove(at: index)
        default:
            break
        }
    }

    private mutating func append(_ delta: String, to id: String, speaker: ConversationRole) {
        if let index = entries.firstIndex(where: { $0.id == id && $0.speaker == speaker }) {
            entries[index].text += delta
        } else {
            entries.append(.init(id: id, speaker: speaker, text: delta))
        }
    }

    private mutating func upsert(_ text: String, id: String, speaker: ConversationRole) {
        if let index = entries.firstIndex(where: { $0.id == id && $0.speaker == speaker }) {
            entries[index].text = text
        } else {
            entries.append(.init(id: id, speaker: speaker, text: text))
        }
    }

    private mutating func markEvent(_ eventID: String?) -> Bool {
        guard let eventID else { return true }
        guard seenEventIDs.insert(eventID).inserted else { return false }
        if seenEventIDs.count > Self.maximumEventIDs {
            seenEventIDs.removeAll(keepingCapacity: true)
            seenEventIDs.insert(eventID)
        }
        return true
    }
}
