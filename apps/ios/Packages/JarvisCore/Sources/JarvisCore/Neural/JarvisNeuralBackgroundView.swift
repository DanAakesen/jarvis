#if canImport(SwiftUI)
import SwiftUI

/// Where the orb sits on a screen that shows one, so the network fans out from it and is cut out behind it.
public enum JarvisNeuralOrb: Equatable {
    /// No orb on this screen: the lines dissolve into a faint ember where the orb would be.
    case hidden
    /// The orb's centre and radius in the background's own coordinate space.
    case shown(center: CGPoint, radius: CGFloat)
}

/// The one living background of the app: the opening screen's sparse network of dim cyan nodes and long angular
/// links, with neurons that fire out from the orb along the links and come back. Drive it with the orb's activity
/// (`JarvisOrbActivity`) and an effects level: `.full` on voice, chat and the opening, `.calm` everywhere else,
/// `.still` for one frozen pose. It is real drawing, never an image: a static Canvas for the network and a second
/// Canvas, redrawn by a timeline, for the signals. Use it through the app's `JarvisNeuralBackground`.
/// It pauses while the app is inactive or `isPaused` is set, and Reduce Motion draws the still pose.
/// API: SwiftUI.TimelineView, SwiftUI.Canvas, GraphicsContext.
public struct JarvisNeuralBackgroundView: View {
    let activity: JarvisOrbActivity
    let effects: JarvisNeuralEffects
    let orb: JarvisNeuralOrb
    let isPaused: Bool
    let intensity: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(JarvisNeuralEffects.motionEnabledKey) private var motionEnabled = true
    @State private var clock = JarvisNeuralClock()
    @State private var isCheap = JarvisNeuralRendering.usesCheapPath

    /// `intensity` scales how bright the lines and signals are (1 on voice and the opening, less behind chat text).
    public init(
        activity: JarvisOrbActivity = .calm,
        effects: JarvisNeuralEffects = .calm,
        orb: JarvisNeuralOrb = .hidden,
        isPaused: Bool = false,
        intensity: Double = 1
    ) {
        self.activity = activity
        self.effects = effects
        self.orb = orb
        self.isPaused = isPaused
        self.intensity = intensity
    }

    private var isStill: Bool { effects == .still || reduceMotion || !motionEnabled }

