import Foundation

/// Where the network sits on one screen: its size, and the orb it fans out from. `orbRadius` is 0 when the screen
/// shows no orb; the network then fans out from the same place, with nothing cut out.
public struct JarvisNeuralLayout: Equatable, Sendable {
    public var width: Double
    public var height: Double
    public var orbX: Double
    public var orbY: Double
    public var orbRadius: Double

    public init(width: Double, height: Double, orbX: Double? = nil, orbY: Double? = nil, orbRadius: Double = 0) {
        self.width = max(1, width)
        self.height = max(1, height)
        self.orbX = orbX ?? self.width * JarvisNeuralNetwork.orbHome.x
        self.orbY = orbY ?? self.height * JarvisNeuralNetwork.orbHome.y
        self.orbRadius = max(0, orbRadius)
    }

    public func point(of index: Int, in network: JarvisNeuralNetwork = .shared) -> JarvisNeuralPoint {
        if index == network.orbAnchor { return JarvisNeuralPoint(x: orbX, y: orbY) }
        let node = network.nodes[index]
        return JarvisNeuralPoint(x: node.x * width, y: node.y * height)
    }
}

public struct JarvisNeuralPoint: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// One posed frame of the neurons: plain numbers in points, ready for any 2D painter. A pure function of the
/// network, the layout and the frame, so it is tested the same way on every platform.
public struct JarvisNeuralScene: Sendable {
    /// A signal: its head and the trail behind it, from the tail to the head.
    public struct Pulse: Equatable, Sendable {
        public var trail: [JarvisNeuralPoint]
        public var strength: Double
        public var warmth: Double
    }

    /// A soft flash where a signal leaves or reaches the orb's edge.
    public struct Flare: Equatable, Sendable {
        public var x: Double
        public var y: Double
        public var strength: Double
    }

    public var pulses: [Pulse] = []
    /// Extra brightness of each node (0–1) while signals pass and fade away, plus its slow breathing.
    public var nodeGlow: [Double] = []
    /// Extra brightness of each link (0–1) while signals run along it, plus the state's lift.
    public var linkGlow: [Double] = []
    public var flares: [Flare] = []

    static let trailSteps = 5
    static let trailLength = 0.2
    static let nodeFlash = 0.45
    static let linkFlash = 0.8
    static let flareFlash = 0.45

    public static func make(
        network: JarvisNeuralNetwork = .shared, layout: JarvisNeuralLayout, frame: JarvisNeuralFrame
    ) -> JarvisNeuralScene {
        var scene = JarvisNeuralScene()
        scene.nodeGlow = [Double](repeating: 0, count: network.nodes.count)
        scene.linkGlow = [Double](repeating: frame.energy * 0.22, count: network.links.count)
        for (index, node) in network.nodes.enumerated() where node.brightness > 0 && frame.breathing > 0 {
            let phase = Double(index) * 2.399
            let rate = 0.5 + 0.13 * Double(index % 5)
            scene.nodeGlow[index] = frame.breathing * (0.5 + 0.5 * sin(frame.time * rate + phase))
        }
        let anchor = layout.point(of: network.orbAnchor, in: network)
        for volley in frame.volleys where frame.flow >= volley.start {
            let route = network.routes[volley.route]
            scene.light(volley: volley, route: route, network: network, layout: layout, frame: frame)
            scene.addPulse(volley: volley, route: route, network: network, layout: layout, frame: frame)
            scene.addFlares(volley: volley, route: route, network: network, layout: layout, anchor: anchor, frame: frame)
        }
        return scene
    }

    /// The position `distance` along a route (0 at the orb), on this screen.
    static func position(
        _ distance: Double, route: JarvisNeuralNetwork.Route, network: JarvisNeuralNetwork, layout: JarvisNeuralLayout
    ) -> JarvisNeuralPoint {
        var travelled = 0.0
        let clamped = max(0, min(route.length, distance))
        for (index, length) in route.segments.enumerated() {
            if clamped <= travelled + length || index == route.segments.count - 1 {
                let t = length > 0 ? max(0, min(1, (clamped - travelled) / length)) : 0
                let a = layout.point(of: route.nodes[index], in: network)
                let b = layout.point(of: route.nodes[index + 1], in: network)
                return JarvisNeuralPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
            }
            travelled += length
        }
        return layout.point(of: route.nodes[0], in: network)
    }

