import XCTest
@testable import JarvisCore

final class JarvisGraph3DTests: XCTestCase {
    private func node(_ id: String, _ folder: String, degree: Int = 0, tasks: Int? = nil) -> KnowledgeGraphNode {
        KnowledgeGraphNode(
            id: id, path: "\(folder)/\(id).md", title: id, folder: folder, directory: folder, updatedAt: "2026-11-16T10:00:00Z",
            degree: degree, openTaskCount: tasks
        )
    }

    private func edge(_ a: String, _ b: String, _ kind: KnowledgeGraphEdge.Kind = .link) -> KnowledgeGraphEdge {
        KnowledgeGraphEdge(source: a, target: b, type: kind, score: kind == .similar ? 0.8 : nil)
    }

    private func graph(_ nodes: [KnowledgeGraphNode], _ edges: [KnowledgeGraphEdge] = []) -> KnowledgeGraph {
        KnowledgeGraph(nodes: nodes, edges: edges, updatedAt: "2026-11-16T10:00:00Z", openTaskNoteCount: nil, taskCountsPartial: nil)
    }

    /// A vault-shaped graph: three folders, about three links per note.
    private func synthetic(_ count: Int) -> KnowledgeGraph {
        let folders = ["Work", "Personal", "General", "Work/Projects"]
        let nodes = (0..<count).map { node("note-\($0)", folders[$0 % folders.count], degree: 3, tasks: $0 % 7 == 0 ? 2 : 0) }
        let edges = (0..<count * 3).map { edge("note-\($0 % count)", "note-\(($0 * 7 + 3) % count)") }
        return graph(nodes, edges)
    }

    private let viewport = JarvisGraphViewport(width: 390, height: 520)

    // MARK: Layout

    func testLayoutGroupsRealNotesByTopLevelFolder() {
        let layout = JarvisGraphLayout.make(graph([
            node("a", "Work/Projects"), node("b", "Work"), node("c", "Personal"), node("d", "General"), node("e", ""),
        ]))
        XCTAssertEqual(layout.clusters.map(\.key), ["", "General", "Personal", "Work"])
        XCTAssertEqual(layout.clusters.map(\.scope), [.other, .general, .personal, .work])
        XCTAssertEqual(layout.clusters.first { $0.key == "Work" }?.count, 2)
        XCTAssertEqual(layout.nodes.count, 5)
        XCTAssertEqual(Set(layout.nodes.map(\.id)), ["a", "b", "c", "d", "e"])
    }

    func testLayoutIsRepeatableAndIgnoresTheOrderOfTheService() {
        let source = synthetic(120)
        let shuffled = graph(source.nodes.reversed(), source.edges.reversed())
        XCTAssertEqual(JarvisGraphLayout.make(source), JarvisGraphLayout.make(source))
        XCTAssertEqual(JarvisGraphLayout.make(source), JarvisGraphLayout.make(shuffled))
    }

    func testNotesStayInsideTheirCluster() {
        let layout = JarvisGraphLayout.make(synthetic(300))
        for node in layout.nodes {
            let cluster = layout.clusters[node.cluster]
            XCTAssertLessThanOrEqual((node.position - cluster.center).length, cluster.radius * 1.2)
            XCTAssertTrue(node.position.length.isFinite)
        }
        XCTAssertGreaterThan(layout.radius, 1)
    }

    func testEmptyOneAndTwoNoteGraphsHaveALayout() {
        XCTAssertEqual(JarvisGraphLayout.make(graph([])), .empty)
        let one = JarvisGraphLayout.make(graph([node("a", "Work")]))
        XCTAssertEqual(one.nodes.count, 1)
        XCTAssertEqual(one.clusters.count, 1)
        let two = JarvisGraphLayout.make(graph([node("a", "Work"), node("b", "Personal")], [edge("a", "b")]))
        XCTAssertEqual(two.edges.count, 1)
        XCTAssertGreaterThan((two.clusters[0].center - two.clusters[1].center).length, 1)
    }

