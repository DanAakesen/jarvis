import Foundation

/// How much of the lattice is drawn. Small orbs (a Live Activity, a Watch complication) keep the hubs and the
/// strongest connections and draw them a little heavier; the large orb shows every node and fine connection.
public enum JarvisLatticeDetail: Int, Sendable {
    case minimal, reduced, full

    public init(points: Double) {
        self = points >= 120 ? .full : points >= 56 ? .reduced : .minimal
    }

    var maximumRank: Int { rawValue }
    public var lineScale: Double { self == .full ? 1 : self == .reduced ? 1.25 : 1.7 }
    var dotScale: Double { self == .full ? 1 : self == .reduced ? 1.3 : 1.9 }
    var alphaScale: Double { self == .full ? 1 : self == .reduced ? 1.2 : 1.45 }
}

/// One posed frame of the lattice: plain numbers in orb radii (the glass sphere has radius 1, y points up), ready
/// for any 2D painter. It is a pure function of the model, the frame and the detail level, so it can be tested and
/// drawn the same way on every platform.
public struct JarvisLatticeScene: Sendable {
    public struct Edge: Sendable {
        public var ax: Double, ay: Double, cx: Double, cy: Double, bx: Double, by: Double
        /// 0 cyan, 1 amber.
        public var warmth: Double
        /// Brightness of the line itself, before additive blending.
        public var alpha: Double
        /// Extra emphasis while neighbouring nodes light up in sequence.
        public var light: Double
    }

    public struct Dot: Sendable {
        public var x: Double, y: Double
        public var radius: Double
        public var warmth: Double
        public var alpha: Double
        /// Soft glow around the dot, 0 for none.
        public var halo: Double
    }

    public struct Heart: Sendable {
        public var x: Double, y: Double
        /// Radius of the broad amber glow.
        public var radius: Double
        public var intensity: Double
        /// 0–1 strength of the amber centre and its tiny spark.
        public var heat: Double
    }

    public var detail: JarvisLatticeDetail = .full
    public var edges: [Edge] = []
    public var dots: [Dot] = []
    /// Signal heads and their fading trails.
    public var signals: [Dot] = []
    public var heart = Heart(x: 0, y: 0, radius: 0.5, intensity: 0, heat: 0)
    /// 0–1 brightness of the cyan limb nodes; the painter lifts the glass rim with it.
    public var outerGain = 0.0
}

extension JarvisLatticeScene {
    private static func envelope(_ x: Double, decay: Double, attack: Double) -> Double {
        x <= 0 ? 0 : (1 - exp(-x * attack)) * exp(-x * decay)
    }

    private static func wrap(_ value: Double, _ period: Double) -> Double {
        let remainder = value.truncatingRemainder(dividingBy: period)
        return remainder < 0 ? remainder + period : remainder
    }

    /// The heart's warm pulse: a soft double beat once every `JarvisLatticeModel.pulsePeriod` seconds, 0–1.
    public static func pulse(at time: Double) -> Double {
        let phase = time / JarvisLatticeModel.pulsePeriod
        // Distance around the cycle, so a beat near the start of one cycle never ends abruptly at the previous one.
        func beat(_ centre: Double, _ width: Double) -> Double {
            var d = phase - centre
            d -= d.rounded()
            return exp(-pow(d / width, 2))
        }
        let first = beat(0.16, 0.1)
        let second = 0.45 * beat(0.4, 0.11)
        return min(1, first + second)
    }

