import Foundation

public enum VoiceAudioFormat {
    public static let sampleRate = 24_000
    public static let channels = 1
    public static let bitsPerSample = 16
}

public enum VoiceAudioError: Error, Equatable, Sendable {
    case emptyChunk
    case chunkTooLarge
    case misalignedPCM16
    case invalidBase64
}

public enum VoiceAudioCodec {
    public static let maximumChunkBytes = 256_000

    public static func encodePCM16(_ bytes: Data) throws -> String {
        guard !bytes.isEmpty else { throw VoiceAudioError.emptyChunk }
        guard bytes.count <= maximumChunkBytes else { throw VoiceAudioError.chunkTooLarge }
        guard bytes.count.isMultiple(of: 2) else { throw VoiceAudioError.misalignedPCM16 }
        return bytes.base64EncodedString()
    }

    public static func decodePCM16(_ base64: String) throws -> Data {
        guard !base64.isEmpty else { throw VoiceAudioError.emptyChunk }
        let maximumEncodedBytes = ((maximumChunkBytes + 2) / 3) * 4
        guard base64.utf8.count <= maximumEncodedBytes else { throw VoiceAudioError.chunkTooLarge }
        guard let bytes = Data(base64Encoded: base64), !bytes.isEmpty else {
            throw VoiceAudioError.invalidBase64
        }
        guard bytes.count <= maximumChunkBytes else { throw VoiceAudioError.chunkTooLarge }
        guard bytes.count.isMultiple(of: 2) else { throw VoiceAudioError.misalignedPCM16 }
        return bytes
    }
}