    func testOnlyRealLinksSurvive() {
        let layout = JarvisGraphLayout.make(graph(
            [node("a", "Work"), node("b", "Work"), node("c", "Work")],
            [edge("a", "b", .similar), edge("b", "a", .link), edge("a", "a"), edge("a", "missing"), edge("b", "c", .similar)]
        ))
        XCTAssertEqual(layout.edges.count, 2)
        XCTAssertEqual(layout.edges.first { $0.source == 0 && $0.target == 1 }?.kind, .link)
        XCTAssertEqual(layout.edges.first { $0.source == 1 && $0.target == 2 }?.kind, .similar)
    }

    func testLayoutScalesToTheBackendLimit() {
        let start = Date()
        let layout = JarvisGraphLayout.make(synthetic(2_000))
        XCTAssertEqual(layout.nodes.count, 2_000)
        XCTAssertGreaterThan(layout.edges.count, 1_000)
        // Generous for an unoptimised test build; the release build is many times faster.
        XCTAssertLessThan(Date().timeIntervalSince(start), 8)
        let projector = JarvisGraphProjector(layoutRadius: layout.radius, camera: .home, viewport: viewport)
        let frameStart = Date()
        for step in 0..<20 { _ = projector.project(layout, time: Double(step) * 0.05, mode: .calm) }
        XCTAssertLessThan(Date().timeIntervalSince(frameStart) / 20, 0.1)
    }

    // MARK: Camera

    func testNearNotesDrawLargerAndBrighterThanFarOnes() {
        let layout = JarvisGraphLayout.make(graph([node("a", "Work"), node("b", "Work")]))
        let projector = JarvisGraphProjector(layoutRadius: 4, camera: JarvisGraphCamera(yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0), viewport: viewport)
        let near = projector.project(JarvisVec3(0, 0, -2))
        let far = projector.project(JarvisVec3(0, 0, 2))
        XCTAssertLessThan(near.depth, far.depth)
        XCTAssertGreaterThan(near.perspective, far.perspective)
        let projected = projector.project(layout)
        XCTAssertEqual(projected.count, 2)
        XCTAssertTrue(projected.allSatisfy { $0.radius >= JarvisGraphProjector.minimumRadius && $0.opacity >= JarvisGraphProjector.farOpacity })
    }

    func testTiltCannotFlipTheGraphOver() {
        let tilted = JarvisGraphCamera.home.orbited(yaw: 0, pitch: 9)
        XCTAssertEqual(tilted.pitch, JarvisGraphCamera.maximumPitch, accuracy: 1e-12)
        XCTAssertEqual(JarvisGraphCamera.home.orbited(yaw: 0, pitch: -9).pitch, -JarvisGraphCamera.maximumPitch, accuracy: 1e-12)
    }

    func testZoomKeepsThePointUnderTheFingers() {
        let camera = JarvisGraphCamera.home.panned(dx: 30, dy: -12)
        let projector = JarvisGraphProjector(layoutRadius: 5, camera: camera, viewport: viewport)
        let point = JarvisVec3(1, 0.5, -0.5)
        let before = projector.project(point)
        let zoomed = camera.zoomed(by: 2, anchorX: before.x, anchorY: before.y, in: viewport)
        let after = JarvisGraphProjector(layoutRadius: 5, camera: zoomed, viewport: viewport).project(point)
        XCTAssertEqual(zoomed.zoom, 2 * camera.zoom, accuracy: 1e-12)
        XCTAssertEqual(after.x, before.x, accuracy: 1e-9)
        XCTAssertEqual(after.y, before.y, accuracy: 1e-9)
        XCTAssertEqual(camera.zoomed(by: 100, anchorX: 0, anchorY: 0, in: viewport).zoom, JarvisGraphCamera.maximumZoom)
    }

