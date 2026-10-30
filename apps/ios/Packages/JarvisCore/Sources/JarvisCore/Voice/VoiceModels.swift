import Foundation

public enum VoiceEndpoint {
    public static let subprotocol = "jarvis.voice.v1"

    public static func url(baseURL: URL, language: ChatLanguage) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil else {
            throw JarvisClientError.invalidBaseURL
        }

        components.scheme = components.scheme?.lowercased() == "https" ? "wss" : "ws"
        let basePath = components.path.replacingOccurrences(
            of: "/+$",
            with: "",
            options: .regularExpression
        )
        components.path = "\(basePath)/voice\(language == .da ? "/da" : "")"
        guard let url = components.url else { throw JarvisClientError.invalidBaseURL }
        return url
    }
}

public enum VoiceClientMessage: Equatable, Sendable {
    case appendAudio(String)
    case microphoneActive
    case microphoneMuted
    case sessionEnd
    case cameraState(on: Bool)
    case playbackCompleted(responseID: String, audible: Bool)
    case screenContext(VoiceScreenContext)
    case screenContextUnavailable(itemID: String?, reason: VoiceScreenUnavailableReason?)

    public func jsonString() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(self)
        guard let result = String(data: data, encoding: .utf8) else {
            throw VoiceProtocolError.invalidJSON
        }
        return result
    }
}

extension VoiceClientMessage: Encodable {
    private enum CodingKeys: String, CodingKey {
        case type
        case audio
        case on
        case responseId
        case audible
        case source
        case capturedAt
        case description
        case question
        case frameId
        case itemId
        case sharedWindowTitle
        case reason
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .appendAudio(let audio):
            try container.encode("input_audio_buffer.append", forKey: .type)
            try container.encode(audio, forKey: .audio)
        case .microphoneActive:
            try container.encode("jarvis.microphone.active", forKey: .type)
        case .microphoneMuted:
            try container.encode("jarvis.microphone.muted", forKey: .type)
        case .sessionEnd:
            try container.encode("jarvis.session.end", forKey: .type)
        case .cameraState(let on):
            try container.encode("jarvis.camera.state", forKey: .type)
            try container.encode(on, forKey: .on)
        case .playbackCompleted(let responseID, let audible):
            try container.encode("jarvis.voice.playback.completed", forKey: .type)
            try container.encode(responseID, forKey: .responseId)
            try container.encode(audible, forKey: .audible)
        case .screenContext(let context):
            try container.encode("jarvis.screen.context", forKey: .type)
            try container.encode(context.source, forKey: .source)
            try container.encode(context.capturedAt, forKey: .capturedAt)
            try container.encodeIfPresent(context.description, forKey: .description)
            try container.encodeIfPresent(context.question, forKey: .question)
            try container.encodeIfPresent(context.frameId, forKey: .frameId)
            try container.encodeIfPresent(context.itemId, forKey: .itemId)
            try container.encodeIfPresent(context.sharedWindowTitle, forKey: .sharedWindowTitle)
        case .screenContextUnavailable(let itemID, let reason):
            try container.encode("jarvis.screen.context.unavailable", forKey: .type)
            try container.encodeIfPresent(itemID, forKey: .itemId)
            try container.encodeIfPresent(reason, forKey: .reason)
        }
    }
}

public enum VoiceServerMessage: Equatable, Sendable {
    case sessionReady(sessionID: UInt64)
    case sessionEnded
    case transcriptionCompleted(transcript: String, itemID: String?)
    case speechStarted
    case responseCreated(responseID: String?)
    case audioDelta(type: String, delta: String)
    case transcriptionDelta(transcript: String, itemID: String?)
    case assistantTranscriptDelta(String)
    case responseDone
    case responseCancelled
    case visualContext(itemID: String?, path: String, reason: String?)
    case screenContextUnavailable(itemID: String?, reason: String?)
    case unknown(type: String?, raw: String)

