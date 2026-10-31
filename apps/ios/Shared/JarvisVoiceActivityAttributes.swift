import ActivityKit
import Foundation

struct JarvisVoiceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        enum VoiceState: String, Codable, Hashable {
            case listening
            case speaking
        }

        var voiceState: VoiceState
        var isMuted: Bool
        var requestedMuted: Bool?
        var requestID: UUID?
    }

    let sessionID: UUID
    let startedAt: Date
    let language: String
}
