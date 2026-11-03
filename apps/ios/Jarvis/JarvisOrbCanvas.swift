import JarvisCore
import SwiftUI

/// The one orb drawing: a native port of the web stage orb (apps/web/src/JarvisStageOrb.ts, motion in
/// apps/web/src/jarvis-orb-motion.ts, Canvas version in InputOrbCore.tsx): a dark glass sphere with a cyan rim,
/// woven ribbons and drifting motes, around a tangled amber core of filaments and sparks. The motion model and the seeded
/// geometry live in JarvisCore (`JarvisOrbAnimator`, `JarvisOrbGeometry`) and are shared with the unit tests.
/// Use it only through `JarvisOrb`.
/// API: SwiftUI.TimelineView, SwiftUI.Canvas, GraphicsContext.
struct JarvisOrbCanvas: View {
    let activity: JarvisOrbActivity
    var isStatic = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var clock = JarvisOrbClock()

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            if isStatic || reduceMotion {
                orb(frame: clock.frame(at: nil, activity: activity), side: side)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                    orb(frame: clock.frame(at: timeline.date, activity: activity), side: side)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func orb(frame: JarvisOrbFrame, side: CGFloat) -> some View {
        let activity = activity
        return Canvas { context, size in
            JarvisOrbPainter(frame: frame, activity: activity, size: size).paint(&context)
        }
        .frame(width: side, height: side)
    }
}

/// Holds the animator between frames. The timeline drives it from the main actor only.
final class JarvisOrbClock {
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

private struct JarvisOrbTone {
    static let cool = (r: 0x52 / 255.0, g: 0xdc / 255.0, b: 0xfa / 255.0)
    static let warm = (r: 0xff / 255.0, g: 0xb4 / 255.0, b: 0x5c / 255.0)
}

private struct JarvisOrbPainter {
    let frame: JarvisOrbFrame
    let activity: JarvisOrbActivity
    let size: CGSize

    private var motion: JarvisOrbMotionFrame { frame.motion }
    private var half: Double { Double(min(size.width, size.height)) / 2 }
    private var center: CGPoint { CGPoint(x: size.width / 2, y: size.height / 2) }
    /// Points per unit of the web orb's scene space (the shell has radius 1.12).
    private var unit: Double { half * 0.95 / 1.12 * frame.scale }
    private var isSmall: Bool { half < 40 }

    private func clamp(_ value: Double, _ low: Double = 0, _ high: Double = 1) -> Double { max(low, min(high, value)) }
    private func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double { JarvisOrbMotion.smoothstep(a, b, x) }

    /// Mutes colour for the muted, reconnecting and offline orbs.
    private func color(_ rgb: (r: Double, g: Double, b: Double), _ opacity: Double, boost: Double = 1) -> Color {
        let gray = 0.3 * rgb.r + 0.59 * rgb.g + 0.11 * rgb.b
        let s = activity.saturation
        func channel(_ v: Double) -> Double { clamp((gray + (v - gray) * s) * boost) }
        return Color(red: channel(rgb.r), green: channel(rgb.g), blue: channel(rgb.b)).opacity(clamp(opacity))
    }

    private func screen(_ p: JarvisOrbVector) -> CGPoint {
        CGPoint(x: center.x + CGFloat(p.x * unit), y: center.y - CGFloat(p.y * unit))
    }

    private var energy: Double {
        let u = frame.time
        let idle = 1 - smooth(0.02, 0.22, max(motion.awake, motion.ignite))
        let breath = 0.5 + 0.5 * sin(u * 0.38 + sin(u * 0.09) * 0.72)
        let heart = pow(max(0, sin(u * 0.72 + sin(u * 0.13) * 0.58)), 12)
        let lift: Double = 0.5 + 0.35 * max(motion.awake, motion.ignite)
        let pulse: Double = 0.82 + 0.3 * heart + idle * (0.18 + 0.22 * breath)
        var total: Double = lift * pulse
        total += motion.surge * 0.3
        total += motion.speak * motion.speech * 0.75
        total += motion.think * 0.38
        total += motion.tool * 0.3
        total += motion.listen * motion.input * 0.55
        return total
    }