    func testFramingBringsMatchesIntoView() {
        let layout = JarvisGraphLayout.make(synthetic(200))
        let wanted = [3, 40, 77]
        let camera = JarvisGraphCamera.home.framing(wanted, in: layout, viewport: viewport)
        let projector = JarvisGraphProjector(layoutRadius: layout.radius, camera: camera, viewport: viewport)
        XCTAssertGreaterThan(camera.zoom, 1)
        for index in wanted {
            let p = projector.project(layout.nodes[index].position)
            XCTAssertTrue((0...viewport.width).contains(p.x) && (0...viewport.height).contains(p.y))
        }
        XCTAssertEqual(JarvisGraphCamera.home.framing([], in: layout, viewport: viewport), .home)
    }

    func testSpinGlidesToAStopAndReduceMotionDoesNotGlide() {
        var controller = JarvisGraphCameraController()
        controller.release(yawVelocity: 2, pitchVelocity: 0, allowsInertia: true)
        XCTAssertTrue(controller.isMoving)
        let start = controller.camera.yaw
        for _ in 0..<400 { controller.advance(by: 1.0 / 60) }
        XCTAssertFalse(controller.isMoving)
        XCTAssertGreaterThan(controller.camera.yaw, start)

        var still = JarvisGraphCameraController()
        still.release(yawVelocity: 2, pitchVelocity: 1, allowsInertia: false)
        XCTAssertFalse(still.isMoving)
    }

    func testATouchDownStopsAGlideWhereItIs() {
        var controller = JarvisGraphCameraController()
        controller.release(yawVelocity: 3, pitchVelocity: 1, allowsInertia: true)
        controller.advance(by: 0.05)
        XCTAssertTrue(controller.isMoving)
        controller.beginInteraction()
        let held = controller.camera
        XCTAssertFalse(controller.isMoving)
        controller.advance(by: 0.5)
        XCTAssertEqual(controller.camera, held)
    }

    func testFlightEasesToItsTargetAndATouchTakesOver() {
        var controller = JarvisGraphCameraController()
        let target = JarvisGraphCamera(yaw: 1.2, pitch: 0.1, zoom: 2, panX: 40, panY: 10)
        controller.fly(to: target, animated: true)
        controller.advance(by: 0.1)
        XCTAssertNotEqual(controller.camera, target)
        XCTAssertTrue(controller.isMoving)
        controller.beginInteraction()
        let held = controller.camera
        controller.advance(by: 0.3)
        XCTAssertEqual(controller.camera, held)

        controller.fly(to: target, animated: true)
        for _ in 0..<60 { controller.advance(by: 0.02) }
        XCTAssertEqual(controller.camera, target)
        XCTAssertFalse(controller.isMoving)

        var cut = JarvisGraphCameraController()
        cut.fly(to: target, animated: false)
        XCTAssertEqual(cut.camera, target)
        XCTAssertFalse(cut.isMoving)
    }

    func testFlightTurnsTheShortWayRound() {
        var controller = JarvisGraphCameraController(camera: JarvisGraphCamera(yaw: 20, pitch: 0, zoom: 1, panX: 0, panY: 0))
        let target = JarvisGraphCamera.home
        controller.fly(to: target, animated: true)
        var travelled = 0.0
        var previous = controller.camera.yaw
        for _ in 0..<80 where controller.isMoving {
            controller.advance(by: 0.01)
            if controller.camera == target { break }
            travelled += abs(controller.camera.yaw - previous)
            previous = controller.camera.yaw
        }
        XCTAssertLessThanOrEqual(travelled, Double.pi + 1e-6)
        XCTAssertEqual(controller.camera, target)
    }

    // MARK: Life

    func testMotionModeFollowsReduceMotionSettingAndLowPower() {
        XCTAssertEqual(JarvisGraphMotionMode(reduceMotion: false, motionEnabled: true, lowPower: false), .calm)
        XCTAssertEqual(JarvisGraphMotionMode(reduceMotion: false, motionEnabled: true, lowPower: true), .cheap)
        XCTAssertEqual(JarvisGraphMotionMode(reduceMotion: true, motionEnabled: true, lowPower: false), .still)
        XCTAssertEqual(JarvisGraphMotionMode(reduceMotion: false, motionEnabled: false, lowPower: true), .still)
        XCTAssertNil(JarvisGraphMotionMode.still.idleFrameInterval)
    }

