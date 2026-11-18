#if canImport(SwiftUI)
import SwiftUI

/// The one Jarvis orb drawing, shared by the iPhone app, Live Activity, widgets and Watch: a dark glass sphere with
/// a cyan rim around the procedural cognitive lattice (`JarvisLatticeModel`, posed by `JarvisLatticeScene`). Use it
/// through the app's `JarvisOrb`, or directly where a target cannot link app code.
/// API: SwiftUI.TimelineView, SwiftUI.Canvas, GraphicsContext.
public struct JarvisLatticeOrbView: View {
    let activity: JarvisOrbActivity
    let isStatic: Bool
    let isPaused: Bool
    let adaptsToLowPower: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var clock = JarvisLatticeClock()
    @State private var isCheap = JarvisNeuralRendering.usesCheapPath

    /// `isStatic` draws one still pose (Live Activities, widgets, previews). `isPaused` holds the current frame
    /// while the orb is covered. `adaptsToLowPower` draws half the frames on the neural background's cheap path
    /// (Low Power Mode, the Simulator), for the orb that sits behind every page.
    public init(
        activity: JarvisOrbActivity, isStatic: Bool = false, isPaused: Bool = false, adaptsToLowPower: Bool = false
    ) {
        self.activity = activity
        self.isStatic = isStatic
        self.isPaused = isPaused
        self.adaptsToLowPower = adaptsToLowPower
    }

    private var frameInterval: Double { adaptsToLowPower && isCheap ? 1.0 / 15.0 : 1.0 / 30.0 }

    public var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            Group {
                if isStatic || reduceMotion {
                    orb(frame: clock.frame(at: nil, activity: activity), side: side)
                } else {
                    TimelineView(.animation(minimumInterval: frameInterval, paused: isPaused || scenePhase != .active)) { timeline in
                        orb(frame: clock.frame(at: timeline.date, activity: activity), side: side)
                    }
                }
            }
            .frame(width: side, height: side)
        }
        .aspectRatio(1, contentMode: .fit)
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            isCheap = JarvisNeuralRendering.usesCheapPath
        }
    }

    private func orb(frame: JarvisOrbFrame, side: CGFloat) -> some View {
        let activity = activity
        let scene = JarvisLatticeScene.make(frame: frame, detail: JarvisLatticeDetail(points: Double(side)))
        return Canvas { context, size in
            JarvisLatticePainter(scene: scene, frame: frame, activity: activity, size: size).paint(&context)
        }
        .frame(width: side, height: side)
    }
}

/// Holds the animator between frames. The timeline drives it from the main actor only.
final class JarvisLatticeClock {
    private var animator = JarvisOrbAnimator()
    private var start: Date?

    func frame(at date: Date?, activity: JarvisOrbActivity) -> JarvisOrbFrame {
        guard let date else {
            var still = JarvisOrbAnimator()
            return still.advance(to: 0, activity: activity, reducedMotion: true)
        }
        let origin = start ?? date
        start = origin
        return animator.advance(to: date.timeIntervalSince(origin), activity: activity, reducedMotion: false)
    }
}

struct JarvisLatticePainter {
    let scene: JarvisLatticeScene
    let frame: JarvisOrbFrame
    let activity: JarvisOrbActivity
    let size: CGSize

    private typealias RGB = (r: Double, g: Double, b: Double)

    private static let edgeCool: RGB = (0.22, 0.70, 1.0)
    private static let edgeMiddle: RGB = (0.45, 0.78, 0.62)
    private static let edgeWarm: RGB = (1.0, 0.5, 0.07)
    private static let nodeCool: RGB = (0.58, 0.92, 1.0)
    private static let nodeMiddle: RGB = (0.72, 0.9, 0.55)
    private static let nodeWarm: RGB = (1.0, 0.64, 0.16)
    private static let haze: RGB = (1.0, 0.42, 0.06)
    private static let spark: RGB = (1.0, 0.93, 0.78)
    private static let signalCool: RGB = (0.45, 0.85, 1.0)
    private static let signalWarm: RGB = (1.0, 0.8, 0.4)
    private static let warmBuckets = 6
    private static let alphaBuckets = 12
    private static let alphaStep = 0.07

