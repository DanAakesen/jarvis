import ActivityKit
import Foundation
import JarvisCore

struct VoiceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: VoiceLiveActivityPhase
        var isMuted: Bool
        var waveform: [Double]
    }

    let sessionID: UUID
    let startedAt: Date

    var appLanguage: JarvisAppLanguage { .default }
}
