import XCTest
@testable import JarvisCore

final class JarvisNeuralTests: XCTestCase {
    private let network = JarvisNeuralNetwork.shared

    private func run(
        _ activity: JarvisOrbActivity, effects: JarvisNeuralEffects, seconds: Double, reducedMotion: Bool = false
    ) -> [JarvisNeuralFrame] {
        var animator = JarvisNeuralAnimator()
        return stride(from: 0.0, through: seconds, by: 1.0 / 30).map {
            animator.advance(to: $0, activity: activity, effects: effects, reducedMotion: reducedMotion)
        }
    }

    /// Every volley that appears in a run, by start time.
    private func volleys(_ frames: [JarvisNeuralFrame]) -> [JarvisNeuralVolley] {
        var seen: [JarvisNeuralVolley] = []
        for volley in frames.flatMap(\.volleys) where !seen.contains(volley) { seen.append(volley) }
        return seen
    }

    func testEveryNodeIsReachableFromTheOrbAlongRealLinks() {
        XCTAssertEqual(Set(network.routes.map(\.target)).count, network.nodes.count - 1)
        for route in network.routes {
            XCTAssertEqual(route.nodes.first, network.orbAnchor)
            XCTAssertEqual(route.nodes.last, route.target)
            XCTAssertEqual(route.links.count, route.nodes.count - 1)
            for (index, link) in route.links.enumerated() {
                XCTAssertEqual(Set(network.links[link]), Set([route.nodes[index], route.nodes[index + 1]]))
            }
            XCTAssertEqual(route.length, route.segments.reduce(0, +), accuracy: 1e-12)
            XCTAssertGreaterThan(route.length, 0)
        }
    }

    func testTheSameRunGivesTheSameSignals() {
        let a = run(.thinking, effects: .full, seconds: 8)
        let b = run(.thinking, effects: .full, seconds: 8)
        XCTAssertEqual(a, b)
        XCTAssertFalse(volleys(a).isEmpty)
    }

    func testFiringFollowsWhatJarvisIsDoing() {
        func count(_ activity: JarvisOrbActivity) -> Int { volleys(run(activity, effects: .full, seconds: 40)).count }
        let calm = count(.calm), thinking = count(.thinking), tool = count(.tool), speaking = count(.speaking)
        XCTAssertGreaterThan(calm, 0, "even at rest the network is alive")
        XCTAssertGreaterThan(thinking, calm * 3)
        XCTAssertGreaterThan(tool, thinking)
        XCTAssertGreaterThan(speaking, calm * 2)
        XCTAssertLessThan(volleys(run(.offline, effects: .full, seconds: 400)).count, volleys(run(.calm, effects: .full, seconds: 400)).count, "an offline orb is quieter than a calm one")
    }

    func testListeningSignalsRunIntoTheOrbAndWorkSignalsRunOut() {
        let listening = volleys(run(.listening, effects: .full, seconds: 40))
        XCTAssertGreaterThan(listening.filter(\.inbound).count, listening.count * 6 / 10)
        let thinking = volleys(run(.thinking, effects: .full, seconds: 40))
        XCTAssertTrue(thinking.allSatisfy { !$0.inbound })
    }

    func testCalmHasMuchLessMotionButNotZero() {
        let layout = JarvisNeuralLayout(width: 393, height: 852)
        func pulseFrames(_ activity: JarvisOrbActivity, _ effects: JarvisNeuralEffects) -> Int {
            run(activity, effects: effects, seconds: 120).filter {
                !JarvisNeuralScene.make(layout: layout, frame: $0).pulses.isEmpty
            }.count
        }
        // Other screens are always calm: the same orb activity as an idle voice screen, with the calm effect level.
        let calm = pulseFrames(.calm, .calm)
        XCTAssertGreaterThan(calm, 0, "calm is not zero")
        XCTAssertLessThan(calm * 3, pulseFrames(.thinking, .full), "calm is much quieter than a thinking voice screen")
        let busy = volleys(run(.thinking, effects: .calm, seconds: 60)).count
        XCTAssertLessThan(busy, volleys(run(.thinking, effects: .full, seconds: 60)).count / 2)
        XCTAssertLessThanOrEqual(run(.thinking, effects: .calm, seconds: 60).map(\.volleys.count).max() ?? 0, 2)
    }

    func testStillAndReducedMotionFireNothingAndNeverMove() {
        for frames in [
            run(.thinking, effects: .still, seconds: 5),
            run(.speaking, effects: .full, seconds: 5, reducedMotion: true),
        ] {
            XCTAssertTrue(frames.allSatisfy { $0.volleys.isEmpty })
            XCTAssertEqual(Set(frames.map(\.time)).count, 1, "a still pose has one fixed time")
            let scene = JarvisNeuralScene.make(layout: JarvisNeuralLayout(width: 393, height: 852), frame: frames[0])
            XCTAssertTrue(scene.pulses.isEmpty && scene.flares.isEmpty)
        }
    }

