import XCTest
@testable import JarvisCore

final class JarvisOpeningTests: XCTestCase {
    func testProgressNeverInventsAFraction() {
        XCTAssertNil(JarvisOpeningProgress.indeterminate.fraction)
        XCTAssertNil(JarvisOpeningProgress.indeterminate.percent)
        XCTAssertEqual(JarvisOpeningProgress.measured(0.426).percent, 43)
        XCTAssertEqual(JarvisOpeningProgress.measured(7).fraction, 1)
        XCTAssertEqual(JarvisOpeningProgress.measured(-1).fraction, 0)
        XCTAssertEqual(JarvisOpeningProgress.measured(.nan).fraction, 0)
    }

    func testLayoutKeepsEverythingClearOnEveryPhone() {
        let phones: [(w: Double, h: Double, top: Double, bottom: Double)] = [
            (320, 568, 20, 0), (375, 667, 20, 0), (393, 852, 59, 34), (430, 932, 59, 34),
        ]
        for phone in phones {
            let layout = JarvisOpeningLayout(width: phone.w, height: phone.h, safeTop: phone.top, safeBottom: phone.bottom)
            let orbTop = layout.orbCenterY - layout.orbDiameter / 2
            let orbBottom = layout.orbCenterY + layout.orbDiameter / 2
            let wordmarkTop = layout.wordmarkCenterY - layout.wordmarkFontSize / 2
            let wordmarkBottom = layout.wordmarkCenterY + layout.wordmarkFontSize / 2
            let barTop = layout.barCenterY - layout.barHeight / 2
            let barBottom = layout.barCenterY + layout.barHeight / 2
            XCTAssertGreaterThanOrEqual(orbTop, phone.top + 16, "orb under the status bar on \(phone.w)")
            XCTAssertGreaterThanOrEqual(wordmarkTop - orbBottom, 16, "wordmark touches the orb on \(phone.w)")
            XCTAssertGreaterThanOrEqual(barTop - wordmarkBottom, 16, "bar touches the wordmark on \(phone.w)")
            XCTAssertLessThanOrEqual(barBottom, phone.h - phone.bottom - 16, "bar on the home indicator on \(phone.w)")
            XCTAssertEqual(layout.barWidth, phone.w * 0.4, accuracy: 1e-9)
            XCTAssertEqual(layout.barHeight, 3)
            XCTAssertLessThanOrEqual(layout.orbDiameter, phone.w * 0.6)
        }
    }

    func testBackgroundNetworkIsFixedSparseAndQuieterThanTheOrb() {
        let network = JarvisOpeningNetwork.shared
        let visible = network.nodes.filter { $0.brightness > 0 }
        XCTAssertGreaterThanOrEqual(visible.count, 6)
        XCTAssertLessThanOrEqual(visible.count, 10, "the background must stay sparse")
        XCTAssertLessThanOrEqual(network.links.count, 18)
        func behindOrb(_ x: Double, _ y: Double) -> Bool {
            let dx = x - 0.5, dy = (y - 0.39) * 1.6
            return (dx * dx + dy * dy).squareRoot() < 0.35
        }
        for node in visible {
            XCTAssertFalse(behindOrb(node.x, node.y), "a visible node behind the orb")
            XCTAssertTrue((0...1).contains(node.x) && (0...1).contains(node.y))
        }
        var linked = Set<Int>()
        for link in network.links {
            XCTAssertEqual(link.count, 2)
            XCTAssertLessThan(link[0], link[1])
            linked.formUnion(link)
        }
        XCTAssertEqual(linked.count, network.nodes.count, "an unlinked node")
        XCTAssertTrue(network.nodes.contains { $0.x < 0 || $0.x > 1 || $0.y < 0 || $0.y > 1 }, "lines must leave the screen")
        let passing = network.links.filter { link in
            let a = network.nodes[link[0]], b = network.nodes[link[1]]
            return (0...20).contains { step in
                let t = Double(step) / 20
                return behindOrb(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
            }
        }
        XCTAssertGreaterThanOrEqual(passing.count, 2, "some lines must run behind the orb")
    }

    func testOpeningIsColdStartOnlyAndEndsWhenReadyOrCapped() {
        typealias P = JarvisOpeningPolicy
        func visible(_ stage: P.Stage, cold: Bool = true, enabled: Bool = true, data: Bool = false, after: TimeInterval = 0) -> Bool {
            P.isVisible(enabled: enabled, coldStart: cold, stage: stage, dataReady: data, unlockedFor: after)
        }
        XCTAssertTrue(visible(.resolving))
        XCTAssertTrue(visible(.authenticating))
        XCTAssertTrue(visible(.unlocked))
        XCTAssertFalse(visible(.unlocked, data: true))
        XCTAssertTrue(visible(.unlocked, after: P.dataWait - 0.1))
        XCTAssertFalse(visible(.unlocked, after: P.dataWait))
        XCTAssertFalse(visible(.needsAttention), "sign-in and failures use the gate's own screens")
        XCTAssertFalse(visible(.resolving, cold: false), "a warm resume never shows it")
        XCTAssertFalse(visible(.unlocked, enabled: false), "the off switch wins")
    }
}
