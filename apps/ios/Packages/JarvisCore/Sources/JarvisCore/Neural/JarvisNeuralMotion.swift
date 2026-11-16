import Foundation

/// How much the background moves. The same network everywhere; only the amount of life differs.
public enum JarvisNeuralEffects: Equatable, Sendable {
    /// Voice, chat and the opening: neurons fire out from the orb and return, following what Jarvis is doing.
    case full
    /// Every other screen: the same network with a few slow, faint signals.
    case calm
    /// One still pose: Reduce Motion, sheet backgrounds, previews.
    case still

    /// The Settings switch (General > Background motion): off draws the still pose everywhere.
    public static let motionEnabledKey = "jarvis.background.motion"

    var rateScale: Double { self == .full ? 1 : self == .calm ? 0.6 : 0 }
    var speedScale: Double { self == .full ? 1 : 0.55 }
    var brightness: Double { self == .full ? 1 : 0.55 }
    var maximumVolleys: Int { self == .full ? 9 : self == .calm ? 2 : 0 }
    var breathing: Double { self == .full ? 0.16 : self == .calm ? 0.1 : 0 }
}

/// One firing: a signal leaves the orb along a route to a node, lights it and comes back. While Jarvis listens the
/// signal runs the other way only: from the node into the orb.
public struct JarvisNeuralVolley: Equatable, Sendable {
    public var route: Int
    public var inbound: Bool
    /// Network time (`JarvisOrbFrame.flow`) at which it starts.
    public var start: Double
    /// Route-length units per second of network time.
    public var speed: Double
    public var strength: Double
    /// 0 cyan, 1 amber: tool work leans warm.
    public var warmth: Double

    static let dwell = 0.28
    static let returnSpeedRatio = 1.25
    /// How long a node keeps glowing after a signal has passed, in network seconds.
    static let afterglow = 2.4

    func outDuration(_ length: Double) -> Double { inbound ? 0 : length / speed }
    func returnDuration(_ length: Double) -> Double { length / (speed * (inbound ? 1 : Self.returnSpeedRatio)) }
    func travelEnd(_ length: Double) -> Double {
        start + outDuration(length) + (inbound ? 0 : Self.dwell) + returnDuration(length)
    }
    func end(_ length: Double) -> Double { travelEnd(length) + Self.afterglow }
}

public struct JarvisNeuralFrame: Equatable, Sendable {
    public var time: Double
    public var flow: Double
    public var volleys: [JarvisNeuralVolley]
    /// 0–1, the whole network's lift from what Jarvis is doing.
    public var energy: Double
    /// How strongly nodes breathe, 0 for none.
    public var breathing: Double
    /// Muted, reconnecting and offline lose colour, as the orb does.
    public var saturation: Double
}

/// Drives the background's neurons from the orb's own state and level contracts. It runs the same orb motion model
/// as `JarvisLatticeOrbView`, so a background and an orb given the same activity move together, and a change of
/// state eases instead of snapping. Signals are spawned deterministically (fixed seed), never from the microphone.
public struct JarvisNeuralAnimator: Sendable {
    /// The pose a still background is drawn in.
    public static let stillTime = JarvisOrbAnimator.stillTime
    public static let stillFlow = JarvisOrbAnimator.stillFlow

    private var orb = JarvisOrbAnimator()
    private var previous: Double?
    private var volleys: [JarvisNeuralVolley] = []
    private var untilNext = 0.35
    private var random: UInt64
    private var recent: [Int] = []
    private let network: JarvisNeuralNetwork

    public init(seed: UInt64 = 1892, network: JarvisNeuralNetwork = .shared) {
        random = seed &+ 0x9E37_79B9_7F4A_7C15
        self.network = network
    }

    private mutating func next() -> Double {
        random &+= 0x9E37_79B9_7F4A_7C15
        var z = random
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        z ^= z >> 31
        return Double(z >> 11) / Double(1 << 53)
    }