    private var half: Double { Double(min(size.width, size.height)) / 2 }
    private var radius: Double { half * 0.97 }
    private var center: CGPoint { CGPoint(x: size.width / 2, y: size.height / 2) }
    private var motion: JarvisOrbMotionFrame { frame.motion }

    private func clamp(_ value: Double, _ low: Double = 0, _ high: Double = 1) -> Double { max(low, min(high, value)) }
    private func mix(_ a: RGB, _ b: RGB, _ t: Double) -> RGB {
        (a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
    }
    /// Cool to warm through a teal-green middle, so the transition never washes out to grey.
    private func blend(_ cool: RGB, _ middle: RGB, _ warm: RGB, _ t: Double) -> RGB {
        t < 0.5 ? mix(cool, middle, t * 2) : mix(middle, warm, t * 2 - 1)
    }

    /// Muted, reconnecting and offline orbs lose colour.
    private func color(_ rgb: RGB, _ opacity: Double) -> Color {
        let gray = 0.3 * rgb.r + 0.59 * rgb.g + 0.11 * rgb.b
        let s = activity.saturation
        func channel(_ v: Double) -> Double { clamp(gray + (v - gray) * s) }
        return Color(red: channel(rgb.r), green: channel(rgb.g), blue: channel(rgb.b)).opacity(clamp(opacity))
    }

    private func point(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: center.x + CGFloat(x * radius), y: center.y - CGFloat(y * radius))
    }

    private func square(_ x: Double, _ y: Double, _ r: Double) -> CGRect {
        let p = point(x, y)
        let rr = CGFloat(r)
        return CGRect(x: p.x - rr, y: p.y - rr, width: rr * 2, height: rr * 2)
    }

    private func circle(_ x: Double, _ y: Double, _ r: Double) -> Path {
        Path(ellipseIn: square(x, y, r))
    }

    func paint(_ context: inout GraphicsContext) {
        context.clip(to: Path(ellipseIn: CGRect(
            x: center.x - CGFloat(radius), y: center.y - CGFloat(radius),
            width: CGFloat(radius * 2), height: CGFloat(radius * 2)
        )))
        glass(&context)
        var layer = context
        layer.blendMode = .plusLighter
        heartGlow(&layer)
        edges(&layer)
        dots(&layer)
        signals(&layer)
        heartCore(&layer)
        rim(&layer)
        limb(&layer)
    }

    // MARK: Dark glass

    private func glass(_ context: inout GraphicsContext) {
        let shading = GraphicsContext.Shading.radialGradient(
            Gradient(stops: [
                .init(color: Color(red: 0.012, green: 0.03, blue: 0.075).opacity(0.92), location: 0),
                .init(color: Color(red: 0.014, green: 0.05, blue: 0.12).opacity(0.92), location: 0.72),
                .init(color: Color(red: 0.024, green: 0.102, blue: 0.243).opacity(0.95), location: 1),
            ]),
            center: center, startRadius: 0, endRadius: CGFloat(radius)
        )
        context.fill(circle(0, 0, radius), with: shading)
    }

    // MARK: Heart