    public static func decode(_ raw: String) -> Self {
        let data = Data(raw.utf8)
        guard let object = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
                as? [String: Any],
              let type = object["type"] as? String else {
            return .unknown(type: nil, raw: raw)
        }

        switch type {
        case "jarvis.session.ready":
            guard let payload = try? JSONDecoder().decode(SessionReadyPayload.self, from: data),
                  payload.sessionID.value > 0 else {
                return .unknown(type: type, raw: raw)
            }
            return .sessionReady(sessionID: payload.sessionID.value)
        case "jarvis.session.ended":
            return .sessionEnded
        case "conversation.item.input_audio_transcription.completed":
            guard let payload = try? JSONDecoder().decode(TranscriptionPayload.self, from: data) else {
                return .unknown(type: type, raw: raw)
            }
            return .transcriptionCompleted(transcript: payload.transcript, itemID: payload.itemID)
        case "conversation.item.input_audio_transcription.delta":
            guard let payload = try? JSONDecoder().decode(TranscriptionPayload.self, from: data) else {
                return .unknown(type: type, raw: raw)
            }
            return .transcriptionDelta(transcript: payload.transcript, itemID: payload.itemID)
        case "input_audio_buffer.speech_started", "speech_started":
            return .speechStarted
        case "response.created":
            let payload = try? JSONDecoder().decode(ResponseCreatedPayload.self, from: data)
            return .responseCreated(responseID: payload?.response?.id)
        case "response.audio.delta", "response.output_audio.delta":
            guard let payload = try? JSONDecoder().decode(AudioDeltaPayload.self, from: data) else {
                return .unknown(type: type, raw: raw)
            }
            return .audioDelta(type: type, delta: payload.delta)
        case "response.audio_transcript.delta", "response.output_audio_transcript.delta":
            guard let payload = try? JSONDecoder().decode(TextDeltaPayload.self, from: data) else {
                return .unknown(type: type, raw: raw)
            }
            return .assistantTranscriptDelta(payload.delta)
        case "response.done":
            return .responseDone
        case "response.cancelled":
            return .responseCancelled
        case "jarvis.visual_context":
            guard let payload = try? JSONDecoder().decode(VisualContextPayload.self, from: data),
                  payload.visualPath == "image" || payload.visualPath == "caption" else {
                return .unknown(type: type, raw: raw)
            }
            return .visualContext(itemID: payload.itemID, path: payload.visualPath, reason: payload.visualReason)
        case "jarvis.screen.context.unavailable":
            let payload = try? JSONDecoder().decode(ScreenContextUnavailablePayload.self, from: data)
            return .screenContextUnavailable(itemID: payload?.itemID, reason: payload?.reason)
        default:
            return .unknown(type: type, raw: raw)
        }
    }
}

public enum VoiceProtocolError: Error, Equatable, Sendable {
    case invalidJSON
    case invalidToken
    case invalidState
    case invalidScreenContext
}

private struct SessionReadyPayload: Decodable {
    let sessionID: SessionID

    enum CodingKeys: String, CodingKey {
        case sessionID = "sessionId"
    }
}

private struct SessionID: Decodable {
    let value: UInt64

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(UInt64.self) {
            value = number
        } else {
            let string = try container.decode(String.self)
            guard let number = UInt64(string) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid session id")
            }
            value = number
        }
    }
}

private struct TranscriptionPayload: Decodable {
    let transcript: String
    let itemID: String?

    enum CodingKeys: String, CodingKey {
        case transcript
        case itemID = "item_id"
    }
}

private struct ResponseCreatedPayload: Decodable {
    let response: Response?

    struct Response: Decodable {
        let id: String?
    }
}

private struct AudioDeltaPayload: Decodable {
    let delta: String
}

private struct TextDeltaPayload: Decodable {
    let delta: String
}

private struct VisualContextPayload: Decodable {
    let itemID: String?
    let visualPath: String
    let visualReason: String?

    enum CodingKeys: String, CodingKey {
        case itemID = "itemId"
        case visualPath
        case visualReason
    }
}

private struct ScreenContextUnavailablePayload: Decodable {
    let itemID: String?
    let reason: String?

    enum CodingKeys: String, CodingKey {
        case itemID = "itemId"
        case reason
    }
}
