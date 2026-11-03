import Foundation

/// What the orb is doing. The same states as the web orb's `JarvisOrbState`.
public enum JarvisOrbState: Equatable, Sendable {
    case idle, listening, thinking, tool, speaking
}

/// The app's orb activities, mapped onto the web orb's wakefulness (`awake`) and state.
/// Ported from apps/web/src/jarvis-orb-motion.ts, which the web stage orb and the native orb share.
public enum JarvisOrbActivity: Equatable, Sendable {
    case idle
    case signingIn
    case calm
    case listening
    case thinking
    case speaking
    case muted
    case reconnecting
    case offline

    /// 0 dormant, 1 fully awake voice, in between for chat-only work.
    public var awake: Double {
        switch self {
        case .idle, .offline: 0
        case .calm, .muted: 0.35
        case .reconnecting: 0.5
        case .signingIn: 0.6
        case .listening, .thinking, .speaking: 1
        }
    }

    public var state: JarvisOrbState {
        switch self {
        case .listening: .listening
        case .thinking, .signingIn, .reconnecting: .thinking
        case .speaking: .speaking
        case .idle, .calm, .muted, .offline: .idle
        }
    }

    /// Muted, reconnecting and offline orbs lose colour, as the web orb's dormant look does.
    public var saturation: Double {
        switch self {
        case .muted: 0.35
        case .reconnecting: 0.6
        case .offline: 0
        default: 1
        }
    }
}

public struct JarvisOrbMotionInput: Equatable, Sendable {
    public var awake: Double
    public var state: JarvisOrbState
    /// Audible playback level now, 0–1.
    public var playback: Double
    /// Microphone level now, 0–1.
    public var input: Double
    public var reducedMotion: Bool

    public init(awake: Double, state: JarvisOrbState, playback: Double = 0, input: Double = 0, reducedMotion: Bool = false) {
        self.awake = awake
        self.state = state
        self.playback = playback
        self.input = input
        self.reducedMotion = reducedMotion
    }
}

public struct JarvisOrbMotionFrame: Equatable, Sendable {
    public var awake = 0.0
    public var ignite = 0.0
    public var wave = 0.0
    public var waveStrength = 0.0
    public var surge = 0.0
    public var listen = 0.0
    public var think = 0.0
    public var tool = 0.0
    public var speak = 0.0
    public var speech = 0.0
    public var input = 0.0
}

/// Pure orb motion model: a port of `createOrbMotion` in apps/web/src/jarvis-orb-motion.ts. The wake timeline is
/// continuous, so changing state mid-sequence settles smoothly without restarting or flashing.
public struct JarvisOrbMotion: Sendable {
    public static let wakeDuration = 1.05
    public static let sleepDuration = 0.7

    private var timeline = 0.0
    private var surge = 0.0
    private var waveStrength = 0.0
    private var listen = 0.0, think = 0.0, tool = 0.0, speak = 0.0
    private var speech = 0.0
    private var input = 0.0

    public init() {}

    static func clamp01(_ value: Double) -> Double {
        value.isFinite ? max(0, min(1, value)) : 0
    }

    public static func smoothstep(_ edge0: Double, _ edge1: Double, _ value: Double) -> Double {
        let t = clamp01((value - edge0) / (edge1 - edge0))
        return t * t * (3 - 2 * t)
    }

    /// Exponential attack/release follower; frame-rate independent.
    public static func follow(_ current: Double, _ target: Double, delta: Double, attack: Double, release: Double) -> Double {
        let goal = clamp01(target)
        let rate = goal > current ? attack : release
        return current + (goal - current) * (1 - exp(-rate * max(0, delta)))
    }