    /// The moments (in network time) the signal reaches each node of the route, going out and coming back.
    private static func passings(_ volley: JarvisNeuralVolley, route: JarvisNeuralNetwork.Route) -> [(out: Double?, back: Double)] {
        var along = 0.0
        var result: [(out: Double?, back: Double)] = []
        for index in route.nodes.indices {
            let out = volley.inbound ? nil : volley.start + along / volley.speed
            let backStart = volley.start + volley.outDuration(route.length) + (volley.inbound ? 0 : JarvisNeuralVolley.dwell)
            let back = backStart + (route.length - along) / (volley.speed * (volley.inbound ? 1 : JarvisNeuralVolley.returnSpeedRatio))
            result.append((out, back))
            if index < route.segments.count { along += route.segments[index] }
        }
        return result
    }

    private static func fade(_ elapsed: Double, over seconds: Double) -> Double {
        elapsed < 0 ? 0 : (1 - exp(-elapsed * 24)) * exp(-elapsed / seconds)
    }

    private mutating func light(
        volley: JarvisNeuralVolley, route: JarvisNeuralNetwork.Route, network: JarvisNeuralNetwork,
        layout: JarvisNeuralLayout, frame: JarvisNeuralFrame
    ) {
        let times = Self.passings(volley, route: route)
        for (position, node) in route.nodes.enumerated() where network.nodes[node].brightness > 0 {
            let isTarget = position == route.nodes.count - 1
            var glow = 0.0
            if let out = times[position].out {
                glow = max(glow, Self.fade(frame.flow - out, over: isTarget ? 0.9 : 0.5) * (isTarget ? 1 : 0.7))
            }
            glow = max(glow, Self.fade(frame.flow - times[position].back, over: 0.45) * 0.55)
            if volley.inbound, isTarget { glow = max(glow, Self.fade(frame.flow - volley.start, over: 0.7)) }
            nodeGlow[node] = min(1, max(nodeGlow[node], glow * volley.strength * Self.nodeFlash * 2.2))
        }
        for (position, link) in route.links.enumerated() {
            let enter = times[position].out ?? times[position + 1].back
            let back = times[position + 1].back
            let glow = max(Self.fade(frame.flow - enter, over: 0.8), 0.7 * Self.fade(frame.flow - back, over: 0.6))
            linkGlow[link] = min(1, max(linkGlow[link], glow * volley.strength * Self.linkFlash))
        }
    }

    private mutating func addPulse(
        volley: JarvisNeuralVolley, route: JarvisNeuralNetwork.Route, network: JarvisNeuralNetwork,
        layout: JarvisNeuralLayout, frame: JarvisNeuralFrame
    ) {
        let elapsed = frame.flow - volley.start
        let outDuration = volley.outDuration(route.length)
        let returning: Bool
        let head: Double
        if !volley.inbound, elapsed < outDuration {
            returning = false
            head = elapsed * volley.speed
        } else {
            let since = elapsed - outDuration - (volley.inbound ? 0 : JarvisNeuralVolley.dwell)
            guard since >= 0 else { return }
            let ratio = volley.inbound ? 1 : JarvisNeuralVolley.returnSpeedRatio
            head = route.length - since * volley.speed * ratio
            guard head > 0 else { return }
            returning = true
        }
        let direction: Double = returning ? 1 : -1
        let trail = (0..<Self.trailSteps).reversed().map { step -> JarvisNeuralPoint in
            let distance = head + direction * Self.trailLength * Double(step) / Double(Self.trailSteps - 1)
            return Self.position(distance, route: route, network: network, layout: layout)
        }
        pulses.append(Pulse(trail: trail, strength: volley.strength, warmth: min(1, volley.warmth + (returning ? 0.35 : 0))))
    }

    private mutating func addFlares(
        volley: JarvisNeuralVolley, route: JarvisNeuralNetwork.Route, network: JarvisNeuralNetwork,
        layout: JarvisNeuralLayout, anchor: JarvisNeuralPoint, frame: JarvisNeuralFrame
    ) {
        guard layout.orbRadius > 0 else { return }
        let next = layout.point(of: route.nodes[1], in: network)
        let dx = next.x - anchor.x, dy = next.y - anchor.y
        let length = (dx * dx + dy * dy).squareRoot()
        guard length > 0 else { return }
        let rim = JarvisNeuralPoint(x: anchor.x + dx / length * layout.orbRadius, y: anchor.y + dy / length * layout.orbRadius)
        var moments = [volley.travelEnd(route.length)]
        if !volley.inbound { moments.append(volley.start) }
        var strength = 0.0
        for moment in moments { strength = max(strength, Self.fade(frame.flow - moment, over: 0.35)) }
        if strength > 0.01 {
            flares.append(Flare(x: rim.x, y: rim.y, strength: strength * volley.strength * Self.flareFlash * 2))
        }
    }
}
