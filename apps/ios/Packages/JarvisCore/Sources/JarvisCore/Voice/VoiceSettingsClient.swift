import Foundation

public struct VoiceScreenFrame: Decodable, Equatable, Sendable {
    public let frameId: String
    public let capturedAt: String
    public let question: String?
    public let turnId: String?
}

public struct VoiceScreenInspection: Decodable, Equatable, Sendable {
    public let description: String
    public let capturedAt: String
    public let question: String?
    public let turnId: String?
}

public enum VoiceScreenSource: String, Codable, Equatable, Sendable {
    case camera
    case screen
}

public struct VoiceScreenContext: Equatable, Sendable {
    public let source: VoiceScreenSource
    public let capturedAt: String
    public let description: String?
    public let question: String?
    public let frameId: String?
    public let itemId: String?
    public let sharedWindowTitle: String?

    public init(
        source: VoiceScreenSource,
        capturedAt: String,
        description: String? = nil,
        question: String? = nil,
        frameId: String? = nil,
        itemId: String? = nil,
        sharedWindowTitle: String? = nil
    ) throws {
        guard Self.isValidCaptureDate(capturedAt),
              description.map({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.count <= 5_000 }) ?? true,
              question.map({ $0.count <= 500 }) ?? true,
              frameId.map(Self.isValidReference) ?? true,
              itemId.map(Self.isValidReference) ?? true,
              sharedWindowTitle.map({
                  !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                      $0.count <= 300 &&
                      !$0.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
              }) ?? true,
              description != nil || frameId != nil,
              source != .camera || (question != nil && itemId != nil) else {
            throw VoiceProtocolError.invalidScreenContext
        }
        self.source = source
        self.capturedAt = capturedAt
        self.description = description
        self.question = question
        self.frameId = frameId
        self.itemId = itemId
        self.sharedWindowTitle = sharedWindowTitle
    }

    private static func isValidReference(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil
    }

    static func isValidCaptureDate(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if formatter.date(from: value) != nil { return true }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value) != nil
    }
}

public enum VoiceScreenUnavailableReason: String, Codable, Equatable, Sendable {
    case frameRateLimited = "frame_rate_limited"
    case dailyLimit = "daily_limit"
    case budgetExhausted = "budget_exhausted"
    case budgetUnavailable = "budget_unavailable"
    case captureFailed = "capture_failed"
    case visionFailed = "vision_failed"
    case timeout
}

public extension JarvisClient {
    func voiceDefaultLanguage() async throws -> ChatLanguage {
        let response = try await performAuthenticatedRequest(
            method: .get,
            path: ["settings"],
            idempotent: true
        )
        let settings = try JSONDecoder().decode(VoiceSettingsEnvelope.self, from: response.body)
        return settings.settings.voice.defaultLanguage ?? .da
    }

    func uploadVoiceFrame(
        sessionId: String,
        jpeg: Data,
        question: String,
        turnId: String
    ) async throws -> VoiceScreenFrame {
        guard sessionId.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil,
              Self.validVoiceReference(turnId),
              !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              question.count <= 500,
              jpeg.count >= 4,
              jpeg.count <= 1_000_000,
              jpeg.starts(with: [0xff, 0xd8]),
              jpeg.suffix(2).elementsEqual([0xff, 0xd9]) else {
            throw JarvisClientError.invalidRequest
        }

        let body = try JSONEncoder().encode(VoiceFrameUploadRequest(
            sessionId: sessionId,
            frame: jpeg.base64EncodedString(),
            question: question,
            turnId: turnId,
            mode: "handle"
        ))
        let response = try await performAuthenticatedRequest(
            method: .post,
            path: ["screen", "frames"],
            body: body,
            idempotent: false
        )
        let frame: VoiceScreenFrame
        do {
            frame = try JSONDecoder().decode(VoiceScreenFrame.self, from: response.body)
        } catch {
            throw JarvisClientError.responseDecodingFailure
        }
        guard Self.validVoiceReference(frame.frameId),
              Self.validVoiceReference(frame.turnId ?? turnId),
              frame.turnId == nil || frame.turnId == turnId else {
            throw JarvisClientError.responseDecodingFailure
        }
        return frame
    }

    func inspectVoiceScreenFrame(sessionId: String, jpeg: Data) async throws -> VoiceScreenInspection {
        guard sessionId.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil,
              jpeg.count >= 4,
              jpeg.count <= 1_000_000,
              jpeg.starts(with: [0xff, 0xd8]),
              jpeg.suffix(2).elementsEqual([0xff, 0xd9]) else {
            throw JarvisClientError.invalidRequest
        }
        let body = try JSONEncoder().encode(VoiceFrameUploadRequest(
            sessionId: sessionId,
            frame: jpeg.base64EncodedString()
        ))
        let response = try await performAuthenticatedRequest(
            method: .post,
            path: ["screen", "frames"],
            body: body,
            idempotent: false
        )
        do {
            let inspection = try JSONDecoder().decode(VoiceScreenInspection.self, from: response.body)
            guard !inspection.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  inspection.description.count <= 5_000,
                  VoiceScreenContext.isValidCaptureDate(inspection.capturedAt) else {
                throw JarvisClientError.responseDecodingFailure
            }
            return inspection
        } catch let error as JarvisClientError {
            throw error
        } catch {
            throw JarvisClientError.responseDecodingFailure
        }
    }

    private static func validVoiceReference(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil
    }
}

private struct VoiceSettingsEnvelope: Decodable {
    let settings: Settings

    struct Settings: Decodable {
        let voice: Voice
    }

    struct Voice: Decodable {
        let defaultLanguage: ChatLanguage?
    }
}

private struct VoiceFrameUploadRequest: Encodable {
    let sessionId: String
    let frame: String
    let question: String?
    let turnId: String?
    let mode: String?

    init(sessionId: String, frame: String, question: String, turnId: String, mode: String) {
        self.sessionId = sessionId
        self.frame = frame
        self.question = question
        self.turnId = turnId
        self.mode = mode
    }

    init(sessionId: String, frame: String) {
        self.sessionId = sessionId
        self.frame = frame
        question = nil
        turnId = nil
        mode = nil
    }
}