    public mutating func step(delta: Double, _ options: JarvisOrbMotionInput) -> JarvisOrbMotionFrame {
        let target = Self.clamp01(options.awake)
        let dt = max(0, min(delta, 0.12))
        var rising = false
        func weight(_ state: JarvisOrbState) -> Double { options.state == state ? 1 : 0 }
        if options.reducedMotion {
            timeline = target
            surge = 0
            waveStrength = 0
            listen = weight(.listening); think = weight(.thinking); tool = weight(.tool); speak = weight(.speaking)
            speech = 0
            input = 0
        } else {
            rising = target > timeline + 1e-4
            if rising {
                timeline = min(target, timeline + dt / Self.wakeDuration)
            } else {
                timeline = max(target, timeline - dt / Self.sleepDuration)
            }
            surge = Self.follow(surge, rising ? Self.smoothstep(0.45, 0.85, timeline) : 0, delta: dt, attack: 14, release: 3.2)
            let waveTarget = rising ? sin(Double.pi * Self.smoothstep(0.12, 0.8, timeline)) : 0
            waveStrength = Self.follow(waveStrength, waveTarget, delta: dt, attack: 18, release: 5)
            listen = Self.follow(listen, weight(.listening), delta: dt, attack: 7, release: 4.5)
            think = Self.follow(think, weight(.thinking), delta: dt, attack: 7, release: 4.5)
            tool = Self.follow(tool, weight(.tool), delta: dt, attack: 7, release: 4.5)
            speak = Self.follow(speak, weight(.speaking), delta: dt, attack: 7, release: 4.5)
            speech = options.state == .speaking
                ? Self.follow(speech, options.playback, delta: dt, attack: 28, release: 7)
                : Self.follow(speech, 0, delta: dt, attack: 28, release: 16)
            input = options.state == .listening
                ? Self.follow(input, options.input, delta: dt, attack: 22, release: 6)
                : 0
        }
        return JarvisOrbMotionFrame(
            awake: Self.smoothstep(0.2, 1, timeline),
            ignite: Self.smoothstep(0, 0.35, timeline),
            wave: Self.smoothstep(0.12, 0.8, timeline),
            waveStrength: waveStrength,
            surge: surge,
            listen: listen, think: think, tool: tool, speak: speak,
            speech: speech,
            input: input
        )
    }
}

/// Everything one drawn frame needs: the motion model plus the integrated phases, so changing state cannot jump the
/// core's pose. Ported from `update` and `frame` in apps/web/src/JarvisStageOrb.ts and docs/ios/design/orb-web.js.
public struct JarvisOrbFrame: Equatable, Sendable {
    public var motion: JarvisOrbMotionFrame
    public var time: Double
    public var coreFlow: Double
    public var ribbonAngle: Double
    /// Whole-orb breathing scale.
    public var scale: Double
}

public struct JarvisOrbAnimator: Sendable {
    /// The pose a steady orb (Reduce Motion, static previews) is drawn in.
    public static let stillTime = 0.0
    public static let stillFlow = 0.8

    private var motion = JarvisOrbMotion()
    private var previous: Double?
    private var coreFlow = 0.0
    private var ribbonAngle = 0.0

    public init() {}

    /// A deterministic stand-in for the audio levels the web orb reads from playback and the microphone.
    public static func syntheticLevel(for state: JarvisOrbState, time: Double) -> (playback: Double, input: Double) {
        let wave = 0.5 + 0.5 * sin(time * 7.3) * (0.6 + 0.4 * sin(time * 2.1 + 1))
        switch state {
        case .speaking: return (0.25 + 0.6 * wave, 0)
        case .listening: return (0, 0.2 + 0.5 * wave)
        default: return (0, 0)
        }
    }

