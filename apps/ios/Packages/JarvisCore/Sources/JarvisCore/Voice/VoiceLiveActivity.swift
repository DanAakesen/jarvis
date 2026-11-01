import Foundation

public enum VoiceLiveActivityPhase: String, Codable, CaseIterable, Sendable {
    case listening, speaking, muted, thinking, connecting, reconnecting

    public init(state: VoiceSessionState, isMuted: Bool) {
        if case .reconnecting = state {
            self = .reconnecting
        } else if state == .connecting {
            self = .connecting
        } else if isMuted {
            self = .muted
        } else {
            self = state == .speaking ? .speaking : state == .ready ? .thinking : .listening
        }
    }
}

public enum VoiceLiveActivityCopy: String, CaseIterable, Sendable {
    case title, listening, speaking, muted, thinking, connecting, reconnecting
    case mute, unmute, end, elapsed, waveform, unavailable, updateFailed

    public func text(language: JarvisAppLanguage = .default) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else { return rawValue }
        return bundle.localizedString(forKey: rawValue, value: rawValue, table: "VoiceLiveActivity")
    }
}

public enum VoiceLiveActivityCommand: Equatable, Sendable {
    case setMuted(Bool)
    case end
}

@MainActor
public protocol VoiceLiveActivityControlling: AnyObject {
    var liveActivitySessionID: UUID? { get }
    func performLiveActivityCommand(_ command: VoiceLiveActivityCommand) async throws
}

public enum VoiceLiveActivityError: Error, LocalizedError {
    case unavailable

    public var errorDescription: String? {
        let language = JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
        return VoiceLiveActivityCopy.unavailable.text(language: language)
    }
}

/// LiveActivityIntent runs in the app process and can only control its existing session.
@MainActor
public enum VoiceLiveActivityActions {
    public static weak var session: (any VoiceLiveActivityControlling)?

    public static func perform(sessionID: UUID, command: VoiceLiveActivityCommand) async throws {
        guard let session, session.liveActivitySessionID == sessionID else {
            throw VoiceLiveActivityError.unavailable
        }
        try await session.performLiveActivityCommand(command)
    }
}

public enum VoiceWaveform {
    public static let sampleCount = 26

    public static func level(pcm16: Data) -> Double {
        guard pcm16.count >= 2, pcm16.count.isMultiple(of: 2) else { return 0 }
        var sum = 0.0
        for offset in stride(from: 0, to: pcm16.count, by: 2) {
            let bits = UInt16(pcm16[offset]) | UInt16(pcm16[offset + 1]) << 8
            let sample = Double(Int16(bitPattern: bits)) / 32_768
            sum += sample * sample
        }
        return min(1, sqrt(sum / Double(pcm16.count / 2)) * 4)
    }
}
