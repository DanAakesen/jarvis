import XCTest
@testable import JarvisCore

final class JarvisOrbTests: XCTestCase {
    func testAppearanceKeepsOrangeCoreAndRestrainedGlow() {
        XCTAssertEqual(JarvisOrbAppearance.warm.r, 1)
        XCTAssertEqual(JarvisOrbAppearance.warm.g, 135.0 / 255)
        XCTAssertEqual(JarvisOrbAppearance.warm.b, 56.0 / 255)
        XCTAssertEqual(JarvisOrbAppearance.glowRadius, 0.52)
        XCTAssertEqual(JarvisOrbAppearance.glowOpacity, 0.12)
    }

    func testReducedMotionKeepsStateWithoutAudioOrSurge() {
        var motion = JarvisOrbMotion()
        let frame = motion.step(delta: 1, JarvisOrbMotionInput(
            awake: 1, state: .listening, playback: 1, input: 1, reducedMotion: true
        ))
        XCTAssertEqual(frame.listen, 1)
        XCTAssertEqual(frame.input, 0)
        XCTAssertEqual(frame.speech, 0)
        XCTAssertEqual(frame.surge, 0)
        XCTAssertEqual(frame.waveStrength, 0)
    }

    func testStateChangesCanReverseWithoutRestartingMotion() {
        var motion = JarvisOrbMotion()
        let listening = motion.step(delta: 0.1, JarvisOrbMotionInput(awake: 1, state: .listening))
        let thinking = motion.step(delta: 0.1, JarvisOrbMotionInput(awake: 1, state: .thinking))
        XCTAssertGreaterThan(thinking.listen, 0)
        XCTAssertLessThan(thinking.listen, listening.listen)
        XCTAssertGreaterThan(thinking.think, 0)
    }
}