    public mutating func advance(to time: Double, activity: JarvisOrbActivity, reducedMotion: Bool) -> JarvisOrbFrame {
        let delta = previous.map { max(0, min(time - $0, 0.12)) } ?? 0
        previous = time
        let levels = Self.syntheticLevel(for: activity.state, time: time)
        let frame = motion.step(delta: delta, JarvisOrbMotionInput(
            awake: activity.awake, state: activity.state, playback: levels.playback, input: levels.input,
            reducedMotion: reducedMotion
        ))
        let u = reducedMotion ? Self.stillTime : time
        if reducedMotion {
            coreFlow = Self.stillFlow
        } else {
            coreFlow += delta * (0.42 + frame.awake * 0.7 + frame.think * 1.0 + frame.tool * 1.2
                + frame.speech * 1.1 + frame.listen * frame.input * 0.8)
            ribbonAngle += delta * (0.05 + frame.awake * 0.045 + frame.tool * 0.5 + frame.surge * 0.35 + frame.think * 0.06)
        }
        let p = sin(u * 0.38 + sin(u * 0.09) * 0.72) * 0.62 + sin(u * 0.17 + 0.8) * 0.25 + sin(u * 0.71 + 1.7) * 0.13
        let heart = pow(max(0, sin(u * 0.72 + sin(u * 0.13) * 0.58)), 12)
        let breath = activity.state == .idle ? (p - 0.5) * 0.05 : (1 - frame.awake) * (p - 0.5) * 0.012
        let scale = 1 + breath + heart * 0.018 + frame.surge * 0.085 + frame.listen * (p - 0.5) * 0.022
            + frame.speech * 0.04 - frame.think * 0.012
        return JarvisOrbFrame(motion: frame, time: u, coreFlow: coreFlow, ribbonAngle: ribbonAngle, scale: scale)
    }
}

public struct JarvisOrbVector: Equatable, Sendable {
    public var x: Double, y: Double, z: Double

    public init(_ x: Double, _ y: Double, _ z: Double) {
        self.x = x; self.y = y; self.z = z
    }

    public var length: Double { (x * x + y * y + z * z).squareRoot() }

    public func distance(to other: JarvisOrbVector) -> Double {
        JarvisOrbVector(x - other.x, y - other.y, z - other.z).length
    }

    /// Three.js `Euler` order XYZ: the vector is turned about z, then y, then x.
    public func rotated(x ex: Double, y ey: Double, z ez: Double) -> JarvisOrbVector {
        let (cz, sz) = (cos(ez), sin(ez))
        let x1 = x * cz - y * sz, y1 = x * sz + y * cz
        let (cy, sy) = (cos(ey), sin(ey))
        let x2 = x1 * cy + z * sy, z2 = -x1 * sy + z * cy
        let (cx, sx) = (cos(ex), sin(ex))
        return JarvisOrbVector(x2, y1 * cx - z2 * sx, y1 * sx + z2 * cx)
    }
}

/// The orb's seeded geometry: the same construction as `createJarvisStageOrb` (seed 71, Park–Miller generator), so the
/// amber core is the same tangle on every platform.
public struct JarvisOrbGeometry: Sendable {
    public struct Link: Equatable, Sendable {
        public let from: Int
        public let to: Int
        /// Where the filament bows to, relative to the straight line between its ends.
        public let bend: JarvisOrbVector
    }

    public struct Spark: Equatable, Sendable {
        public let position: JarvisOrbVector
        public let seed: Double
        public let size: Double
    }

    public struct Ribbon: Equatable, Sendable {
        /// Points on the shell along the band's centre line.
        public let points: [JarvisOrbVector]
        /// Half width of the band, in radians of latitude.
        public let halfWidth: [Double]
        public let isWide: Bool
    }

    public let nodes: [JarvisOrbVector]
    public let links: [Link]
    public let loops: [[JarvisOrbVector]]
    public let sparks: [Spark]
    public let motes: [Spark]
    public let ribbons: [Ribbon]

    public static let shell = JarvisOrbGeometry()
    public static let ribbonSteps = 48