    /// Signals per second for the current state: a slow trickle at rest, quicker while thinking, quickest on tool
    /// work, and following the playback or microphone level while speaking or listening.
    static func rate(_ m: JarvisOrbMotionFrame) -> Double {
        let ease = { (w: Double) in w * w * (3 - 2 * w) }
        let think = ease(m.think), tool = ease(m.tool), speak = ease(m.speak), listen = ease(m.listen)
        return (0.08 + 0.2 * m.awake) + 1.5 * think + 2.4 * tool
            + speak * (0.5 + 1.6 * m.speech) + listen * (0.25 + 1.6 * m.input)
    }

    public mutating func advance(
        to time: Double, activity: JarvisOrbActivity, effects: JarvisNeuralEffects, reducedMotion: Bool
    ) -> JarvisNeuralFrame {
        let orbFrame = orb.advance(to: time, activity: activity, reducedMotion: reducedMotion)
        let m = orbFrame.motion
        let delta = previous.map { max(0, min(time - $0, 0.12)) } ?? 0
        previous = time
        let saturation = activity.saturation
        if reducedMotion || effects == .still {
            volleys = []
            return JarvisNeuralFrame(
                time: Self.stillTime, flow: Self.stillFlow, volleys: [], energy: 0, breathing: 0, saturation: saturation
            )
        }
        let flow = orbFrame.flow
        volleys.removeAll { flow > $0.end(network.routes[$0.route].length) }

        let ease = { (w: Double) in w * w * (3 - 2 * w) }
        let think = ease(m.think), tool = ease(m.tool), speak = ease(m.speak), listen = ease(m.listen)
        let rate = Self.rate(m) * effects.rateScale
        untilNext = min(untilNext - delta, 1.6 / max(rate, 0.05))
        if untilNext <= 0, volleys.count < effects.maximumVolleys {
            spawn(
                flow: flow, effects: effects, think: think, tool: tool, speak: speak, listen: listen, motion: m,
                allowsPair: max(think, tool) > 0.5
            )
            untilNext = (0.5 + next()) / max(rate, 0.05)
        }
        let energy = min(1, 0.25 * m.awake + 0.4 * max(think, tool) + 0.3 * speak * (0.4 + m.speech)
            + 0.3 * listen * (0.4 + m.input) + 0.1 * m.surge) * (effects == .full ? 1 : 0.4)
        return JarvisNeuralFrame(
            time: time, flow: flow, volleys: volleys, energy: energy, breathing: effects.breathing, saturation: saturation
        )
    }

    private mutating func spawn(
        flow: Double, effects: JarvisNeuralEffects, think: Double, tool: Double, speak: Double, listen: Double,
        motion m: JarvisOrbMotionFrame, allowsPair: Bool
    ) {
        let routes = network.routes
        guard !routes.isEmpty else { return }
        // Visible nodes are twice as likely as the off-screen anchors; never the last few routes again.
        var weights = routes.indices.map { index -> Double in
            if recent.contains(index) { return 0 }
            return network.nodes[routes[index].target].brightness > 0 ? 2 : 1
        }
        if weights.reduce(0, +) == 0 { weights = routes.map { _ in 1 } }
        var pick = next() * weights.reduce(0, +)
        var route = routes.count - 1
        for (index, weight) in weights.enumerated() {
            if pick < weight { route = index; break }
            pick -= weight
        }
        recent.append(route)
        if recent.count > 4 { recent.removeFirst() }

        let inbound = next() < listen * 0.85
        let level = speak * m.speech + listen * m.input
        let strength = min(1, (0.5 + 0.22 * think + 0.3 * tool + 0.4 * level + 0.15 * next()) * effects.brightness)
        let speed = 0.62 * effects.speedScale * (0.85 + 0.35 * next())
        let warmth = min(1, 0.08 + 0.7 * tool + 0.15 * think)
        volleys.append(JarvisNeuralVolley(
            route: route, inbound: inbound, start: flow, speed: speed, strength: strength, warmth: warmth
        ))
        // Busy work branches: a second signal follows on another route a beat later.
        if allowsPair, volleys.count < effects.maximumVolleys, next() < 0.4 {
            var other = (route + 1 + Int(next() * Double(routes.count - 1))) % routes.count
            if other == route { other = (route + 1) % routes.count }
            volleys.append(JarvisNeuralVolley(
                route: other, inbound: inbound, start: flow + 0.12 + 0.18 * next(), speed: speed * 1.1,
                strength: strength * 0.85, warmth: warmth
            ))
        }
    }
}