    public static func make(
        model: JarvisLatticeModel = .shared,
        frame: JarvisOrbFrame,
        detail: JarvisLatticeDetail = .full
    ) -> JarvisLatticeScene {
        let m = frame.motion
        let t = frame.time
        let flow = frame.flow
        let smooth = JarvisOrbMotion.smoothstep

        // State weights ease in, so a change of state starts gently instead of snapping the network.
        func ease(_ w: Double) -> Double { w * w * (3 - 2 * w) }
        let listen = ease(m.listen), think = ease(m.think), tool = ease(m.tool), speak = ease(m.speak)

        let awake = m.awake
        let heldInput = listen * m.input
        let heldSpeech = speak * m.speech
        let busy = max(think, tool)
        let pulse = Self.pulse(at: t)

        // Gains: the shell answers to listening, the heart to thinking and speaking.
        let outerGain = 0.5 + 0.5 * awake + 0.5 * listen * (0.3 + m.input) + 0.15 * m.surge + 0.1 * heldSpeech
        let coreGain = 0.74 + 0.26 * awake + 0.4 * think + 0.3 * tool + 0.4 * heldSpeech
            + 0.4 * heldInput + 0.3 * m.surge
        let spread = 1 + 0.09 * listen * (0.5 + m.input) - 0.16 * think - 0.07 * tool
            + 0.04 * speak * (0.5 + m.speech) + 0.06 * m.surge

        var screen = [JarvisOrbVector](repeating: JarvisOrbVector(0, 0, 0), count: model.nodes.count)
        var lit = [Double](repeating: 0, count: model.nodes.count)

        // Node sequences: each ignition lights its neighbours one hop at a time.
        var seeds: [(Double, [UInt8])] = []
        for ignition in model.ignitions {
            seeds.append((Self.wrap(flow + ignition.offset, ignition.period), ignition.hops))
        }

        for (index, node) in model.nodes.enumerated() {
            let cluster = model.clusters[node.cluster]
            let pin = 1 - 0.85 * smooth(0.62, 0.9, node.radius)
            let drift = JarvisOrbVector(
                sin(cluster.speed.x * t + cluster.phase.x) * cluster.amplitude.x,
                sin(cluster.speed.y * t + cluster.phase.y) * cluster.amplitude.y,
                sin(cluster.speed.z * t + cluster.phase.z) * cluster.amplitude.z
            )
            let interior = 1 - smooth(0.66, 0.92, node.radius)
            let factor = 1 + (spread - 1) * interior
            var x = (node.position.x + drift.x * pin) * factor
            var y = (node.position.y + drift.y * pin) * factor
            let z = (node.position.z + drift.z * pin) * factor
            if speak > 0.001 {
                x *= 1 + 0.15 * speak * interior
                y *= 1 - 0.1 * speak * interior
                y += sin(x * 6 - t * 3.4 + node.phase * 6.283) * (0.03 + 0.05 * m.speech) * speak * interior
            }
            let perspective = 1 + 0.1 * z
            screen[index] = JarvisOrbVector(x * perspective, y * perspective, z)

            var level = 0.0
            for (tau, hops) in seeds {
                let hop = hops[index]
                if hop == JarvisLatticeModel.unreachable { continue }
                level = max(level, envelope(tau - Double(hop) * 0.24, decay: 2.1, attack: 12))
            }
            if m.waveStrength > 0.001 {
                level = max(level, m.waveStrength * exp(-pow((node.radius - m.wave * 1.05) / 0.17, 2)))
            }
            if listen > 0.001 {
                let ripple = pow(0.5 + 0.5 * sin(node.radius * 10 + t * 3.2), 6)
                level = max(level, listen * (0.18 + m.input * 0.9) * ripple)
            }
            if heldSpeech > 0.001 {
                let ripple = pow(0.5 + 0.5 * sin(node.radius * 10 - t * 4.4), 6)
                level = max(level, heldSpeech * 0.9 * ripple)
            }
            lit[index] = min(1, level)
        }

        var scene = JarvisLatticeScene()
        scene.detail = detail
        scene.outerGain = min(1.4, outerGain)

        // Connections, bowed toward the centre.
        var curves = [(a: JarvisOrbVector, c: JarvisOrbVector, b: JarvisOrbVector)]()
        curves.reserveCapacity(model.edges.count)
        let bowScale = 1 + 0.5 * think + 1.6 * speak - 0.5 * listen * (0.5 + m.input)
        for edge in model.edges {
            let a = screen[edge.a], b = screen[edge.b]
            let bow = edge.bow * bowScale
            let mid = JarvisOrbVector((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
            let control = JarvisOrbVector(mid.x * (1 - bow), mid.y * (1 - bow), mid.z * (1 - bow))
            curves.append((a, control, b))
            guard edge.rank <= detail.maximumRank else { continue }
            let na = model.nodes[edge.a], nb = model.nodes[edge.b]
            let warmth = (na.warmth + nb.warmth) / 2
            let gain = outerGain + (coreGain - outerGain) * warmth
            let depth = 0.6 + 0.4 * ((a.z + b.z) / 4 + 0.5)
            let light = max(lit[edge.a], lit[edge.b]) * 0.75
            let length = ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)).squareRoot()
            let alpha = (0.28 + 0.42 * warmth) / (1 + length * (0.9 - 0.4 * warmth)) * gain * depth * detail.alphaScale + light * 0.4
            scene.edges.append(Edge(
                ax: a.x, ay: a.y, cx: control.x, cy: control.y, bx: b.x, by: b.y,
                warmth: warmth, alpha: min(1, alpha), light: light
            ))
        }

        // Nodes.
        var heartX = 0.0, heartY = 0.0
        for (index, node) in model.nodes.enumerated() {
            if node.layer == .core {
                heartX += screen[index].x
                heartY += screen[index].y
            }
            guard node.rank <= detail.maximumRank else { continue }
            let p = screen[index]
            let depth = 0.62 + 0.38 * (p.z / 2 + 0.5)
            let twinkle = 0.78 + 0.22 * (0.5 + 0.5 * sin(t * 0.9 + node.phase * 6.283))
            let gain = node.layer == .core ? coreGain : node.layer == .mid ? (outerGain + coreGain) / 2 : outerGain
            let base = node.layer == .shell ? 0.8 : node.layer == .mid ? 0.62 : 0.85
            let alpha = min(1, base * gain * depth * twinkle * min(1.2, detail.alphaScale) + lit[index] * 0.55)
            let coreBeat = node.layer == .core ? 1 + 0.18 * pulse : 1
            scene.dots.append(Dot(
                x: p.x, y: p.y,
                radius: node.size * (1 + 0.35 * lit[index]) * (1 + 0.1 * p.z) * detail.dotScale * coreBeat,
                warmth: node.warmth, alpha: alpha,
                halo: min(1, lit[index] * 0.8 + (node.rank == 0 ? 0.55 : 0.16))
            ))
        }
        let coreCount = Double(max(1, model.coreNodes.count))
        heartX /= coreCount
        heartY /= coreCount

        // Signals, and the kick each one gives the heart when it arrives.
        var kick = 0.0
        let active = 4 + 10 * awake + 6 * busy
        for (index, route) in model.routes.enumerated() {
            let fade = 1 - smooth(active - 1, active, Double(index))
            guard fade > 0.001 else { continue }
            let total = Double(route.edges.count) * route.hopDuration
            let phase = Self.wrap(flow + route.offset, route.period)
            if phase > total {
                kick += envelope(phase - total, decay: 3.2, attack: 18) * 0.3 * fade
                continue
            }
            for tail in 0..<5 {
                let age = phase - Double(tail) * 0.11
                guard age >= 0 else { break }
                let u = age / total
                let scaled = min(Double(route.edges.count) - 1e-9, u * Double(route.edges.count))
                let hop = Int(scaled)
                let local = scaled - Double(hop)
                let curve = curves[route.edges[hop]]
                let s = route.forward[hop] ? local : 1 - local
                let inv = 1 - s
                let x = inv * inv * curve.a.x + 2 * inv * s * curve.c.x + s * s * curve.b.x
                let y = inv * inv * curve.a.y + 2 * inv * s * curve.c.y + s * s * curve.b.y
                let ends = smooth(0, 0.08, u) * smooth(0, 0.1, 1 - u)
                let strength = fade * ends * pow(1 - Double(tail) / 5, 1.6)
                scene.signals.append(Dot(
                    x: x, y: y,
                    radius: 0.011 * (1 - Double(tail) * 0.13) * detail.dotScale,
                    warmth: 0.1 + 0.9 * pow(u, 1.6),
                    alpha: min(1, strength * 0.55 * detail.alphaScale),
                    halo: tail == 0 ? strength * 0.7 : 0
                ))
            }
        }

        let beat = 1 + 0.16 * pulse + min(0.4, kick)
        scene.heart = Heart(
            x: heartX, y: heartY,
            radius: 0.5 * (1 + 0.04 * pulse),
            intensity: min(1.9, coreGain * beat * 0.6),
            heat: min(1, 0.35 + 0.3 * pulse + kick + 0.25 * busy + 0.3 * heldSpeech)
        )
        return scene
    }
}
