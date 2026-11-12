import Foundation
import XCTest
@testable import JarvisCore

final class WatchDictationCredentialTests: XCTestCase {
    private let origin = URL(string: "https://api.example.invalid")!
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func credential(origin: URL? = nil, lifetime: TimeInterval = 900,
                            token: String = "opaque-fixture") -> WatchDictationCredential {
        WatchDictationCredential(token: token,
                                 expiresAt: ISO8601DateFormatter().string(from: now.addingTimeInterval(lifetime)),
                                 origin: origin ?? self.origin)
    }

    func testCredentialAcceptsOnlyPinnedHTTPSOrigin() {
        XCTAssertTrue(credential().isUsable(at: now, trustedOrigin: origin))
        for value in ["http://api.example.invalid", "https://other.invalid",
                      "https://user@api.example.invalid", "https://api.example.invalid:444",
                      "https://api.example.invalid/elsewhere", "https://api.example.invalid?redirect=1",
                      "https://api.example.invalid#fragment"] {
            XCTAssertFalse(credential(origin: URL(string: value)!).isUsable(at: now, trustedOrigin: origin), value)
        }
    }

    func testExpiryAndHeaderInjectionAreRejected() {
        for lifetime: TimeInterval in [-1, 0, 15, 86_401] {
            XCTAssertFalse(credential(lifetime: lifetime).isUsable(at: now, trustedOrigin: origin))
        }
        for token in ["", "token\r\nInjected: true", "a token", String(repeating: "x", count: 513)] {
            XCTAssertFalse(credential(token: token).isUsable(at: now, trustedOrigin: origin))
        }
        let value = WatchDictationCredential(token: "opaque-fixture", expiresAt: "not-a-date", origin: origin)
        XCTAssertFalse(value.isUsable(at: now, trustedOrigin: origin))
    }

    func testDirectRequestUsesOnlyScopedTokenAndBoundedPCMAudio() throws {
        let audio = Data([0, 1, 2, 3])
        let request = try credential().request(audio: audio, trustedOrigin: origin, now: now)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.absoluteString, "https://api.example.invalid/voice/watch/transcribe")
        XCTAssertEqual(request.headers["Authorization"], ["Bearer", "opaque-fixture"].joined(separator: " "))
        XCTAssertEqual(request.headers["Cache-Control"], "no-store")
        XCTAssertEqual(request.timeout, WatchLimits.dictationRequestTimeout)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.body)) as? [String: String])
        XCTAssertEqual(object, ["audio": audio.base64EncodedString()])
        for invalid in [Data(), Data([1]), Data(repeating: 0, count: WatchLimits.dictationBytes + 2)] {
            XCTAssertThrowsError(try credential().request(audio: invalid, trustedOrigin: origin, now: now))
        }
    }

    func testFractionalExpiryAndCredentialWireRoundTrip() throws {
        let value = WatchDictationCredential(token: "opaque-fixture", expiresAt: "2027-01-15T08:15:00.123Z", origin: origin)
        let decoded = try JSONDecoder().decode(WatchDictationCredential.self, from: JSONEncoder().encode(value))
        XCTAssertNotNil(decoded.expiration)
        XCTAssertEqual(decoded.token, value.token)
        XCTAssertEqual(decoded.origin, value.origin)
    }

    func testReloadNeverExtendsAbsolutePhoneIssuedExpiry() throws {
        let value = credential(lifetime: 900)
        let reloaded = try JSONDecoder().decode(WatchDictationCredential.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(reloaded.expiresAt, value.expiresAt)
        XCTAssertFalse(reloaded.isUsable(at: now.addingTimeInterval(901), trustedOrigin: origin))
        XCTAssertThrowsError(try reloaded.request(audio: Data([0, 0]), trustedOrigin: origin,
                                                  now: now.addingTimeInterval(901)))
    }

    func testPassiveDisconnectDoesNotInterruptDraftOrReplayAcknowledgedSend() {
        var composer = WatchComposer()
        composer.draft = "Keep this draft"
        XCTAssertFalse(composer.handleConnectionLoss(hasInFlightTurn: false, hasVoiceSession: false))
        XCTAssertEqual(composer.draft, "Keep this draft")
        XCTAssertNotNil(composer.beginSend())
        composer.finishSend(success: true)
        XCTAssertTrue(composer.handleConnectionLoss(hasInFlightTurn: true, hasVoiceSession: false))
        XCTAssertEqual(composer.draft, "")
        XCTAssertNil(composer.beginSend())
    }

    func testRecoveryErrorsDistinguishPhoneAuthenticationAndNetwork() {
        XCTAssertNotEqual(WatchFailure.unavailable.message, WatchFailure.signInRequired.message)
        XCTAssertNotEqual(WatchFailure.network.message, WatchFailure.unavailable.message)
        XCTAssertEqual(WatchFailure.signInRequired.message, "Sign in to Jarvis on your iPhone.")
    }
}
