import Foundation

/// A transcription-only credential, delivered separately from cached Watch snapshots.
public struct WatchDictationCredential: Codable, Sendable {
    public let token: String
    public let expiresAt: String
    public let origin: URL

    public init(token: String, expiresAt: String, origin: URL) {
        self.token = token; self.expiresAt = expiresAt; self.origin = origin
    }

    public var expiration: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
    }

    public func isUsable(at now: Date = Date(), trustedOrigin: URL) -> Bool {
        guard Self.isTrustedOrigin(origin, matching: trustedOrigin),
              !token.isEmpty, token.utf8.count <= 512,
              token.unicodeScalars.allSatisfy({ (33...126).contains($0.value) }),
              let expiration, expiration.timeIntervalSince(now) > 15,
              expiration.timeIntervalSince(now) <= 86_400 else { return false }
        return true
    }

    public static func isTrustedOrigin(_ origin: URL, matching trusted: URL) -> Bool {
        guard let value = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let expected = URLComponents(url: trusted, resolvingAgainstBaseURL: false),
              value.scheme?.lowercased() == "https", expected.scheme?.lowercased() == "https",
              let host = value.host, !host.isEmpty, host.lowercased() == expected.host?.lowercased(),
              value.port == expected.port, value.user == nil, value.password == nil,
              value.query == nil, value.fragment == nil,
              expected.user == nil, expected.password == nil, expected.query == nil, expected.fragment == nil,
              ["", "/"].contains(value.path), ["", "/"].contains(expected.path) else { return false }
        return true
    }

    public func request(audio: Data, trustedOrigin: URL, now: Date = Date()) throws -> HTTPRequest {
        guard isUsable(at: now, trustedOrigin: trustedOrigin) else { throw WatchFailure.signInRequired }
        guard !audio.isEmpty, audio.count <= WatchLimits.dictationBytes, audio.count.isMultiple(of: 2) else {
            throw WatchFailure.invalidRequest
        }
        struct Body: Encodable { let audio: Data }
        return HTTPRequest(
            method: .post,
            url: origin.appendingPathComponent("voice/watch/transcribe"),
            headers: ["Authorization": ["Bearer", token].joined(separator: " "), "Content-Type": "application/json", "Cache-Control": "no-store"],
            body: try JSONEncoder().encode(Body(audio: audio)),
            timeout: WatchLimits.dictationRequestTimeout
        )
    }
}
