public struct VoiceCaptions {
    public private(set) var user = ""
    public private(set) var assistant = ""
    private var userItemID: String?

    public init() {}

    public mutating func receive(_ message: VoiceServerMessage) {
        switch message {
        case .transcriptionDelta(let delta, let itemID):
            if itemID != userItemID {
                user = ""
                assistant = ""
                userItemID = itemID
            }
            user += delta
        case .transcriptionCompleted(let transcript, let itemID):
            user = transcript
            userItemID = itemID
        case .responseCreated:
            assistant = ""
        case .assistantTranscriptDelta(let delta):
            assistant += delta
        default:
            break
        }
    }
}
