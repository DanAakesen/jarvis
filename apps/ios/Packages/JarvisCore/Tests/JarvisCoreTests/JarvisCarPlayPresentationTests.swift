import XCTest
@testable import JarvisCore

final class JarvisCarPlayPresentationTests: XCTestCase {
    private func indicator(_ state: VoiceSessionState, connection: VoiceConnectionPresentationState = .connected,
                           starting: Bool = false, muted: Bool = false, audioReady: Bool = true) -> String {
        JarvisCarPlayPresentation.indicator(state: state, connection: connection, starting: starting,
            muted: muted, audioReady: audioReady, signInRequired: false, microphoneDenied: false)
    }

    func testStartingAgainAfterEndAndExhaustedReconnect() {
        XCTAssertEqual(indicator(.ended, starting: true), "Connecting")
        XCTAssertEqual(indicator(.ended), "Ended")
        XCTAssertEqual(indicator(.reconnecting(attempt: 3), connection: .lost), "Voice unavailable")
        XCTAssertEqual(indicator(.connecting, connection: .retrying), "Reconnecting")
    }

    func testLiveSessionReflectsCaptureAndPlayback() {
        XCTAssertEqual(indicator(.listening, audioReady: false), "Connecting")
        XCTAssertEqual(indicator(.listening), "Listening")
        XCTAssertEqual(indicator(.thinking), "Thinking")
        XCTAssertEqual(indicator(.speaking), "Speaking")
        XCTAssertEqual(indicator(.listening, muted: true), "Muted")
    }

    func testNoteExpansionSkipsVaultMetadataAndWrapsItsBody() {
        let text = "---\nprivate: metadata\n---\n# Workshop\nBring the board and the drawings to the workshop. Check the measurements."
        let lines = JarvisCarPlayPresentation.noteExcerpt(text)
        XCTAssertGreaterThan(lines.count, 1)
        XCTAssertEqual(lines.joined(separator: " "), "Bring the board and the drawings to the workshop. Check the measurements.")
        XCTAssertEqual(JarvisCarPlayPresentation.noteExcerpt(""), ["Empty note"])
    }
}
