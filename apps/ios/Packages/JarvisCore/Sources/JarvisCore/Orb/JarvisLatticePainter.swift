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

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var clock = JarvisLatticeClock()

    /// `isStatic` draws one still pose (Live Activities, widgets, previews). `isPaused` holds the current frame
    /// while the orb is covered.
    public init(activity: JarvisOrbActivity, isStatic: Bool = false, isPaused: Bool = false) {
        self.activity = activity
        self.isStatic = isStatic
        self.isPaused = isPaused
    }

    public var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            Group {
                if isStatic || reduceMotion {
                    orb(frame: clock.frame(at: nil, activity: activity), side: side)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: isPaused || scenePhase != .active)) { timeline in
                        orb(frame: clock.frame(at: timeline.date, activity: activity), side: side)
                    }
                }
            }
            .frame(width: side, height: side)
        }
        .aspectRatio(1, contentMode: .fit)
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
    private static let edgeWarm: RGB = (1.0, 0.56, 0.08)
    private static let nodeCool: RGB = (0.58, 0.92, 1.0)
    private static let nodeWarm: RGB = (1.0, 0.68, 0.2)
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
    }

    // MARK: Dark glass

    private func glass(_ context: inout GraphicsContext) {
        let shading = GraphicsContext.Shading.radialGradient(
            Gradient(stops: [
                .init(color: Color(red: 0.012, green: 0.03, blue: 0.075).opacity(0.92), location: 0),
                .init(color: Color(red: 0.014, green: 0.05, blue: 0.12).opacity(0.92), location: 0.72),
                .init(color: Color(red: 0.03, green: 0.15, blue: 0.36).opacity(0.95), location: 1),
            ]),
            center: center, startRadius: 0, endRadius: CGFloat(radius)
        )
        context.fill(circle(0, 0, radius), with: shading)
    }

    // MARK: Heart

    private func heartGlow(_ layer: inout GraphicsContext) {
        let heart = scene.heart
        let p = point(heart.x, heart.y)
        let r = heart.radius * radius * 1.3
        layer.fill(
            circle(heart.x, heart.y, r),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: color(JarvisLatticePainter.edgeWarm, heart.intensity * 0.5), location: 0),
                    .init(color: color(JarvisLatticePainter.edgeWarm, heart.intensity * 0.2), location: 0.45),
                    .init(color: color(JarvisLatticePainter.edgeWarm, 0), location: 1),
                ]),
                center: p, startRadius: 0, endRadius: CGFloat(r)
            )
        )
    }

    private func heartCore(_ layer: inout GraphicsContext) {
        let heart = scene.heart
        let p = point(heart.x, heart.y)
        let r = radius * 0.11 * (1 + heart.heat)
        let hot = JarvisOrbAppearance.hot
        let warm = JarvisOrbAppearance.warm
        layer.fill(
            circle(heart.x, heart.y, r),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: color((hot.r, hot.g, hot.b), heart.heat * 0.9), location: 0),
                    .init(color: color((warm.r, warm.g, warm.b), heart.heat * 0.3), location: 0.4),
                    .init(color: color((warm.r, warm.g, warm.b), 0), location: 1),
                ]),
                center: p, startRadius: 0, endRadius: CGFloat(r)
            )
        )
    }

    // MARK: Connections

    /// Connections are merged into a few paths by colour and brightness, so a frame costs a few dozen strokes
    /// however many nodes there are.
    private func edges(_ layer: inout GraphicsContext) {
        let width = max(0.5, radius * 0.003 * scene.detail.lineScale)
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
            let tone = mix(Self.edgeCool, Self.edgeWarm, warm / Double(Self.warmBuckets))
            layer.stroke(path, with: .color(color(tone, alpha)), style: StrokeStyle(lineWidth: width, lineCap: .round))
            if scene.detail != .minimal, warm / Double(Self.warmBuckets) > 0.35 {
                layer.stroke(
                    path,
                    with: .color(color(tone, alpha * 0.12 * warm / Double(Self.warmBuckets))),
                    style: StrokeStyle(lineWidth: width * 3.2, lineCap: .round)
                )
            }
        }
        for (key, path) in glows {
            let warm = Double(key / 4) + 0.5
            let light = (Double(key % 4) + 0.5) / 4
            let tone = mix(Self.edgeCool, Self.edgeWarm, warm / Double(Self.warmBuckets))
            layer.stroke(path, with: .color(color(tone, light * 0.22)), style: StrokeStyle(lineWidth: width * 2.4, lineCap: .round))
        }
    }

    // MARK: Nodes

    private func dots(_ layer: inout GraphicsContext) {
        var bodies: [Int: Path] = [:]
        var halos: [Int: Path] = [:]
        for dot in scene.dots {
            let r = max(0.6, dot.radius * radius)
            let warm = min(3, Int(dot.warmth * 4))
            let alpha = min(5, Int(dot.alpha * 6))
            bodies[warm * 6 + alpha, default: Path()].addEllipse(in: square(dot.x, dot.y, r))
            if dot.halo > 0.05 {
                let level = min(2, Int(dot.halo * 3))
                halos[warm * 3 + level, default: Path()].addEllipse(in: square(dot.x, dot.y, r * 3))
            }
        }
        for (key, path) in halos {
            let warm = (Double(key / 3) + 0.5) / 4
            let level = (Double(key % 3) + 0.5) / 3
            layer.fill(path, with: .color(color(mix(Self.nodeCool, Self.nodeWarm, warm), level * 0.14)))
        }
        for (key, path) in bodies {
            let warm = (Double(key / 6) + 0.5) / 4
            let alpha = (Double(key % 6) + 0.5) / 6
            layer.fill(path, with: .color(color(mix(Self.nodeCool, Self.nodeWarm, warm), alpha)))
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
            let glow = edge * 2.25 * strength * (0.62 + 0.38 * m.awake)
            let white = pow(edge, 6) * 0.55 * strength
            var r = deep.r * glow * 0.9 + 0.48 * white
            var g = deep.g * glow * 1.1 + 0.78 * white
            var b = deep.b * glow + white
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
            let alpha = edge * 0.62 + 0.004 + front * 0.5 + (ripple + voiceRing + inward) * 0.22
            let peak = max(r, g, b, 1)
            stops.append(.init(color: color((r / peak, g / peak, b / peak), clamp(alpha, 0, 0.86)), location: rho))
        }
        layer.fill(
            circle(0, 0, radius),
            with: .radialGradient(Gradient(stops: stops), center: center, startRadius: 0, endRadius: CGFloat(radius))
        )
        guard scene.detail != .minimal else { return }
        let lift = clamp(0.5 + 0.5 * m.awake, 0, 1)
        arc(&layer, centre: 225, spread: 55, tone: (0.6, 0.9, 1.0), alpha: 0.55 * lift)
        arc(&layer, centre: 50, spread: 45, tone: (1.0, 0.62, 0.15), alpha: 0.8 * lift)
    }

    /// A bright stretch of the limb that fades out at both ends: the light catching the glass.
    private func arc(_ layer: inout GraphicsContext, centre: Double, spread: Double, tone: RGB, alpha: Double) {
        for (index, strength) in [(0.03, 0.18), (0.015, 0.4), (0.006, 1.0)].enumerated() {
            let narrow = spread - Double(index) * 6
            let low = (centre - narrow) / 360, mid = centre / 360, high = (centre + narrow) / 360
            let clear = color(tone, 0)
            let shading = GraphicsContext.Shading.conicGradient(
                Gradient(stops: [
                    .init(color: clear, location: 0),
                    .init(color: clear, location: low),
                    .init(color: color(tone, alpha * strength.1), location: mid),
                    .init(color: clear, location: high),
                    .init(color: clear, location: 1),
                ]),
                center: center
            )
            let inset = radius * 0.012
            let rect = CGRect(
                x: center.x - CGFloat(radius - inset), y: center.y - CGFloat(radius - inset),
                width: CGFloat((radius - inset) * 2), height: CGFloat((radius - inset) * 2)
            )
            layer.stroke(Path(ellipseIn: rect), with: shading, lineWidth: CGFloat(radius * strength.0))
        }
    }
}
#endif