    public var body: some View {
        GeometryReader { proxy in
            let geometry = JarvisNeuralGeometry(size: proxy.size, orb: orb)
            let palette = JarvisNeuralPalette(selection: JarvisPalette.shared.selection, isDark: colorScheme == .dark, saturation: activity.saturation, isCheap: isCheap)
            ZStack {
                Canvas { context, _ in
                    JarvisNeuralPainter.paintNetwork(&context, geometry: geometry, palette: palette, intensity: intensity)
                }
                if !isStill {
                    let interval = JarvisNeuralRendering.frameInterval(effects, isCheap: isCheap)
                    TimelineView(.animation(minimumInterval: interval, paused: isPaused || scenePhase != .active)) { timeline in
                        let frame = clock.frame(at: timeline.date, activity: activity, effects: effects)
                        let scene = JarvisNeuralScene.make(layout: geometry.layout, frame: frame)
                        Canvas { context, _ in
                            JarvisNeuralPainter.paintSignals(
                                &context, geometry: geometry, palette: palette, scene: scene, intensity: intensity
                            )
                        }
                    }
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            isCheap = JarvisNeuralRendering.usesCheapPath
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// When the background draws its cheap path: no additive glow passes and fewer frames. The Simulator renders in
/// software (a 60 fps canvas of blended glows starves it and its capture tooling), and Low Power Mode asks apps to
/// spend less. A device on normal power always gets the quality path.
public enum JarvisNeuralRendering {
    public static var usesCheapPath: Bool {
#if targetEnvironment(simulator)
        true
#else
        ProcessInfo.processInfo.isLowPowerModeEnabled
#endif
    }

    static func frameInterval(_ effects: JarvisNeuralEffects, isCheap: Bool) -> Double {
        switch (effects, isCheap) {
        case (.full, false): 1.0 / 60.0
        case (.full, true): 1.0 / 20.0
        case (_, false): 1.0 / 20.0
        case (_, true): 1.0 / 10.0
        }
    }
}

/// Holds the animator between frames. The timeline drives it from the main actor only.
final class JarvisNeuralClock {
    private var animator = JarvisNeuralAnimator()
    private var start: Date?

    func frame(at date: Date, activity: JarvisOrbActivity, effects: JarvisNeuralEffects) -> JarvisNeuralFrame {
        let origin = start ?? date
        start = origin
        return animator.advance(to: date.timeIntervalSince(origin), activity: activity, effects: effects, reducedMotion: false)
    }
}

/// The screen's measurements: the network's layout and where the orb is cut out.
struct JarvisNeuralGeometry {
    let size: CGSize
    let layout: JarvisNeuralLayout
    let hasOrb: Bool
    let network = JarvisNeuralNetwork.shared

    init(size: CGSize, orb: JarvisNeuralOrb) {
        self.size = size
        switch orb {
        case .hidden:
            layout = JarvisNeuralLayout(width: Double(size.width), height: Double(size.height))
            hasOrb = false
        case .shown(let center, let radius):
            layout = JarvisNeuralLayout(
                width: Double(size.width), height: Double(size.height),
                orbX: Double(center.x), orbY: Double(center.y), orbRadius: Double(radius)
            )
            hasOrb = radius > 0
        }
    }

    var orbCenter: CGPoint { CGPoint(x: layout.orbX, y: layout.orbY) }

    /// The radius lines dissolve around when there is no orb.
    var emberRadius: Double { Double(min(size.width, size.height)) * 0.22 }

    func point(_ index: Int) -> CGPoint {
        let p = layout.point(of: index, in: network)
        return CGPoint(x: p.x, y: p.y)
    }

    /// How bright a line is at a distance from the orb centre: full far away, about 40% at the sphere's edge, and
    /// fading out completely at the centre when there is no orb.
    func fade(_ distance: Double) -> Double {
        func smooth(_ t: Double) -> Double {
            let c = max(0, min(1, t))
            return c * c * (3 - 2 * c)
        }
        if hasOrb {
            return 0.4 + 0.6 * smooth((distance - layout.orbRadius) / (layout.orbRadius * 1.6))
        }
        return smooth((distance - emberRadius * 0.2) / (emberRadius * 1.4))
    }

    /// Clips out the orb's disc so nothing is drawn over the sphere.
    func cutOutOrb(_ context: inout GraphicsContext) {
        guard hasOrb else { return }
        var visible = Path(CGRect(origin: .zero, size: size))
        visible.addEllipse(in: CGRect(
            x: layout.orbX - layout.orbRadius, y: layout.orbY - layout.orbRadius,
            width: layout.orbRadius * 2, height: layout.orbRadius * 2
        ))
        context.clip(to: visible, style: FillStyle(eoFill: true))
    }

    /// A gradient along a link whose opacity follows `fade` toward the orb on whichever side it approaches.
    func shading(from start: CGPoint, to end: CGPoint, color: Color, opacity: Double) -> GraphicsContext.Shading {
        let steps = 10
        let stops = (0...steps).map { step -> Gradient.Stop in
            let t = Double(step) / Double(steps)
            let x = Double(start.x) + Double(end.x - start.x) * t, y = Double(start.y) + Double(end.y - start.y) * t
            let dx = x - layout.orbX, dy = y - layout.orbY
            return Gradient.Stop(color: color.opacity(opacity * fade((dx * dx + dy * dy).squareRoot())), location: t)
        }
        return .linearGradient(Gradient(stops: stops), startPoint: start, endPoint: end)
    }
}

struct JarvisNeuralPalette {
    let cool: Color
    let warm: Color
    /// Dark backgrounds add light; light ones draw plain, softer strokes.
    let isDark: Bool
    /// The cheap path skips the soft additive glow passes (the crisp lines, nodes and signals stay).
    let isCheap: Bool
    private let components: (cool: (Double, Double, Double), warm: (Double, Double, Double))

    init(selection: JarvisPaletteSelection, isDark: Bool, saturation: Double, isCheap: Bool = false) {
        self.isDark = isDark
        self.isCheap = isCheap
        var cool = isDark ? selection.secondary.dark : selection.secondary.light
        var warm = isDark ? selection.primary.dark : selection.primary.light
        if selection.secondary == JarvisPaletteSelection.standard.secondary {
            cool = isDark ? JarvisOrbAppearance.cool : (20.0 / 255, 118.0 / 255, 141.0 / 255)
        }
        if selection.primary == JarvisPaletteSelection.standard.primary {
            warm = isDark ? JarvisOrbAppearance.warm : (196.0 / 255, 110.0 / 255, 8.0 / 255)
        }
        components = (cool, warm)
        self.cool = Self.color(cool, saturation)
        self.warm = Self.color(warm, saturation)
    }

    private static func color(_ rgb: (Double, Double, Double), _ saturation: Double) -> Color {
        let gray = 0.299 * rgb.0 + 0.587 * rgb.1 + 0.114 * rgb.2
        func channel(_ v: Double) -> Double { max(0, min(1, gray + (v - gray) * saturation)) }
        return Color(.sRGB, red: channel(rgb.0), green: channel(rgb.1), blue: channel(rgb.2), opacity: 1)
    }

    /// Cyan to amber, 0...1.
    func tone(_ warmth: Double) -> Color {
        let t = max(0, min(1, warmth))
        let c = components.cool, w = components.warm
        return Color(.sRGB, red: c.0 + (w.0 - c.0) * t, green: c.1 + (w.1 - c.1) * t, blue: c.2 + (w.2 - c.2) * t, opacity: 1)
    }
}

enum JarvisNeuralPainter {
    /// The still network: links, nodes and the faint glow around them. Drawn once per size, theme and orb position.
    static func paintNetwork(
        _ context: inout GraphicsContext, geometry: JarvisNeuralGeometry, palette: JarvisNeuralPalette, intensity: Double
    ) {
        geometry.cutOutOrb(&context)
        var glow = context
        glow.blendMode = palette.isDark ? .plusLighter : .normal
        let network = geometry.network
        let line = palette.cool
        let strength = palette.isDark ? intensity : intensity * 1.25
        if !geometry.hasOrb {
            let center = geometry.orbCenter, radius = geometry.emberRadius
            if !palette.isCheap {
                glow.fill(
                    Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)),
                    with: .radialGradient(
                        Gradient(colors: [line.opacity(0.09 * strength), line.opacity(0)]),
                        center: center, startRadius: 0, endRadius: radius
                    )
                )
            }
        }
        for link in network.links {
            let start = geometry.point(link[0]), end = geometry.point(link[1])
            var path = Path()
            path.move(to: start)
            path.addLine(to: end)
            if !palette.isCheap {
                glow.stroke(
                    path, with: geometry.shading(from: start, to: end, color: line, opacity: 0.05 * strength),
                    style: StrokeStyle(lineWidth: 2.8, lineCap: .round)
                )
            }
            context.stroke(
                path, with: geometry.shading(from: start, to: end, color: line, opacity: 0.18 * strength),
                style: StrokeStyle(lineWidth: 0.7, lineCap: .round)
            )
        }
        for index in network.nodes.indices where network.nodes[index].brightness > 0 {
            let p = geometry.point(index)
            let brightness = network.nodes[index].brightness
            if !palette.isCheap {
                glow.fill(
                    Path(ellipseIn: CGRect(x: p.x - 7, y: p.y - 7, width: 14, height: 14)),
                    with: .radialGradient(
                        Gradient(colors: [line.opacity(0.17 * brightness * strength), line.opacity(0)]),
                        center: p, startRadius: 0, endRadius: 7
                    )
                )
            }
            context.fill(
                Path(ellipseIn: CGRect(x: p.x - 1.4, y: p.y - 1.4, width: 2.8, height: 2.8)),
                with: .color(line.opacity(0.7 * brightness * strength))
            )
        }
    }

    /// What changes every frame: lit links and nodes, the signals with their trails, and the flashes at the orb.
    static func paintSignals(
        _ context: inout GraphicsContext, geometry: JarvisNeuralGeometry, palette: JarvisNeuralPalette,
        scene: JarvisNeuralScene, intensity: Double
    ) {
        geometry.cutOutOrb(&context)
        var glow = context
        glow.blendMode = palette.isDark ? .plusLighter : .normal
        let network = geometry.network
        let line = palette.cool
        let strength = palette.isDark ? intensity : intensity * 1.25

        for (index, link) in network.links.enumerated() where scene.linkGlow[index] > 0.01 {
            let start = geometry.point(link[0]), end = geometry.point(link[1])
            var path = Path()
            path.move(to: start)
            path.addLine(to: end)
            let lit = scene.linkGlow[index] * strength
            if !palette.isCheap {
                glow.stroke(
                    path, with: geometry.shading(from: start, to: end, color: line, opacity: 0.16 * lit),
                    style: StrokeStyle(lineWidth: 3.2, lineCap: .round)
                )
            }
            context.stroke(
                path, with: geometry.shading(from: start, to: end, color: line, opacity: 0.55 * lit),
                style: StrokeStyle(lineWidth: 0.9, lineCap: .round)
            )
        }

        for index in network.nodes.indices where network.nodes[index].brightness > 0 && scene.nodeGlow[index] > 0.01 {
            let p = geometry.point(index)
            let level = scene.nodeGlow[index] * network.nodes[index].brightness * strength
            let reach = 9 + 9 * scene.nodeGlow[index]
            if !palette.isCheap {
                glow.fill(
                    Path(ellipseIn: CGRect(x: p.x - reach, y: p.y - reach, width: reach * 2, height: reach * 2)),
                    with: .radialGradient(
                        Gradient(colors: [line.opacity(0.5 * level), line.opacity(0)]),
                        center: p, startRadius: 0, endRadius: reach
                    )
                )
            }
            let radius = 1.4 + 1.4 * scene.nodeGlow[index]
            context.fill(
                Path(ellipseIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)),
                with: .color(line.opacity(min(1, 0.55 + 0.6 * level)))
            )
        }

        for pulse in scene.pulses {
            guard let head = pulse.trail.last else { continue }
            let tone = palette.tone(pulse.warmth)
            let dx = head.x - geometry.layout.orbX, dy = head.y - geometry.layout.orbY
            // Without an orb a signal rises out of the ember instead of appearing at its centre.
            let visibility = geometry.hasOrb ? 1 : geometry.fade((dx * dx + dy * dy).squareRoot())
            let level = pulse.strength * strength * visibility
            let steps = pulse.trail.count - 1
            for step in 0..<steps {
                let a = pulse.trail[step], b = pulse.trail[step + 1]
                var path = Path()
                path.move(to: CGPoint(x: a.x, y: a.y))
                path.addLine(to: CGPoint(x: b.x, y: b.y))
                let ramp = Double(step + 1) / Double(steps)
                if !palette.isCheap {
                    glow.stroke(path, with: .color(tone.opacity(0.3 * level * ramp * ramp)), style: StrokeStyle(lineWidth: 6, lineCap: .round))
                }
                context.stroke(path, with: .color(tone.opacity(min(1, 1.2 * level * ramp * ramp))), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
            }
            let center = CGPoint(x: head.x, y: head.y)
            if !palette.isCheap {
                glow.fill(
                    Path(ellipseIn: CGRect(x: head.x - 11, y: head.y - 11, width: 22, height: 22)),
                    with: .radialGradient(
                        Gradient(colors: [tone.opacity(0.55 * level), tone.opacity(0)]),
                        center: center, startRadius: 0, endRadius: 11
                    )
                )
            }
            context.fill(
                Path(ellipseIn: CGRect(x: head.x - 2.4, y: head.y - 2.4, width: 4.8, height: 4.8)),
                with: .color(tone.opacity(min(1, 1.1 * level)))
            )
        }

        for flare in scene.flares {
            let center = CGPoint(x: flare.x, y: flare.y)
            if !palette.isCheap {
                glow.fill(
                    Path(ellipseIn: CGRect(x: flare.x - 30, y: flare.y - 30, width: 60, height: 60)),
                    with: .radialGradient(
                        Gradient(colors: [line.opacity(0.38 * flare.strength * strength), line.opacity(0)]),
                        center: center, startRadius: 0, endRadius: 30
                    )
                )
            }
        }
    }
}
#endif