    func testDriftStaysSmallAndStillMeansStill() {
        let layout = JarvisGraphLayout.make(synthetic(60))
        let amplitude = JarvisGraphLife.driftAmplitude(layoutRadius: layout.radius)
        for node in layout.nodes {
            for time in stride(from: 0.0, to: 120, by: 7) {
                XCTAssertLessThanOrEqual(
                    JarvisGraphLife.drift(of: node, time: time, amplitude: amplitude, mode: .calm).length,
                    amplitude * 1.35 * 3.0.squareRoot() + 1e-9
                )
            }
            XCTAssertEqual(JarvisGraphLife.drift(of: node, time: 5, amplitude: amplitude, mode: .still), .zero)
            XCTAssertEqual(JarvisGraphLife.breath(of: node, time: 5, mode: .still), 1)
        }
        let projector = JarvisGraphProjector(layoutRadius: layout.radius, camera: .home, viewport: viewport)
        XCTAssertEqual(projector.project(layout, time: 3, mode: .still), projector.project(layout, time: 90, mode: .still))
    }

    func testPulsesRunOnRealLinksOnlyAndStayFew() {
        let layout = JarvisGraphLayout.make(synthetic(80))
        for (mode, limit) in [(JarvisGraphMotionMode.calm, 2), (.cheap, 1)] {
            let schedule = JarvisGraphPulseSchedule(layout: layout, mode: mode)
            var seen = 0
            for time in stride(from: 0.0, to: 90, by: 0.1) {
                let pulses = schedule.pulses(at: time)
                XCTAssertLessThanOrEqual(pulses.count, limit, "\(mode) at \(time)")
                seen += pulses.count
                for pulse in pulses {
                    let edge = layout.edges[pulse.edge]
                    XCTAssertEqual(edge.kind, .link)
                    XCTAssertEqual(Set([pulse.from, pulse.to]), Set([edge.source, edge.target]))
                    XCTAssertTrue((0...1).contains(pulse.progress))
                }
            }
            XCTAssertGreaterThan(seen, 0)
        }
        let still = JarvisGraphPulseSchedule(layout: layout, mode: .still)
        XCTAssertTrue(stride(from: 0.0, to: 30, by: 0.5).allSatisfy { still.pulses(at: $0).isEmpty && still.glows(at: $0).isEmpty })
    }

    func testPulsesNeedLinksAndSimilarityDoesNotPulse() {
        let lonely = JarvisGraphLayout.make(graph([node("a", "Work"), node("b", "Work")]))
        XCTAssertTrue(JarvisGraphPulseSchedule(layout: lonely, mode: .calm).pulses(at: 10).isEmpty)
        let similar = JarvisGraphLayout.make(graph([node("a", "Work"), node("b", "Work")], [edge("a", "b", .similar)]))
        let schedule = JarvisGraphPulseSchedule(layout: similar, mode: .calm)
        XCTAssertTrue(stride(from: 0.0, to: 30, by: 0.25).allSatisfy { schedule.pulses(at: $0).isEmpty })
    }

    func testArrivalLeavesAnAfterglowThatFades() {
        let layout = JarvisGraphLayout.make(synthetic(40))
        let schedule = JarvisGraphPulseSchedule(layout: layout, mode: .calm)
        let glows = stride(from: 0.0, to: 40, by: 0.1).flatMap { schedule.glows(at: $0) }
        XCTAssertFalse(glows.isEmpty)
        XCTAssertTrue(glows.allSatisfy { (0...1).contains($0.strength) && layout.nodes.indices.contains($0.node) })
    }

