import ActivityKit
import Foundation
import JarvisCore

struct VoiceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: VoiceLiveActivityPhase
        var isMuted: Bool
        var waveform: [Double]
        // Passed with each update because the Voice Activity has its own sandbox.
        var palette: JarvisPaletteSelection? = nil

        var appearance: JarvisPaletteSelection { palette ?? .standard }
    }

    let sessionID: UUID
    let startedAt: Date

    var appLanguage: JarvisAppLanguage { .default }
}