    func paint(_ context: inout GraphicsContext) {
        glass(&context)
        core(&context)
        rim(&context)
        ribbons(&context)
        motes(&context)
        comets(&context)
    }

    // MARK: Dark glass

    private func glass(_ context: inout GraphicsContext) {
        let radius = CGFloat(1.12 * unit)
        let disc = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
        let shading = GraphicsContext.Shading.radialGradient(
            Gradient(stops: [
                .init(color: Color(red: 0.02, green: 0.04, blue: 0.07).opacity(0.5), location: 0),
                .init(color: Color(red: 0.01, green: 0.02, blue: 0.04).opacity(0.78), location: 1),
            ]),
            center: center, startRadius: 0, endRadius: radius
        )
        context.fill(disc, with: shading)
    }

    // MARK: Shell rim (the web fresnel shader, as a radial profile)

    private func rim(_ context: inout GraphicsContext) {
        let radius = CGFloat(1.12 * unit)
        let m = motion
        let breathing: Double = 0.5 + 0.5 * sin(frame.time * 1.7)
        var lively: Double = 1 + m.surge * 0.9
        lively += m.speak * m.speech * 1.1
        lively += m.listen * breathing * 0.18
        let strength: Double = (0.62 + 0.53 * m.awake) * lively
        let steps = 72
        var stops: [Gradient.Stop] = []
        for step in 0...steps {
            let rho = Double(step) / Double(steps)
            let rim = pow(1 - (1 - rho * rho).squareRoot(), 2.7)
            let voice = m.speak * m.speech
            let front = exp(-pow((rim - m.wave) * 7, 2)) * m.waveStrength
            let ripple = pow(0.5 + 0.5 * sin(rim * 19 - frame.time * 3.4), 10) * m.listen * (0.28 + m.input * 1.6)
            let inward = pow(0.5 + 0.5 * sin(rim * 15 + frame.time * 2.7), 12) * m.think * 0.55
            let voiceRing = pow(0.5 + 0.5 * sin(rim * 10 - frame.time * 5.2), 6) * voice * 1.4
            let cool = JarvisOrbTone.cool
            let base = 0.62 + 0.38 * m.awake
            let glow = rim * 2.25 * strength * base
            let white = pow(rim, 6) * 0.55 * strength
            let wave = smooth(0.1, 0.7, m.wave)
            var r = cool.r * glow + 0.48 * white
            var g = cool.g * glow + 0.78 * white
            var b = cool.b * glow + 1.0 * white
            let ring = (ripple + voiceRing) * (0.35 + rim * 0.8)
            r += cool.r * ring; g += cool.g * ring; b += cool.b * ring
            let warm = JarvisOrbTone.warm
            let frontMix = front * 1.6
            r += (warm.r * (1 - wave) + 0.62 * wave) * frontMix
            g += (warm.g * (1 - wave) + 0.9 * wave) * frontMix
            b += (warm.b * (1 - wave) + 1.0 * wave) * frontMix
            let tide = inward * (1 - rim * 0.4)
            r += (cool.r * 0.65 + warm.r * 0.35) * tide
            g += (cool.g * 0.65 + warm.g * 0.35) * tide
            b += (cool.b * 0.65 + warm.b * 0.35) * tide
            let alpha = rim * 0.66 + 0.004 + front * 0.5 + (ripple + voiceRing + inward) * 0.22
            let peak = max(r, g, b, 1)
            stops.append(.init(
                color: color((r / peak, g / peak, b / peak), clamp(alpha, 0, 0.86)),
                location: rho
            ))
        }
        let shading = GraphicsContext.Shading.radialGradient(Gradient(stops: stops), center: center, startRadius: 0, endRadius: radius)
        var layer = context
        layer.blendMode = .plusLighter
        layer.fill(Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)), with: shading)
    }