    func testSelectingSendsOnePulseToEachLinkedNeighbourOnce() {
        let layout = JarvisGraphLayout.make(graph(
            [node("a", "Work"), node("b", "Work"), node("c", "Work"), node("d", "Work")],
            [edge("a", "b"), edge("c", "a"), edge("b", "d"), edge("a", "d", .similar)]
        ))
        let pulses = JarvisGraphPulseSchedule.selectionPulses(layout: layout, selected: layout.indexByID["a"]!, elapsed: 0.5, mode: .calm)
        XCTAssertEqual(Set(pulses.map { layout.nodes[$0.to].id }), ["b", "c"])
        XCTAssertTrue(pulses.allSatisfy { layout.nodes[$0.from].id == "a" })
        XCTAssertTrue(JarvisGraphPulseSchedule.selectionPulses(layout: layout, selected: 0, elapsed: 5, mode: .calm).isEmpty)
        XCTAssertTrue(JarvisGraphPulseSchedule.selectionPulses(layout: layout, selected: 0, elapsed: 0.5, mode: .still).isEmpty)
    }

    // MARK: Selection

    func testOverlappingNotesAreAllSelectableByTappingAgain() {
        func projected(_ index: Int, x: Double, y: Double, depth: Double) -> JarvisGraphProjectedNode {
            JarvisGraphProjectedNode(index: index, x: x, y: y, depth: depth, radius: 4, opacity: 1)
        }
        let nodes = [
            projected(0, x: 100, y: 100, depth: 0.8), projected(1, x: 102, y: 101, depth: 0.1),
            projected(2, x: 99, y: 100, depth: 0.5), projected(3, x: 300, y: 300, depth: 0.1),
        ]
        let candidates = JarvisGraphHitTest.candidates(atX: 100, y: 100, in: nodes)
        XCTAssertEqual(candidates, [1, 2, 0])
        var selected = JarvisGraphHitTest.selection(afterTapWith: candidates, current: nil)
        XCTAssertEqual(selected, 1)
        selected = JarvisGraphHitTest.selection(afterTapWith: candidates, current: selected)
        XCTAssertEqual(selected, 2)
        selected = JarvisGraphHitTest.selection(afterTapWith: candidates, current: selected)
        XCTAssertEqual(selected, 0)
        XCTAssertEqual(JarvisGraphHitTest.selection(afterTapWith: candidates, current: selected), 1)
    }

    func testTapOnEmptySpaceClearsAndASingleNoteToggles() {
        let nodes = [JarvisGraphProjectedNode(index: 0, x: 50, y: 50, depth: 0.2, radius: 5, opacity: 1)]
        XCTAssertTrue(JarvisGraphHitTest.candidates(atX: 200, y: 200, in: nodes).isEmpty)
        XCTAssertNil(JarvisGraphHitTest.selection(afterTapWith: [], current: 0))
        let single = JarvisGraphHitTest.candidates(atX: 60, y: 55, in: nodes)
        XCTAssertEqual(single, [0])
        XCTAssertEqual(JarvisGraphHitTest.selection(afterTapWith: single, current: nil), 0)
        XCTAssertNil(JarvisGraphHitTest.selection(afterTapWith: single, current: 0))
    }

    func testSelectionAndSearchDecideWhatStandsOut() {
        let layout = JarvisGraphLayout.make(graph(
            [node("a", "Work"), node("b", "Work"), node("c", "Work"), node("d", "Work")], [edge("a", "b"), edge("c", "d")]
        ))
        let plain = JarvisGraphFocus(layout: layout, selected: nil, matches: [])
        XCTAssertFalse(plain.isFocused)
        XCTAssertTrue(plain.nodes.allSatisfy { $0 == .normal } && plain.edges.allSatisfy { $0 })

        let selected = JarvisGraphFocus(layout: layout, selected: layout.indexByID["a"], matches: [])
        XCTAssertEqual(selected.nodes[layout.indexByID["a"]!], .selected)
        XCTAssertEqual(selected.nodes[layout.indexByID["b"]!], .neighbour)
        XCTAssertEqual(selected.nodes[layout.indexByID["c"]!], .dimmed)
        XCTAssertEqual(selected.edges, [true, false])

        let searched = JarvisGraphFocus(layout: layout, selected: nil, matches: ["c", "unknown"])
        XCTAssertEqual(searched.nodes[layout.indexByID["c"]!], .matched)
        XCTAssertEqual(searched.nodes[layout.indexByID["a"]!], .dimmed)
        XCTAssertEqual(searched.edges, [false, true])
    }

