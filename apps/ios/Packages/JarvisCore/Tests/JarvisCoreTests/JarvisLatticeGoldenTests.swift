import Foundation
import XCTest
@testable import JarvisCore

/// The web orb builds the same lattice from the same arithmetic. This file is the contract between the two:
/// `apps/web/src/jarvis-lattice.golden.json` holds the topology and two posed frames, and both platforms' tests
/// compare against it. Regenerate it only when the lattice is changed on purpose:
/// `JARVIS_WRITE_LATTICE_GOLDEN=1 swift test --filter JarvisLatticeGoldenTests`.
final class JarvisLatticeGoldenTests: XCTestCase {
    private static let goldenURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("web/src/jarvis-lattice.golden.json")

    private static let frames: [(name: String, detail: JarvisLatticeDetail, frame: JarvisOrbFrame)] = [
        ("steady", .full, JarvisOrbFrame(
            motion: JarvisOrbMotionFrame(awake: 0.8, ignite: 1, wave: 1, waveStrength: 0, surge: 0, listen: 0, think: 0,
                                         tool: 0, speak: 0, speech: 0, input: 0),
            time: 3.7, flow: 5.1)),
        ("speaking", .reduced, JarvisOrbFrame(
            motion: JarvisOrbMotionFrame(awake: 1, ignite: 1, wave: 0.6, waveStrength: 0.3, surge: 0.2, listen: 0.3, think: 0.4,
                                         tool: 0.2, speak: 0.7, speech: 0.6, input: 0.4),
            time: 8.35, flow: 11.9)),
    ]

    private func r(_ value: Double) -> Double { (value * 1_000_000).rounded() / 1_000_000 }

    private func document() -> [String: Any] {
        let model = JarvisLatticeModel.shared
        let modelJSON: [String: Any] = [
            "nodes": model.nodes.map { [r($0.position.x), r($0.position.y), r($0.position.z), Double($0.layer.rawValue),
                                          r($0.radius), Double($0.cluster), r($0.warmth), r($0.size), Double($0.rank), r($0.phase)] },
            "edges": model.edges.map { [Double($0.a), Double($0.b), r($0.bow), Double($0.rank)] },
            "clusters": model.clusters.map { [r($0.amplitude.x), r($0.amplitude.y), r($0.amplitude.z), r($0.speed.x),
                                              r($0.speed.y), r($0.speed.z), r($0.phase.x), r($0.phase.y), r($0.phase.z)] },
            "ignitions": model.ignitions.map { ["period": r($0.period), "offset": r($0.offset), "hops": $0.hops.map { Int($0) }] },
            "routes": model.routes.map { ["nodes": $0.nodes, "edges": $0.edges, "forward": $0.forward, "period": r($0.period),
                                          "offset": r($0.offset), "hopDuration": r($0.hopDuration)] },
        ]
        let scenes: [[String: Any]] = Self.frames.map { entry in
            let scene = JarvisLatticeScene.make(frame: entry.frame, detail: entry.detail)
            let m = entry.frame.motion
            return [
                "name": entry.name,
                "detail": entry.detail.rawValue,
                "time": entry.frame.time, "flow": entry.frame.flow,
                "motion": ["awake": m.awake, "ignite": m.ignite, "wave": m.wave, "waveStrength": m.waveStrength,
                           "surge": m.surge, "listen": m.listen, "think": m.think, "tool": m.tool, "speak": m.speak,
                           "speech": m.speech, "input": m.input],
                "edges": scene.edges.map { [r($0.ax), r($0.ay), r($0.cx), r($0.cy), r($0.bx), r($0.by), r($0.warmth), r($0.alpha), r($0.light)] },
                "dots": scene.dots.map { [r($0.x), r($0.y), r($0.radius), r($0.warmth), r($0.alpha), r($0.halo)] },
                "signals": scene.signals.map { [r($0.x), r($0.y), r($0.radius), r($0.warmth), r($0.alpha), r($0.halo)] },
                "heart": [r(scene.heart.x), r(scene.heart.y), r(scene.heart.radius), r(scene.heart.intensity), r(scene.heart.heat)],
                "outerGain": r(scene.outerGain),
            ]
        }
        return ["version": 1, "seed": JarvisLatticeModel.seed, "model": modelJSON, "scenes": scenes]
    }

    func testGoldenFileMatchesTheModel() throws {
        let fresh = document()
        if ProcessInfo.processInfo.environment["JARVIS_WRITE_LATTICE_GOLDEN"] == "1" {
            let data = try JSONSerialization.data(withJSONObject: fresh, options: [.sortedKeys])
            try data.write(to: Self.goldenURL)
        }
        let stored = try JSONSerialization.jsonObject(with: Data(contentsOf: Self.goldenURL))
        XCTAssertTrue(
            compare(stored, fresh as Any, path: "golden"),
            "jarvis-lattice.golden.json differs from the Swift lattice. Regenerate it on purpose, or fix the change."
        )
    }

    private func compare(_ a: Any, _ b: Any, path: String) -> Bool {
        switch (a, b) {
        case let (x as [String: Any], y as [String: Any]):
            guard Set(x.keys) == Set(y.keys) else { return false }
            return x.allSatisfy { compare($0.value, y[$0.key] as Any, path: path + "." + $0.key) }
        case let (x as [Any], y as [Any]):
            guard x.count == y.count else { return false }
            return zip(x, y).allSatisfy { compare($0, $1, path: path) }
        case let (x as NSNumber, y as NSNumber):
            return abs(x.doubleValue - y.doubleValue) < 2e-6
        case let (x as String, y as String):
            return x == y
        default:
            return false
        }
    }
}