    // MARK: Ribbons

    private func ribbons(_ context: inout GraphicsContext) {
        let m = motion
        let sway: Double = 1 + (1 - m.awake) * 0.08 * sin(frame.time * 1.1)
        var push: Double = 1 + m.surge * 0.8
        push += m.speak * m.speech * 0.9
        push += m.tool * 0.35
        let light: Double = (0.46 + 0.54 * m.awake) * sway * push
        let stride = isSmall ? 2 : 1
        var layer = context
        layer.blendMode = .plusLighter
        let flowSpeed = 0.24 + m.tool * 2.6 + m.think * 0.5
        for ribbon in JarvisOrbGeometry.shell.ribbons {
            var previous: (point: CGPoint, rim: Double)?
            for index in Swift.stride(from: 0, through: ribbon.points.count - 1, by: stride) {
                let source = ribbon.points[index]
                let turned = JarvisOrbVector(
                    source.x * cos(frame.ribbonAngle) + source.z * sin(frame.ribbonAngle),
                    source.y,
                    -source.x * sin(frame.ribbonAngle) + source.z * cos(frame.ribbonAngle)
                )
                let p = screen(turned)
                let rim = 1 - min(1, abs(turned.z) / 1.125)
                if let previous {
                    let u = Double(index) / Double(ribbon.points.count - 1)
                    let envelope = smooth(0, 0.08, u) * smooth(0, 0.08, 1 - u)
                    let flow = pow(0.5 + 0.5 * sin(u * 12 - frame.time * flowSpeed), 2)
                    let body: Double = (ribbon.isWide ? 0.1 : 0.07) * envelope * (0.35 + 0.65 * rim) * light
                    let sheen: Double = ribbon.isWide ? flow * 0.1 * light : 0
                    let opacity = body + sheen
                    if opacity > 0.01 {
                        var path = Path()
                        path.move(to: previous.point)
                        path.addLine(to: p)
                        let width = max(0.6, CGFloat(ribbon.halfWidth[index] * unit * (ribbon.isWide ? 1.3 : 2)))
                        layer.stroke(
                            path,
                            with: .color(color(JarvisOrbTone.cool, opacity, boost: 1.2)),
                            style: StrokeStyle(lineWidth: width, lineCap: .round)
                        )
                    }
                }
                previous = (p, rim)
            }
        }
    }

    // MARK: Motes

