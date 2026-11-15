import Foundation

/// Orb colours shared by the app, Live Activity, widgets, Watch and (as hex) the web orb.
public enum JarvisOrbAppearance {
    /// Bright cyan: lattice nodes and signals near the glass.
    public static let cool = (r: 0x52 / 255.0, g: 0xdc / 255.0, b: 0xfa / 255.0)
    /// Deeper blue of the glass body and its rim.
    public static let deep = (r: 0x24 / 255.0, g: 0x7a / 255.0, b: 0xf2 / 255.0)
    /// Amber of the connected core.
    public static let warm = (r: 1.0, g: 0xa6 / 255.0, b: 0x2e / 255.0)
    /// The hottest point of the core: still amber, never white.
    public static let hot = (r: 1.0, g: 0xbd / 255.0, b: 0x4a / 255.0)
}

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

extension JarvisOrbActivity {
    /// The still pose a Live Activity or Dynamic Island shows for the voice session's phase.
    public init(livePhase phase: VoiceLiveActivityPhase) {
        switch phase {
        case .listening: self = .listening
        case .speaking: self = .speaking
        case .muted: self = .muted
        case .thinking: self = .thinking
        case .connecting: self = .calm
        case .reconnecting: self = .reconnecting
        }
    }

    /// The Watch only receives the iPhone's status words ("Listening", "Speaking", "Thinking", "Connecting",
    /// "Ended", "Disconnected") and whether the microphone is muted.
    public init(watchVoiceStatus status: String, isMuted: Bool) {
        let word = status.lowercased()
        if word.contains("disconnect") || word.contains("ended") || word.contains("unavailable") {
            self = .offline
        } else if isMuted {
            self = .muted
        } else if word.contains("listen") {
            self = .listening
        } else if word.contains("speak") {
            self = .speaking
        } else if word.contains("think") {
            self = .thinking
        } else {
            self = .calm
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
            input = Self.follow(input, options.state == .listening ? options.input : 0, delta: dt, attack: 22, release: 6)
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

/// Everything one drawn frame needs: the motion model plus a clock that is integrated, so a state that speeds the
/// network up cannot make its signals jump.
public struct JarvisOrbFrame: Equatable, Sendable {
    public var motion: JarvisOrbMotionFrame
    /// Wall-clock seconds: the core pulse, depth drift and rim use it at a steady pace.
    public var time: Double
    /// Integrated network time: signals and node sequences run on it and speed up while Jarvis thinks or works.
    public var flow: Double
}

public struct JarvisOrbAnimator: Sendable {
    /// The pose a steady orb (Reduce Motion, static previews, widgets) is drawn in.
    public static let stillTime = 2.6
    public static let stillFlow = 2.6

    private var motion = JarvisOrbMotion()
    private var previous: Double?
    private var flow = 0.0

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
        if reducedMotion {
            flow = Self.stillFlow
        } else {
            flow += delta * (1 + frame.think * 1.1 + frame.tool * 1.7 + frame.speech * 0.55
                + frame.listen * frame.input * 0.3 + frame.surge * 0.8)
        }
        return JarvisOrbFrame(motion: frame, time: reducedMotion ? Self.stillTime : time, flow: flow)
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
}