    func testTaskSummaryNeverInventsACount() {
        XCTAssertEqual(JarvisGraphTaskSummary(openTaskCount: 2), .open(2))
        XCTAssertEqual(JarvisGraphTaskSummary(openTaskCount: 0), .none)
        XCTAssertEqual(JarvisGraphTaskSummary(openTaskCount: nil), .unavailable)
    }

    // MARK: Link lines and the selection pill

    func testLinksAreClearButNeverOutshineTheNotes() {
        func opacity(_ kind: KnowledgeGraphEdge.Kind, _ fade: Double = 1, focused: Bool = false, emphasised: Bool = false) -> Double {
            JarvisGraphLinkStyle.opacity(kind: kind, endpointOpacity: fade, isFocused: focused, isEmphasised: emphasised)
        }
        // Clearer than the 0.30 of build 112, and still well under a note's full strength.
        XCTAssertGreaterThan(opacity(.link), 0.30 * 1.5)
        XCTAssertLessThan(opacity(.link), 0.6)
        XCTAssertGreaterThan(opacity(.link), opacity(.similar))
        XCTAssertGreaterThan(opacity(.link), opacity(.link, JarvisGraphProjector.farOpacity))
        XCTAssertEqual(opacity(.link, focused: true, emphasised: true), JarvisGraphLinkStyle.ceiling)
        XCTAssertLessThan(opacity(.link, focused: true), opacity(.link) / 2)
        XCTAssertEqual(opacity(.link, 4), opacity(.link, 1))
        XCTAssertGreaterThan(JarvisGraphLinkStyle.emphasisedWidth, JarvisGraphLinkStyle.linkWidth)
        XCTAssertGreaterThan(JarvisGraphLinkStyle.linkWidth, JarvisGraphLinkStyle.similarWidth)
    }

    func testPillWrapsAtTheSceneWidthAndSitsAboveTheNote() {
        XCTAssertEqual(JarvisGraphPillPlacement.maximumWidth(sceneWidth: 390), JarvisGraphPillPlacement.widestPill)
        XCTAssertEqual(JarvisGraphPillPlacement.maximumWidth(sceneWidth: 200), 188)
        XCTAssertEqual(JarvisGraphPillPlacement.maximumWidth(sceneWidth: 4), 0)

        let centred = JarvisGraphPillPlacement.origin(
            noteX: 195, noteY: 300, noteRadius: 6, pillWidth: 120, pillHeight: 44, sceneWidth: 390, sceneHeight: 520
        )
        XCTAssertEqual(centred.x, 135, accuracy: 0.001)
        XCTAssertLessThan(centred.y + 44, 300 - 6 * 1.25, "A taller pill grows upwards and keeps clear of the note")
        let taller = JarvisGraphPillPlacement.origin(
            noteX: 195, noteY: 300, noteRadius: 6, pillWidth: 120, pillHeight: 26, sceneWidth: 390, sceneHeight: 520
        )
        XCTAssertEqual(taller.y + 26, centred.y + 44, accuracy: 0.001)
    }

    func testPillStaysInsideTheSceneAndDropsBelowAtTheTop() {
        let left = JarvisGraphPillPlacement.origin(
            noteX: 4, noteY: 300, noteRadius: 6, pillWidth: 280, pillHeight: 44, sceneWidth: 390, sceneHeight: 520
        )
        XCTAssertEqual(left.x, JarvisGraphPillPlacement.edgeMargin)
        let right = JarvisGraphPillPlacement.origin(
            noteX: 390, noteY: 300, noteRadius: 6, pillWidth: 280, pillHeight: 44, sceneWidth: 390, sceneHeight: 520
        )
        XCTAssertEqual(right.x, 390 - 280 - JarvisGraphPillPlacement.edgeMargin)

        let top = JarvisGraphPillPlacement.origin(
            noteX: 195, noteY: 30, noteRadius: 6, pillWidth: 200, pillHeight: 44, sceneWidth: 390, sceneHeight: 520
        )
        XCTAssertGreaterThan(top.y, 30, "No room above, so the pill sits under the note instead of covering it")
    }
}
