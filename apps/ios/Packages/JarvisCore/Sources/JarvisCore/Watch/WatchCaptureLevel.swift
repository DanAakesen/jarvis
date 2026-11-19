import Foundation

/// Tracks whether captured PCM16 audio carries any sound at all, so a deaf microphone is reported
/// instead of being uploaded and later shown as a timeout.
public struct WatchCaptureLevel: Equatable, Sendable {
    /// Peak amplitude (of 32 767) below which audio counts as digital silence, about -72 dBFS.
    /// A working microphone has a noise floor well above this.
    public static let silenceFloor = 8
    /// Live voice allows this much captured audio before it reports a deaf microphone (24 kHz mono).
    public static let liveListeningSamples = 24_000 * 10

    public private(set) var samples = 0
    public private(set) var peak = 0

    public init() {}

    /// Little-endian signed 16-bit samples; a trailing odd byte is ignored.
    public mutating func add(pcm data: Data) {
        let count = data.count / 2
        guard count > 0 else { return }
        data.withUnsafeBytes { raw in
            var localPeak = peak
            for index in 0..<count {
                let low = Int(raw[index * 2])
                let high = Int(Int8(bitPattern: raw[index * 2 + 1]))
                let magnitude = abs(high << 8 | low)
                if magnitude > localPeak { localPeak = magnitude }
            }
            peak = localPeak
        }
        samples += count
    }

    public var hasAudio: Bool { samples > 0 }
    public var isSilent: Bool { samples > 0 && peak < Self.silenceFloor }
    /// True once enough audio arrived to expect some sound from a working microphone.
    public var isDeaf: Bool { samples >= Self.liveListeningSamples && peak < Self.silenceFloor }
}

public enum WatchMicrophoneFailure: Error, Equatable, Sendable {
    case noAudio
    case silent

    public var message: String {
        switch self {
        case .noAudio: "The Watch microphone delivered no audio. Try again."
        case .silent: "Jarvis got no sound from the Watch microphone. Try again."
        }
    }
}