    func testASignalLeavesTheOrbLightsItsNodeAndComesBack() {
        let route = network.routes.firstIndex { $0.nodes.count == 3 && network.nodes[$0.target].brightness > 0 }!
        let path = network.routes[route]
        let volley = JarvisNeuralVolley(route: route, inbound: false, start: 10, speed: 0.5, strength: 1, warmth: 0)
        let layout = JarvisNeuralLayout(width: 393, height: 852, orbRadius: 100)
        func scene(at flow: Double) -> JarvisNeuralScene {
            JarvisNeuralScene.make(layout: layout, frame: JarvisNeuralFrame(
                time: flow, flow: flow, volleys: [volley], energy: 0, breathing: 0, saturation: 1
            ))
        }
        let out = volley.outDuration(path.length)
        let orb = layout.point(of: network.orbAnchor)
        let target = layout.point(of: path.target)
        func gap(_ a: JarvisNeuralPoint, _ b: JarvisNeuralPoint) -> Double { ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)).squareRoot() }

        XCTAssertTrue(scene(at: 9.9).pulses.isEmpty, "nothing before it starts")
        let leaving = scene(at: 10 + out * 0.25).pulses[0].trail.last!
        let nearer = scene(at: 10 + out * 0.75).pulses[0].trail.last!
        XCTAssertLessThan(gap(leaving, orb), gap(nearer, orb), "moving away from the orb")
        XCTAssertLessThan(gap(scene(at: 10 + out * 0.99).pulses[0].trail.last!, target), 12)
        let lit = scene(at: 10 + out + 0.1)
        XCTAssertTrue(lit.pulses.isEmpty, "the signal rests at the node")
        XCTAssertGreaterThan(lit.nodeGlow[path.target], 0.3, "the node fires")
        let coming = scene(at: 10 + out + JarvisNeuralVolley.dwell + volley.returnDuration(path.length) * 0.5)
        XCTAssertEqual(coming.pulses.count, 1, "and the signal returns")
        XCTAssertLessThan(gap(coming.pulses[0].trail.last!, orb), gap(target, orb))
        XCTAssertGreaterThan(coming.pulses[0].warmth, 0.3, "returning signals run warmer")
        let arrived = scene(at: volley.travelEnd(path.length) + 0.05)
        XCTAssertFalse(arrived.flares.isEmpty, "the orb's edge flashes as it arrives")
        XCTAssertLessThan(scene(at: volley.end(path.length) + 1).nodeGlow[path.target], 0.01)
    }

    func testListeningSignalRunsFromTheNodeIntoTheOrb() {
        let route = network.routes.firstIndex { network.nodes[$0.target].brightness > 0 }!
        let path = network.routes[route]
        let volley = JarvisNeuralVolley(route: route, inbound: true, start: 0, speed: 0.5, strength: 1, warmth: 0)
        let layout = JarvisNeuralLayout(width: 393, height: 852)
        let early = JarvisNeuralScene.make(layout: layout, frame: JarvisNeuralFrame(
            time: 0.1, flow: 0.1, volleys: [volley], energy: 0, breathing: 0, saturation: 1
        ))
        let target = layout.point(of: path.target)
        let head = early.pulses[0].trail.last!
        XCTAssertLessThan(((head.x - target.x) * (head.x - target.x) + (head.y - target.y) * (head.y - target.y)).squareRoot(), 60)
    }

    func testStateChangesNeverMakeASignalVanishMidFlight() {
        var animator = JarvisNeuralAnimator()
        var previous: [JarvisNeuralVolley] = []
        for step in 0..<600 {
            let time = Double(step) / 30
            let activity: JarvisOrbActivity = step < 150 ? .thinking : step < 300 ? .calm : step < 450 ? .tool : .listening
            let frame = animator.advance(to: time, activity: activity, effects: .full, reducedMotion: false)
            for volley in previous where frame.flow < volley.end(network.routes[volley.route].length) {
                XCTAssertTrue(frame.volleys.contains(volley), "a signal dropped at \(time)")
            }
            previous = frame.volleys
        }
    }

    func testSceneStaysBoundedAndFinite() {
        let layout = JarvisNeuralLayout(width: 430, height: 932, orbX: 215, orbY: 360, orbRadius: 125)
        for activity in [JarvisOrbActivity.calm, .listening, .thinking, .tool, .speaking, .reconnecting] {
            for frame in run(activity, effects: .full, seconds: 20) {
                let scene = JarvisNeuralScene.make(layout: layout, frame: frame)
                XCTAssertEqual(scene.nodeGlow.count, network.nodes.count)
                XCTAssertEqual(scene.linkGlow.count, network.links.count)
                for value in scene.nodeGlow + scene.linkGlow { XCTAssertTrue((0...1).contains(value), "\(activity) \(value)") }
                for pulse in scene.pulses {
                    XCTAssertEqual(pulse.trail.count, JarvisNeuralScene.trailSteps)
                    XCTAssertTrue((0...1).contains(pulse.strength) && (0...1).contains(pulse.warmth))
                    for point in pulse.trail {
                        XCTAssertTrue(point.x.isFinite && point.y.isFinite)
                        XCTAssertTrue((-60...500).contains(point.x) && (-60...1_000).contains(point.y))
                    }
                }
                XCTAssertLessThanOrEqual(frame.volleys.count, JarvisNeuralEffects.full.maximumVolleys)
            }
        }
    }

    func testThinkingFiresFasterAndOrbActivitiesKeepTheirStates() {
        XCTAssertEqual(JarvisOrbActivity.tool.state, .tool)
        XCTAssertEqual(JarvisOrbActivity.tool.awake, 1)
        var motion = JarvisOrbMotion()
        var frame = JarvisOrbMotionFrame()
        for _ in 0..<60 { frame = motion.step(delta: 1.0 / 30, JarvisOrbMotionInput(awake: 1, state: .tool)) }
        XCTAssertGreaterThan(frame.tool, 0.9)
        var calm = JarvisOrbMotionFrame()
        var calmMotion = JarvisOrbMotion()
        for _ in 0..<60 { calm = calmMotion.step(delta: 1.0 / 30, JarvisOrbMotionInput(awake: 0.35, state: .idle)) }
        XCTAssertGreaterThan(JarvisNeuralAnimator.rate(frame), JarvisNeuralAnimator.rate(calm) * 10)
    }
}