    private init() {
        var seed = 71
        func random() -> Double {
            seed = seed * 16807 % 2_147_483_647
            return Double(seed) / 2_147_483_647
        }

        var nodes: [JarvisOrbVector] = []
        for index in 0..<64 {
            let angle = Double(index) * 2.39996
            let y = 1 - 2 * (Double(index) + 0.5) / 64
            let radius = 0.17 + random() * 0.22
            let lobe = index % 2 == 0 ? -0.055 : 0.055
            let ring = (1 - y * y).squareRoot()
            nodes.append(JarvisOrbVector(cos(angle) * ring * radius + lobe, y * radius * 0.84, sin(angle) * ring * radius * 0.85))
        }

        var links: [Link] = []
        for index in nodes.indices {
            let origin = nodes[index]
            let neighbours = nodes.indices
                .filter { $0 != index }
                .sorted { left, right in
                    let a = origin.distance(to: nodes[left]), b = origin.distance(to: nodes[right])
                    return a == b ? left < right : a < b
                }
            let destination = neighbours[index % 3]
            let sum = JarvisOrbVector(
                origin.x + nodes[destination].x, origin.y + nodes[destination].y, origin.z + nodes[destination].z
            )
            let norm = max(sum.length, 1e-6)
            _ = random() // the web draws a random tube radius per filament; keep the sequence identical
            links.append(Link(from: index, to: destination, bend: JarvisOrbVector(
                sum.x / norm * 0.07, sum.y / norm * 0.07, sum.z / norm * 0.07
            )))
        }

        var loops: [[JarvisOrbVector]] = []
        for index in 0..<10 {
            var points: [JarvisOrbVector] = []
            for point in 0..<32 {
                let angle = Double(point) / 31 * Double.pi * 1.8 + Double(index) * 0.7
                let radius = 0.19 + 0.04 * sin(angle * 3 + Double(index))
                points.append(JarvisOrbVector(cos(angle) * radius, sin(angle) * radius * 0.8, sin(angle * 2 + Double(index)) * 0.16))
            }
            loops.append(points)
        }

        var sparks: [Spark] = []
        for index in 0..<220 {
            let radius = 0.38 * pow(random(), 0.65)
            let angle = random() * Double.pi * 2
            let y = random() * 2 - 1
            let ring = (1 - y * y).squareRoot()
            let position = index < nodes.count
                ? nodes[index]
                : JarvisOrbVector(cos(angle) * ring * radius, y * radius * 0.82, sin(angle) * ring * radius * 0.85)
            let seedValue = random()
            let size = index < 12 ? 1.85 : 0.4 + random() * 0.85
            sparks.append(Spark(position: position, seed: seedValue, size: size))
        }

        var motes: [Spark] = []
        for index in 0..<460 {
            let angle = Double(index) * 2.39996
            let y = 1 - 2 * (Double(index) + 0.5) / 460
            let radius = (1 - y * y).squareRoot() * 1.105
            motes.append(Spark(position: JarvisOrbVector(cos(angle) * radius, y * 1.105, sin(angle) * radius), seed: random(), size: 1))
        }

        var ribbons: [Ribbon] = []
        for band in 0..<9 {
            let tilt = Double(band) * 0.79
            let phase = Double(band) * 1.4
            let wide = band < 6
            var points: [JarvisOrbVector] = []
            var widths: [Double] = []
            for index in 0...Self.ribbonSteps {
                let angle = Double(index) / Double(Self.ribbonSteps) * Double.pi * 2
                let latitude = 0.45 * sin(angle * 2 + phase) + 0.18 * sin(angle * 3 - phase)
                let width = (wide ? 0.075 : 0.009) + (wide ? 0.17 : 0.023) * pow(0.5 + 0.5 * sin(angle * 3 + phase), 2)
                let point = JarvisOrbVector(
                    cos(angle) * cos(latitude) * 1.125, sin(latitude) * 1.125, sin(angle) * cos(latitude) * 1.125
                )
                points.append(point.rotated(x: tilt, y: phase * 0.26, z: Double(band) * 0.49))
                widths.append(width)
            }
            ribbons.append(Ribbon(points: points, halfWidth: widths, isWide: wide))
        }

        self.nodes = nodes
        self.links = links
        self.loops = loops
        self.sparks = sparks
        self.motes = motes
        self.ribbons = ribbons
    }
}