    private func motes(_ context: inout GraphicsContext) {
        guard !isSmall || motion.awake > 0.05 else { return }
        let m = motion
        let spin = -frame.time * 0.012
        let stride = isSmall ? 3 : 1
        var layer = context
        layer.blendMode = .plusLighter
        for index in Swift.stride(from: 0, to: JarvisOrbGeometry.shell.motes.count, by: stride) {
            let mote = JarvisOrbGeometry.shell.motes[index]
            let seed = mote.seed
            let ripple = sin(frame.time * 2.4 - seed * 9) * m.listen * (0.012 + m.input * 0.03)
            var grow: Double = 1 + sin(frame.time * 0.3 + seed * 12) * 0.005
            grow += ripple
            grow += m.surge * 0.06 * (1 - m.wave)
            grow += m.waveStrength * 0.05 * m.wave
            let x = mote.position.x * cos(spin) + mote.position.z * sin(spin)
            let z = -mote.position.x * sin(spin) + mote.position.z * cos(spin)
            guard z > -0.15 else { continue }
            let twinkle = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(frame.time * (0.25 + m.tool * 1.4) + seed * 50), 4)
            var level: Double = 0.28 + 0.47 * m.awake
            level += m.speak * m.speech * 0.4
            level += m.surge * 0.5
            level += m.waveStrength * 0.35
            let alpha: Double = level * twinkle
            guard alpha > 0.04 else { continue }
            let p = screen(JarvisOrbVector(x * grow, mote.position.y * grow, z * grow))
            let radius = max(0.45, CGFloat(unit * (0.011 + 0.011 * m.awake)))
            layer.fill(
                Path(ellipseIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)),
                with: .color(color((0.51, 0.9, 0.99), clamp(alpha * 0.9)))
            )
        }
    }

    // MARK: Tool comets

    private func comets(_ context: inout GraphicsContext) {
        guard motion.tool > 0.02 else { return }
        var layer = context
        layer.blendMode = .plusLighter
        let head = frame.time * 2.3
        let paths: [(angle: Double, latitude: Double, weight: Double)] = [
            (head, 0.35 * sin(head * 0.5), 1),
            (-head * 0.8 - 2.1, -0.3, 0.6),
        ]
        for comet in paths {
            for tail in 0..<7 {
                let behind = Double(tail) * 0.09
                let angle = comet.angle - behind * (comet.weight == 1 ? 1 : -1)
                let lat = comet.latitude
                let point = JarvisOrbVector(
                    cos(angle) * cos(lat) * 1.12, sin(lat) * 1.12, sin(angle) * cos(lat) * 1.12
                )
                guard point.z > 0 else { continue }
                let p = screen(point)
                let fade = pow(1 - Double(tail) / 7, 2) * comet.weight * motion.tool
                let radius = CGFloat(unit * 0.05 * (1 - Double(tail) * 0.1))
                layer.fill(
                    Path(ellipseIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)),
                    with: .color(color((0.75, 0.95, 1), fade * 0.8))
                )
            }
        }
    }

    // MARK: Amber core

    private func core(_ context: inout GraphicsContext) {
        let m = motion
        let geometry = JarvisOrbGeometry.shell
        let flow = frame.coreFlow
        let time = frame.time
        let energy = self.energy
        let stir = 0.03 + 0.028 * m.awake + m.tool * 0.02
        let shrink = 1 - m.think * 0.12 * (0.5 + 0.5 * sin(time * 3.1))
        let tilt = (x: sin(flow * 0.55) * 0.2, y: flow * 0.32, z: cos(flow * 0.4) * 0.12)
        let warm = JarvisOrbTone.warm
        var layer = context
        layer.blendMode = .plusLighter

        func place(_ p: JarvisOrbVector) -> JarvisOrbVector {
            JarvisOrbVector(p.x, p.y, p.z).rotated(x: tilt.x, y: tilt.y, z: tilt.z)
        }
        func scaled(_ p: JarvisOrbVector, by factor: Double) -> JarvisOrbVector {
            JarvisOrbVector(p.x * factor, p.y * factor, p.z * factor)
        }
        func stirred(_ p: JarvisOrbVector) -> JarvisOrbVector {
            let moved = JarvisOrbVector(
                p.x + sin(p.y * 17 + flow) * stir,
                p.y + cos(p.z * 13 - flow * 0.8) * stir,
                p.z + sin(p.x * 15 + flow * 0.7) * stir
            )
            return scaled(moved, by: shrink * 1.13)
        }

        // A soft amber glow keeps the tangle readable at small sizes.
        let glowRadius = CGFloat(unit * 0.62)
        layer.fill(
            Path(ellipseIn: CGRect(x: center.x - glowRadius, y: center.y - glowRadius, width: glowRadius * 2, height: glowRadius * 2)),
            with: .radialGradient(
                Gradient(colors: [color(warm, 0.1 + 0.16 * clamp(energy)), color(warm, 0)]),
                center: center, startRadius: 0, endRadius: glowRadius
            )
        )

        let width = max(0.6, CGFloat(unit * 0.011))
        let segments = isSmall ? 2 : 4
        for link in geometry.links {
            let a = stirred(geometry.nodes[link.from])
            let b = stirred(geometry.nodes[link.to])
            let bend = scaled(link.bend, by: 1.13)
            let c1 = JarvisOrbVector(a.x + (b.x - a.x) * 0.35 + bend.x, a.y + (b.y - a.y) * 0.35 + bend.y, a.z + (b.z - a.z) * 0.35 + bend.z)
            let c2 = JarvisOrbVector(a.x + (b.x - a.x) * 0.7 + bend.x, a.y + (b.y - a.y) * 0.7 + bend.y, a.z + (b.z - a.z) * 0.7 + bend.z)
            var previous = screen(place(a))
            for step in 1...segments {
                let t = Double(step) / Double(segments)
                let inv = 1 - t
                let w0 = inv * inv * inv, w1 = 3 * inv * inv * t, w2 = 3 * inv * t * t, w3 = t * t * t
                let p = JarvisOrbVector(
                    w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
                    w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
                    w0 * a.z + w1 * c1.z + w2 * c2.z + w3 * b.z
                )
                let next = screen(place(p))
                let pulse = pow(0.5 + 0.5 * sin(t * 8 - flow * 2.5), 8)
                let fire = pow(0.5 + 0.5 * sin(t * 15 + time * (1.6 + m.tool * 4 + m.think * 2)), 18) * (0.55 + m.tool * 0.9 + m.think * 0.6)
                let lit = max(pulse, fire)
                let alpha = min(1, energy * (0.66 + pulse * 0.28 + fire * 0.5))
                var path = Path()
                path.move(to: previous)
                path.addLine(to: next)
                layer.stroke(
                    path,
                    with: .color(color(
                        (warm.r, warm.g * (0.8 + 0.2 * lit), warm.b * (0.7 + 0.3 * lit)),
                        alpha * (isSmall ? 0.9 : 0.75),
                        boost: 1.0 + lit * 0.25
                    )),
                    style: StrokeStyle(lineWidth: width, lineCap: .round)
                )
                previous = next
            }
        }

        if !isSmall {
            for loop in geometry.loops {
                var path = Path()
                for (index, point) in loop.enumerated() {
                    let p = screen(place(stirred(point)))
                    if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
                }
                layer.stroke(path, with: .color(color(warm, min(1, energy * 0.4))), style: StrokeStyle(lineWidth: max(0.5, width * 0.6)))
            }
        }

        let ignite = max(m.awake, m.ignite)
        let stride = isSmall ? 2 : 1
        for index in Swift.stride(from: 0, to: geometry.sparks.count, by: stride) {
            let spark = geometry.sparks[index]
            let seed = spark.seed
            let jitter = 0.026 + 0.03 * m.awake + m.listen * m.input * 0.04
            var p = JarvisOrbVector(
                spark.position.x + sin(flow + seed * 12) * jitter,
                spark.position.y + cos(flow * 0.8 + seed * 17) * jitter,
                spark.position.z + sin(flow * 0.7 - seed * 9) * jitter
            )
            let inflow = (time * (0.55 + m.think * 0.5) + seed).truncatingRemainder(dividingBy: 1)
            let inward: Double = 1 + (0.2 - inflow * 0.9) * m.think
            var swell: Double = 1 + m.surge * 0.35
            swell += m.speak * m.speech * 0.45
            swell += m.tool * 0.08 * sin(time * 6 + seed * 30)
            let factor: Double = inward * swell
            p = scaled(p, by: factor * 1.13)
            var lit: Double = 0.5 + 0.6 * ignite
            lit += 0.35 * m.surge
            lit += 0.6 * m.speak * m.speech
            lit += 0.35 * m.think
            lit += 0.3 * m.tool
            lit += 0.5 * m.listen * m.input
            let twinkle: Double = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(flow * 2.2 + seed * 21), 4)
            let vEnergy = min(1, lit * twinkle)
            let diameter = clamp(
                spark.size * (60 + m.awake * 70 + m.speak * m.speech * 40) / 4.54, 0.8, 13
            )
            let radius = max(0.45, CGFloat(unit * diameter * 0.0034))
            let point = screen(place(p))
            layer.fill(
                Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)),
                with: .color(color(warm, vEnergy * 0.9, boost: 1.1))
            )
        }
    }
}
