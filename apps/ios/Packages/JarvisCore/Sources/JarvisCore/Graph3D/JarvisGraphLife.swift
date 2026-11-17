import Foundation

/// How much the graph moves. Calm is the default and stays small; the cheap path is for Low Power Mode and the
/// Simulator; still is Reduce Motion or Settings > General > Background motion switched off. There is no auto-rotation
/// in any mode: the camera moves only because the owner or an action moves it.
public enum JarvisGraphMotionMode: Equatable, Sendable {
    case calm
    case cheap
    case still

    public init(reduceMotion: Bool, motionEnabled: Bool, lowPower: Bool) {
        if reduceMotion || !motionEnabled {
            self = .still
        } else if lowPower {
            self = .cheap
        } else {
            self = .calm
        }
    }

    /// Seconds between frames while nothing is being touched. Still draws only when the camera changes.
    public var idleFrameInterval: Double? {
        switch self {
        case .calm: 1.0 / 20.0
        case .cheap: 1.0 / 10.0
        case .still: nil
        }
    }

    public var drifts: Bool { self != .still }
    public var usesGlow: Bool { self == .calm }
    public var allowsInertia: Bool { self != .still }
    var driftSpeed: Double { self == .cheap ? 0.6 : 1 }
    var breathing: Double { self == .calm ? 0.1 : self == .cheap ? 0.05 : 0 }
    var maximumPulses: Int { self == .calm ? 2 : self == .cheap ? 1 : 0 }
    var pulseInterval: Double { self == .cheap ? 3.0 : 1.5 }
}

public struct JarvisGraphPulse: Equatable, Sendable {
    public let edge: Int
    public let from: Int
    public let to: Int
    /// 0 when it leaves `from`, 1 when it reaches `to`.
    public let progress: Double
    public let strength: Double
}

public struct JarvisGraphGlow: Equatable, Sendable {
    public let node: Int
    public let strength: Double
}

/// The small, quiet life of the graph: drift, breathing and pulses along real links. All of it is a pure function of
/// time, so it needs no animation objects, can be tested and never runs while the graph is still.
public enum JarvisGraphLife {
    /// Drift stays about 3% of the graph's spread, never a visible change of shape.
    public static func driftAmplitude(layoutRadius: Double) -> Double { 0.03 * layoutRadius }

    public static func drift(
        of node: JarvisGraphLayout.Node, time: Double, amplitude: Double, mode: JarvisGraphMotionMode
    ) -> JarvisVec3 {
        guard mode.drifts else { return .zero }
        let t = time * mode.driftSpeed
        let p = node.phase
        // A soft swell passes slowly through the cloud, so neighbours rise and fall together a little.
        let swell = 1 + 0.35 * sin(0.25 * t - 0.6 * (node.position.x + node.position.z))
        let wobble = JarvisVec3(sin(0.31 * t + p.x), sin(0.43 * t + p.y), sin(0.37 * t + p.z))
        return wobble * (amplitude * swell)
    }

    /// A brightness factor around 1 that rises and falls slowly.
    public static func breath(of node: JarvisGraphLayout.Node, time: Double, mode: JarvisGraphMotionMode) -> Double {
        guard mode.breathing > 0 else { return 1 }
        return 1 + mode.breathing * sin(0.7 * time * mode.driftSpeed + node.phase.x)
    }
}

/// Quiet pulses that run along real links and leave a short afterglow on the note they reach. Slot `k` starts at a
/// fixed time and uses a hash of `k` to pick its link, so the schedule needs no state and repeats the same way.
public struct JarvisGraphPulseSchedule: Sendable {
    public static let travel = 2.4
    public static let afterglow = 2.4
    /// How long the one-off pulses sent out from a selected note take.
    public static let responseTravel = 1.4
    static let maximumResponsePulses = 8

    private let linkEdges: [Int]
    private let layout: JarvisGraphLayout
    private let mode: JarvisGraphMotionMode

    public init(layout: JarvisGraphLayout, mode: JarvisGraphMotionMode) {
        self.layout = layout
        self.mode = mode
        // Only explicit links carry pulses; similarity is never presented as a link.
        linkEdges = layout.edges.indices.filter { layout.edges[$0].kind == .link }
    }

    private struct Slot {
        let edge: Int
        let forward: Bool
        let elapsed: Double
    }

    private func slots(at time: Double) -> [Slot] {
        guard mode.maximumPulses > 0, !linkEdges.isEmpty, time >= 0 else { return [] }
        let interval = mode.pulseInterval
        let window = Self.travel + Self.afterglow
        let last = Int((time / interval).rounded(.down))
        let first = max(0, Int(((time - window) / interval).rounded(.down)) - 1)
        guard first <= last else { return [] }
        return (first...last).compactMap { k in
            let seed = JarvisGraphHash.mix(UInt64(k) &+ 0x51ED)
            let start = Double(k) * interval + JarvisGraphHash.unit(seed, 1) * 0.15 * interval
            let elapsed = time - start
            guard elapsed >= 0, elapsed < window else { return nil }
            let pick = Int(JarvisGraphHash.unit(seed, 2) * Double(linkEdges.count)) % linkEdges.count
            return Slot(edge: linkEdges[pick], forward: JarvisGraphHash.unit(seed, 3) < 0.5, elapsed: elapsed)
        }
    }

    /// Pulses on their way along a link.
    public func pulses(at time: Double) -> [JarvisGraphPulse] {
        slots(at: time).compactMap { slot in
            guard slot.elapsed < Self.travel else { return nil }
            let edge = layout.edges[slot.edge]
            return JarvisGraphPulse(
                edge: slot.edge, from: slot.forward ? edge.source : edge.target, to: slot.forward ? edge.target : edge.source,
                progress: slot.elapsed / Self.travel, strength: 0.9
            )
        }
    }

    /// Notes a pulse has just reached, fading out.
    public func glows(at time: Double) -> [JarvisGraphGlow] {
        slots(at: time).compactMap { slot in
            guard slot.elapsed >= Self.travel else { return nil }
            let edge = layout.edges[slot.edge]
            let fade = (slot.elapsed - Self.travel) / Self.afterglow
            return JarvisGraphGlow(node: slot.forward ? edge.target : edge.source, strength: 0.8 * exp(-3 * fade))
        }
    }

    /// One pulse from a selected note to each linked neighbour, once per selection. Empty when the graph is still.
    public static func selectionPulses(
        layout: JarvisGraphLayout, selected: Int, elapsed: Double, mode: JarvisGraphMotionMode
    ) -> [JarvisGraphPulse] {
        guard mode.maximumPulses > 0, elapsed >= 0, elapsed < responseTravel else { return [] }
        return layout.edges.indices.compactMap { index -> JarvisGraphPulse? in
            let edge = layout.edges[index]
            guard edge.kind == .link, edge.source == selected || edge.target == selected else { return nil }
            return JarvisGraphPulse(
                edge: index, from: selected, to: edge.source == selected ? edge.target : edge.source,
                progress: elapsed / responseTravel, strength: 1
            )
        }.prefix(maximumResponsePulses).map { $0 }
    }
}