    private func heartGlow(_ layer: inout GraphicsContext) {
        let heart = scene.heart
        let p = point(heart.x, heart.y)
        // A wide orange haze under a tighter amber glow: the warmth spreads outward from the heart.
        let wide = heart.radius * radius * 2
        layer.fill(
            circle(heart.x, heart.y, wide),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: color(JarvisLatticePainter.haze, heart.intensity * 0.38), location: 0),
                    .init(color: color(JarvisLatticePainter.haze, heart.intensity * 0.17), location: 0.5),
                    .init(color: color(JarvisLatticePainter.haze, 0), location: 1),
                ]),
                center: p, startRadius: 0, endRadius: CGFloat(wide)
            )
        )
        let reach = heart.radius * radius * 1.05
        layer.fill(
            circle(heart.x, heart.y, reach),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: color(JarvisLatticePainter.edgeWarm, heart.intensity * 0.55), location: 0),
                    .init(color: color(JarvisLatticePainter.edgeWarm, heart.intensity * 0.2), location: 0.5),
                    .init(color: color(JarvisLatticePainter.edgeWarm, 0), location: 1),
                ]),
                center: p, startRadius: 0, endRadius: CGFloat(reach)
            )
        )
    }

    /// The heart: an amber glow with only a tiny pale spark at its centre.
    private func heartCore(_ layer: inout GraphicsContext) {
        let heart = scene.heart
        let p = point(heart.x, heart.y)
        let r = radius * 0.1 * (1 + heart.heat)
        let hot = JarvisOrbAppearance.hot
        let warm = JarvisOrbAppearance.warm
        layer.fill(
            circle(heart.x, heart.y, r),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: color((hot.r, hot.g, hot.b), heart.heat * 0.7), location: 0),
                    .init(color: color((warm.r, warm.g, warm.b), heart.heat * 0.3), location: 0.4),
                    .init(color: color((warm.r, warm.g, warm.b), 0), location: 1),
                ]),
                center: p, startRadius: 0, endRadius: CGFloat(r)
            )
        )
        let tip = radius * 0.02 * (1 + 0.5 * heart.heat)
        layer.fill(
            circle(heart.x, heart.y, tip),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: color(JarvisLatticePainter.spark, heart.heat * 0.85), location: 0),
                    .init(color: color(JarvisLatticePainter.spark, 0), location: 1),
                ]),
                center: p, startRadius: 0, endRadius: CGFloat(tip)
            )
        )
    }

    // MARK: Connections

    /// Connections are merged into a few paths by colour and brightness, so a frame costs a few dozen strokes
    /// however many nodes there are.
    private func edges(_ layer: inout GraphicsContext) {
        let width = max(0.5, radius * 0.004 * scene.detail.lineScale)
        var lines: [Int: Path] = [:]
        var glows: [Int: Path] = [:]
        for edge in scene.edges {
            let warm = min(Self.warmBuckets - 1, Int(edge.warmth * Double(Self.warmBuckets)))
            let alpha = min(Self.alphaBuckets - 1, Int(edge.alpha / Self.alphaStep))
            let start = point(edge.ax, edge.ay), end = point(edge.bx, edge.by), control = point(edge.cx, edge.cy)
            let key = warm * Self.alphaBuckets + alpha
            lines[key, default: Path()].move(to: start)
            lines[key, default: Path()].addQuadCurve(to: end, control: control)
            if edge.light > 0.12 {
                let glowKey = warm * 4 + min(3, Int(edge.light * 4))
                glows[glowKey, default: Path()].move(to: start)
                glows[glowKey, default: Path()].addQuadCurve(to: end, control: control)
            }
        }
        for (key, path) in lines {
            let warm = Double(key / Self.alphaBuckets % Self.warmBuckets) + 0.5
            let alpha = (Double(key % Self.alphaBuckets) + 0.5) * Self.alphaStep
            let tone = blend(Self.edgeCool, Self.edgeMiddle, Self.edgeWarm, warm / Double(Self.warmBuckets))
            layer.stroke(path, with: .color(color(tone, alpha)), style: StrokeStyle(lineWidth: width, lineCap: .round))
            if scene.detail != .minimal {
                layer.stroke(
                    path,
                    with: .color(color(tone, alpha * (0.1 + 0.26 * warm / Double(Self.warmBuckets)))),
                    style: StrokeStyle(lineWidth: width * 4.5, lineCap: .round)
                )
            }
        }
        for (key, path) in glows {
            let warm = Double(key / 4) + 0.5
            let light = (Double(key % 4) + 0.5) / 4
            let tone = blend(Self.edgeCool, Self.edgeMiddle, Self.edgeWarm, warm / Double(Self.warmBuckets))
            layer.stroke(path, with: .color(color(tone, light * 0.22)), style: StrokeStyle(lineWidth: width * 2.4, lineCap: .round))
        }
    }

    // MARK: Nodes

    private func dots(_ layer: inout GraphicsContext) {
        var bodies: [Int: Path] = [:]
        for dot in scene.dots {
            let r = max(0.6, dot.radius * radius)
            let warm = min(3, Int(dot.warmth * 4))
            let alpha = min(5, Int(dot.alpha * 6))
            bodies[warm * 6 + alpha, default: Path()].addEllipse(in: square(dot.x, dot.y, r))
            if dot.halo > 0.05 {
                let tone = blend(Self.nodeCool, Self.nodeMiddle, Self.nodeWarm, dot.warmth)
                let reach = r * 3.6
                layer.fill(
                    circle(dot.x, dot.y, reach),
                    with: .radialGradient(
                        Gradient(colors: [color(tone, dot.halo * 0.42), color(tone, 0)]),
                        center: point(dot.x, dot.y), startRadius: 0, endRadius: CGFloat(reach)
                    )
                )
            }
        }
        for (key, path) in bodies {
            let warm = (Double(key / 6) + 0.5) / 4
            let alpha = (Double(key % 6) + 0.5) / 6
            layer.fill(path, with: .color(color(blend(Self.nodeCool, Self.nodeMiddle, Self.nodeWarm, warm), alpha)))
        }
    }

    private func signals(_ layer: inout GraphicsContext) {
        for dot in scene.signals {
            let r = max(0.6, dot.radius * radius)
            let tone = mix(Self.signalCool, Self.signalWarm, dot.warmth)
            if dot.halo > 0.05 {
                layer.fill(circle(dot.x, dot.y, r * 3), with: .color(color(tone, dot.halo * 0.16)))
            }
            layer.fill(circle(dot.x, dot.y, r), with: .color(color(tone, dot.alpha)))
        }
    }

    // MARK: Glass rim

    private func rim(_ layer: inout GraphicsContext) {
        let m = motion
        let breathing = 0.5 + 0.5 * sin(frame.time * 1.7)
        var lively = 1 + m.surge * 0.9
        lively += m.speak * m.speech * 1.1
        lively += m.listen * breathing * 0.18
        let strength = (0.62 + 0.53 * m.awake) * lively * clamp(0.6 + 0.4 * scene.outerGain, 0, 1.3)
        let steps = 48
        var stops: [Gradient.Stop] = []
        let deep = JarvisOrbAppearance.deep
        let cool = JarvisOrbAppearance.cool
        let warm = JarvisOrbAppearance.warm
        for step in 0...steps {
            let rho = Double(step) / Double(steps)
            let edge = pow(1 - (1 - rho * rho).squareRoot(), 2.7)
            let front = exp(-pow((edge - m.wave) * 7, 2)) * m.waveStrength
            let ripple = pow(0.5 + 0.5 * sin(edge * 19 - frame.time * 3.4), 10) * m.listen * (0.28 + m.input * 1.6)
            let inward = pow(0.5 + 0.5 * sin(edge * 15 + frame.time * 2.7), 12) * m.think * 0.55
            let voiceRing = pow(0.5 + 0.5 * sin(edge * 10 - frame.time * 5.2), 6) * m.speak * m.speech * 1.4
            let glow = edge * 1.5 * strength * (0.62 + 0.38 * m.awake)
            var r = deep.r * glow * 0.9
            var g = deep.g * glow * 1.1
            var b = deep.b * glow
            let ring = (ripple + voiceRing) * (0.35 + edge * 0.8)
            r += cool.r * ring; g += cool.g * ring; b += cool.b * ring
            let wave = JarvisOrbMotion.smoothstep(0.1, 0.7, m.wave)
            let frontMix = front * 1.6
            r += (warm.r * (1 - wave) + 0.62 * wave) * frontMix
            g += (warm.g * (1 - wave) + 0.9 * wave) * frontMix
            b += (warm.b * (1 - wave) + 1.0 * wave) * frontMix
            let tide = inward * (1 - edge * 0.4)
            r += (cool.r * 0.65 + warm.r * 0.35) * tide
            g += (cool.g * 0.65 + warm.g * 0.35) * tide
            b += (cool.b * 0.65 + warm.b * 0.35) * tide
            let alpha = edge * 0.3 + 0.004 + front * 0.5 + (ripple + voiceRing + inward) * 0.22
            let peak = max(r, g, b, 1)
            stops.append(.init(color: color((r / peak, g / peak, b / peak), clamp(alpha, 0, 0.86)), location: rho))
        }
        layer.fill(
            circle(0, 0, radius),
            with: .radialGradient(Gradient(stops: stops), center: center, startRadius: 0, endRadius: CGFloat(radius))
        )
    }

    /// The lit edge of the glass: cyan along the upper left, a warm amber rim on the lower right and a soft inner
    /// highlight, as if one cool and one warm light were catching it. Conic angles run clockwise from three o'clock.
    private func limb(_ layer: inout GraphicsContext) {
        let m = motion
        let lift = (0.55 + 0.45 * m.awake) * (1 + 0.25 * m.surge + 0.2 * m.listen * m.input)
            * clamp(0.7 + 0.3 * scene.outerGain, 0, 1.3)
        let cyan: RGB = (0.42, 0.88, 1.0)
        let blue: RGB = (0.16, 0.5, 0.95)
        let amber: RGB = (1.0, 0.44, 0.06)
        let stops: [(angle: Double, tone: RGB, level: Double)] = [
            (0, blue, 0.34), (22, amber, 0.45), (40, amber, 0.95), (60, amber, 1.0), (84, amber, 0.9), (108, amber, 0.4),
            (132, cyan, 0.36), (160, cyan, 0.6), (185, cyan, 0.9), (212, cyan, 1.0), (245, cyan, 0.8), (285, cyan, 0.45),
            (330, blue, 0.28), (360, blue, 0.34),
        ]
        func ring(inset: Double, thickness: Double, strength: Double) {
            let shading = GraphicsContext.Shading.conicGradient(
                Gradient(stops: stops.map { Gradient.Stop(color: color($0.tone, $0.level * strength * lift), location: $0.angle / 360) }),
                center: center
            )
            let side = radius * (1 - inset)
            let rect = CGRect(
                x: center.x - CGFloat(side), y: center.y - CGFloat(side),
                width: CGFloat(side * 2), height: CGFloat(side * 2)
            )
            layer.stroke(Path(ellipseIn: rect), with: shading, lineWidth: CGFloat(radius * thickness))
        }
        if scene.detail != .minimal {
            ring(inset: 0.05, thickness: 0.08, strength: 0.3)
            ring(inset: 0.02, thickness: 0.034, strength: 0.7)
        }
        ring(inset: 0.006, thickness: 0.014, strength: 1)
        ring(inset: 0.003, thickness: 0.005, strength: 0.9)
        guard scene.detail != .minimal else { return }
        // The soft inner highlight sits just inside the cyan side.
        let sheen = GraphicsContext.Shading.conicGradient(
            Gradient(stops: [
                .init(color: color(cyan, 0), location: 0),
                .init(color: color(cyan, 0), location: 150 / 360),
                .init(color: color((0.8, 0.95, 1.0), 0.2 * lift), location: 215 / 360),
                .init(color: color(cyan, 0), location: 275 / 360),
                .init(color: color(cyan, 0), location: 1),
            ]),
            center: center
        )
        let side = radius * 0.93
        let rect = CGRect(
            x: center.x - CGFloat(side), y: center.y - CGFloat(side), width: CGFloat(side * 2), height: CGFloat(side * 2)
        )
        layer.stroke(Path(ellipseIn: rect), with: sheen, lineWidth: CGFloat(radius * 0.1))
    }
}
#endif
