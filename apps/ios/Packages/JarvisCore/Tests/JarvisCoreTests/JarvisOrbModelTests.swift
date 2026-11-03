import XCTest
@testable import JarvisCore

final class JarvisOrbModelTests: XCTestCase {
    func testGeometryIsTheWebOrbsSeededConstruction() {
        let geometry = JarvisOrbGeometry.shell
        XCTAssertEqual(geometry.nodes.count, 64)
        XCTAssertEqual(geometry.links.count, 64)
        XCTAssertEqual(geometry.sparks.count, 220)
        XCTAssertEqual(geometry.motes.count, 460)
        XCTAssertEqual(geometry.ribbons.count, 9)
        XCTAssertEqual(geometry.ribbons.filter(\.isWide).count, 6)
        // Park–Miller with seed 71: the first draw is 71 * 16807 / (2^31 - 1), so node 0 sits at radius 0.17 + 0.22 * that.
        let first = Double(71 * 16807) / 2_147_483_647
        let radius = 0.17 + first * 0.22
        let ring = (1 - pow(1 - 2 * 0.5 / 64, 2)).squareRoot()
        XCTAssertEqual(geometry.nodes[0].x, cos(0) * ring * radius - 0.055, accuracy: 1e-9)
        XCTAssertEqual(geometry.nodes[0].y, (1 - 2 * 0.5 / 64) * radius * 0.84, accuracy: 1e-9)
        XCTAssertTrue(geometry.nodes.allSatisfy { $0.length < 0.5 }, "The core stays inside the shell")
        XCTAssertTrue(geometry.links.allSatisfy { $0.from != $0.to })
    }

    func testOrbWakesOverTheWebWakeDurationAndSleepsAgain() {
        var motion = JarvisOrbMotion()
        var frame = motion.step(delta: 0, JarvisOrbMotionInput(awake: 0, state: .idle))
        XCTAssertEqual(frame.awake, 0)
        for _ in 0..<30 { frame = motion.step(delta: 0.05, JarvisOrbMotionInput(awake: 1, state: .listening, input: 0.5)) }
        XCTAssertEqual(frame.awake, 1, accuracy: 1e-9, "Awake after 1.5 s, more than the 1.05 s wake duration")
        XCTAssertGreaterThan(frame.listen, 0.9)
        for _ in 0..<20 { frame = motion.step(delta: 0.05, JarvisOrbMotionInput(awake: 0, state: .idle)) }
        XCTAssertEqual(frame.awake, 0, accuracy: 1e-9)
        XCTAssertLessThan(frame.listen, 0.05)
    }

    func testReducedMotionSettlesImmediatelyWithoutSurges() {
        var motion = JarvisOrbMotion()
        let frame = motion.step(delta: 0.016, JarvisOrbMotionInput(awake: 1, state: .thinking, reducedMotion: true))
        XCTAssertEqual(frame.awake, 1)
        XCTAssertEqual(frame.think, 1)
        XCTAssertEqual(frame.surge, 0)
        XCTAssertEqual(frame.waveStrength, 0)
    }

    func testTheCoreFlowsAndTheStillPoseDoesNot() {
        var live = JarvisOrbAnimator()
        let first = live.advance(to: 0, activity: .calm, reducedMotion: false)
        let later = live.advance(to: 0.5, activity: .calm, reducedMotion: false)
        XCTAssertGreaterThan(later.coreFlow, first.coreFlow)
        XCTAssertGreaterThan(later.ribbonAngle, first.ribbonAngle)
        var still = JarvisOrbAnimator()
        let a = still.advance(to: 0, activity: .calm, reducedMotion: true)
        let b = still.advance(to: 3, activity: .calm, reducedMotion: true)
        XCTAssertEqual(a, b)
    }

    func testActivitiesMapOntoTheWebStates() {
        XCTAssertEqual(JarvisOrbActivity.listening.state, .listening)
        XCTAssertEqual(JarvisOrbActivity.speaking.state, .speaking)
        XCTAssertEqual(JarvisOrbActivity.thinking.state, .thinking)
        XCTAssertEqual(JarvisOrbActivity.idle.awake, 0)
        XCTAssertEqual(JarvisOrbActivity.offline.saturation, 0)
        XCTAssertEqual(JarvisOrbActivity.calm.saturation, 1)
    }

    func testEulerRotationMatchesThreeJsXYZOrder() {
        let turned = JarvisOrbVector(1, 0, 0).rotated(x: 0, y: 0, z: Double.pi / 2)
        XCTAssertEqual(turned.x, 0, accuracy: 1e-9)
        XCTAssertEqual(turned.y, 1, accuracy: 1e-9)
        let lifted = JarvisOrbVector(0, 0, 1).rotated(x: Double.pi / 2, y: 0, z: 0)
        XCTAssertEqual(lifted.y, -1, accuracy: 1e-9)
    }
}
