import XCTest
@testable import JarvisCore

final class JarvisOrbTests: XCTestCase {
    func testAppearanceUsesCyanGlassAndAmberCore() {
        XCTAssertEqual(JarvisOrbAppearance.cool.r, 0x52 / 255.0)
        XCTAssertEqual(JarvisOrbAppearance.warm.r, 1)
        XCTAssertEqual(JarvisOrbAppearance.warm.g, 0xa6 / 255.0)
        XCTAssertEqual(JarvisOrbAppearance.warm.b, 0x2e / 255.0)
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

    // MARK: Cognitive lattice

    private func frames(_ activity: JarvisOrbActivity, seconds: Double) -> [JarvisOrbFrame] {
        var animator = JarvisOrbAnimator()
        var result: [JarvisOrbFrame] = []
        var time = 0.0
        while time <= seconds {
            result.append(animator.advance(to: time, activity: activity, reducedMotion: false))
            time += 1.0 / 30
        }
        return result
    }

    func testLatticeIsOneConnectedNetwork() {
        let model = JarvisLatticeModel.shared
        XCTAssertEqual(model.nodes.count, JarvisLatticeModel.shellCount + JarvisLatticeModel.midCount + JarvisLatticeModel.coreCount)
        XCTAssertGreaterThan(model.edges.count, 900)
        var degree = [Int](repeating: 0, count: model.nodes.count)
        var pairs = Set<[Int]>()
        for edge in model.edges {
            XCTAssertLessThan(edge.a, edge.b)
            XCTAssertTrue(pairs.insert([edge.a, edge.b]).inserted, "duplicate connection")
            degree[edge.a] += 1
            degree[edge.b] += 1
        }
        XCTAssertTrue(degree.allSatisfy { $0 >= 1 }, "a node has no connection")
        for ignition in model.ignitions {
            XCTAssertFalse(ignition.hops.contains(JarvisLatticeModel.unreachable), "network is split")
        }
        XCTAssertEqual(model.ignitions.count, 8)
    }

    func testSignalsRunInwardAlongExistingConnections() {
        let model = JarvisLatticeModel.shared
        XCTAssertGreaterThanOrEqual(model.routes.count, 18)
        for route in model.routes {
            XCTAssertEqual(model.nodes[route.nodes[0]].layer, .shell)
            XCTAssertEqual(route.edges.count, route.nodes.count - 1)
            for hop in route.edges.indices {
                let edge = model.edges[route.edges[hop]]
                let from = route.nodes[hop], to = route.nodes[hop + 1]
                XCTAssertEqual(Set([edge.a, edge.b]), Set([from, to]))
                XCTAssertEqual(route.forward[hop], edge.a == from)
                XCTAssertLessThan(model.nodes[to].radius, model.nodes[from].radius)
            }
        }
    }

    func testDetailLevelsKeepTheNetworkReadable() {
        let frame = frames(.calm, seconds: 1).last!
        let minimal = JarvisLatticeScene.make(frame: frame, detail: .minimal)
        let reduced = JarvisLatticeScene.make(frame: frame, detail: .reduced)
        let full = JarvisLatticeScene.make(frame: frame, detail: .full)
        XCTAssertGreaterThan(minimal.edges.count, 40)
        XCTAssertLessThan(minimal.edges.count, reduced.edges.count)
        XCTAssertLessThan(reduced.edges.count, full.edges.count)
        XCTAssertLessThan(minimal.dots.count, full.dots.count)
        XCTAssertEqual(JarvisLatticeDetail(points: 18), .minimal)
        XCTAssertEqual(JarvisLatticeDetail(points: 90), .reduced)
        XCTAssertEqual(JarvisLatticeDetail(points: 250), .full)
    }

    func testLatticeStaysInsideTheGlassInEveryState() {
        let activities: [JarvisOrbActivity] = [.idle, .calm, .listening, .thinking, .speaking, .signingIn]
        for activity in activities {
            for frame in frames(activity, seconds: 6) where Int(frame.time * 30) % 15 == 0 {
                let scene = JarvisLatticeScene.make(frame: frame)
                for dot in scene.dots + scene.signals {
                    XCTAssertLessThanOrEqual((dot.x * dot.x + dot.y * dot.y).squareRoot(), 1.0, "\(activity) at \(frame.time)")
                }
                for edge in scene.edges {
                    XCTAssertLessThanOrEqual((edge.ax * edge.ax + edge.ay * edge.ay).squareRoot(), 1.0)
                    XCTAssertLessThanOrEqual((edge.cx * edge.cx + edge.cy * edge.cy).squareRoot(), 1.0)
                }
            }
        }
    }

    func testHeartPulsesEveryFastSixteenthOfASecondCycle() {
        XCTAssertEqual(JarvisLatticeModel.pulsePeriod, 1.6)
        for time in stride(from: 0.0, to: 1.6, by: 0.1) {
            XCTAssertEqual(JarvisLatticeScene.pulse(at: time), JarvisLatticeScene.pulse(at: time + 1.6), accuracy: 1e-9)
            XCTAssertEqual(JarvisLatticeScene.pulse(at: time), JarvisLatticeScene.pulse(at: time + 4.8), accuracy: 1e-9)
        }
        let peak = stride(from: 0.0, to: 1.6, by: 0.02).map(JarvisLatticeScene.pulse(at:)).max()!
        let rest = JarvisLatticeScene.pulse(at: 1.2)
        XCTAssertGreaterThan(peak, 0.9)
        XCTAssertLessThan(rest, 0.2)
    }

    func testMotionIsSmoothAndTheOuterGlassStaysSteady() {
        let run = frames(.calm, seconds: 10)
        var previous = JarvisLatticeScene.make(frame: run[0])
        for frame in run.dropFirst() {
            let scene = JarvisLatticeScene.make(frame: frame)
            XCTAssertEqual(scene.dots.count, previous.dots.count)
            XCTAssertEqual(scene.edges.count, previous.edges.count)
            for (now, before) in zip(scene.dots, previous.dots) {
                XCTAssertLessThan(abs(now.x - before.x) + abs(now.y - before.y), 0.012, "a node jumped")
            }
            previous = scene
        }
        // Listening opens the lattice and thinking draws it in, but shell nodes (the first dots) hardly move.
        let listening = JarvisLatticeScene.make(frame: frames(.listening, seconds: 4).last!)
        let thinking = JarvisLatticeScene.make(frame: frames(.thinking, seconds: 4).last!)
        let shell = JarvisLatticeModel.shared.nodes.indices.filter { JarvisLatticeModel.shared.nodes[$0].layer == .shell }
        for index in shell.prefix(JarvisLatticeModel.shellCount) {
            let a = listening.dots[index], b = thinking.dots[index]
            XCTAssertLessThan(abs(a.x - b.x) + abs(a.y - b.y), 0.08)
        }
        let coreIndex = JarvisLatticeModel.shared.coreNodes[0]
        let open = listening.dots[coreIndex], tight = thinking.dots[coreIndex]
        XCTAssertGreaterThan((open.x * open.x + open.y * open.y).squareRoot(), (tight.x * tight.x + tight.y * tight.y).squareRoot())
    }

    func testStateChangeMidSequenceDoesNotJumpTheNetwork() {
        var animator = JarvisOrbAnimator()
        var previous: JarvisLatticeScene?
        var time = 0.0
        for step in 0..<240 {
            let activity: JarvisOrbActivity = step < 90 ? .listening : step < 150 ? .thinking : .speaking
            let frame = animator.advance(to: time, activity: activity, reducedMotion: false)
            let scene = JarvisLatticeScene.make(frame: frame)
            if let previous {
                for (now, before) in zip(scene.dots, previous.dots) {
                    XCTAssertLessThan(abs(now.x - before.x) + abs(now.y - before.y), 0.06, "step \(step)")
                }
            }
            previous = scene
            time += 1.0 / 30
        }
    }

    func testReducedMotionDrawsOneStillPose() {
        var first = JarvisOrbAnimator(), second = JarvisOrbAnimator()
        let a = first.advance(to: 0.5, activity: .thinking, reducedMotion: true)
        let b = second.advance(to: 9, activity: .thinking, reducedMotion: true)
        XCTAssertEqual(a, b)
        let sceneA = JarvisLatticeScene.make(frame: a), sceneB = JarvisLatticeScene.make(frame: b)
        XCTAssertEqual(sceneA.edges.count, sceneB.edges.count)
        XCTAssertEqual(sceneA.heart.x, sceneB.heart.x)
    }

    func testSignalsSpeedUpWhileThinkingWithoutJumping() {
        var calm = JarvisOrbAnimator(), busy = JarvisOrbAnimator()
        var calmFlow = 0.0, busyFlow = 0.0
        var time = 0.0
        for _ in 0..<150 {
            calmFlow = calm.advance(to: time, activity: .calm, reducedMotion: false).flow
            busyFlow = busy.advance(to: time, activity: .thinking, reducedMotion: false).flow
            time += 1.0 / 30
        }
        XCTAssertGreaterThan(busyFlow, calmFlow * 1.4)
    }

    func testLiveActivityAndWatchStatusMapToOrbActivities() {
        XCTAssertEqual(JarvisOrbActivity(livePhase: .muted), .muted)
        XCTAssertEqual(JarvisOrbActivity(livePhase: .connecting), .calm)
        XCTAssertEqual(JarvisOrbActivity(livePhase: .thinking).state, .thinking)
        XCTAssertEqual(JarvisOrbActivity(watchVoiceStatus: "Listening", isMuted: false), .listening)
        XCTAssertEqual(JarvisOrbActivity(watchVoiceStatus: "Listening", isMuted: true), .muted)
        XCTAssertEqual(JarvisOrbActivity(watchVoiceStatus: "Speaking", isMuted: false), .speaking)
        XCTAssertEqual(JarvisOrbActivity(watchVoiceStatus: "Thinking", isMuted: false), .thinking)
        XCTAssertEqual(JarvisOrbActivity(watchVoiceStatus: "Connecting", isMuted: false), .calm)
        XCTAssertEqual(JarvisOrbActivity(watchVoiceStatus: "Disconnected", isMuted: true), .offline)
    }
}
