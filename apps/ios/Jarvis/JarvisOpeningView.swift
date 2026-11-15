import JarvisCore
import SwiftUI

/// The quick off switch for the cold-start opening screen: Settings > General > Opening screen, or the
/// `--no-opening` launch argument in debug builds.
enum JarvisOpening {
    static let enabledKey = "jarvis.opening.enabled"

    static var isEnabled: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--no-opening") { return false }
        #endif
        return UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    }
}

/// The cold-start opening screen: the cognitive lattice orb, the name and a slim bar on a dark network, with no
/// caption. Specification: docs/ui/opening-final-2026-11-14/README.md. It draws only the orb's own motion (the
/// background is static), never touches the microphone and never claims progress it cannot measure.
struct JarvisOpeningView: View {
    var progress: JarvisOpeningProgress = .indeterminate
    /// Holds the orb and the bar still while the app is inactive or the screen is covered.
    var isPaused = false
    /// True while the opening fades out on genuine readiness: an unmeasured bar stops rather than imply completion.
    var isFinishing = false

    var body: some View {
        GeometryReader { geometry in
            let layout = JarvisOpeningLayout(
                width: geometry.size.width, height: geometry.size.height,
                safeTop: geometry.safeAreaInsets.top, safeBottom: geometry.safeAreaInsets.bottom
            )
            let center = geometry.size.width / 2
            ZStack {
                JarvisDesignTokens.openingBackground
                JarvisOpeningNetworkView(orbCenterY: layout.orbCenterY, orbRadius: layout.orbDiameter / 2)
                RadialGradient(
                    colors: [JarvisDesignTokens.ambientBlue.opacity(0.1), .clear],
                    center: .center, startRadius: layout.orbDiameter * 0.45, endRadius: layout.orbDiameter * 0.85
                )
                .frame(width: layout.orbDiameter * 1.8, height: layout.orbDiameter * 1.8)
                .position(x: center, y: layout.orbCenterY)
                .accessibilityHidden(true)
                JarvisOrb(activity: .calm, size: layout.orbDiameter, isPaused: isPaused)
                    .position(x: center, y: layout.orbCenterY)
                Text("Jarvis")
                    .font(.system(size: layout.wordmarkFontSize, weight: .medium))
                    .foregroundStyle(.white)
                    .position(x: center, y: layout.wordmarkCenterY)
                JarvisActivityBar(progress: isFinishing && progress.fraction != nil ? .measured(1) : progress, isPaused: isPaused || isFinishing)
                    .frame(width: layout.barWidth, height: layout.barHeight)
                    .position(x: center, y: layout.barCenterY)
            }
        }
        .ignoresSafeArea()
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(JarvisNotesLocalization.string(.openingLabel))
        .accessibilityValue(progress.percent.map {
            String(format: JarvisNotesLocalization.string(.openingProgressValue), $0)
        } ?? "")
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("opening.screen")
    }
}

/// The dim network behind the orb. Fixed positions from `JarvisOpeningNetwork`; it never animates. Lines run behind
/// the orb: the orb's disc is cut out of the network, so nothing is drawn over the sphere. A faint additive glow
/// softens lines and nodes, and each line fades a little as it nears the orb.
private struct JarvisOpeningNetworkView: View {
    var orbCenterY: Double
    var orbRadius: Double

    /// How bright a line is at a distance from the orb centre: full far away, about 40% at the sphere's edge.
    private func fade(_ distance: Double) -> Double {
        let t = max(0, min(1, (distance - orbRadius) / (orbRadius * 1.6)))
        return 0.4 + 0.6 * t * t * (3 - 2 * t)
    }

    var body: some View {
        Canvas { context, size in
            let orbCenter = CGPoint(x: size.width / 2, y: orbCenterY)
            var visible = Path(CGRect(origin: .zero, size: size))
            visible.addEllipse(in: CGRect(
                x: orbCenter.x - orbRadius, y: orbCenter.y - orbRadius, width: orbRadius * 2, height: orbRadius * 2
            ))
            context.clip(to: visible, style: FillStyle(eoFill: true))
            var glow = context
            glow.blendMode = .plusLighter
            let network = JarvisOpeningNetwork.shared
            func point(_ index: Int) -> CGPoint {
                if index == network.orbAnchor { return orbCenter }
                let node = network.nodes[index]
                return CGPoint(x: node.x * size.width, y: node.y * size.height)
            }
            let line = JarvisDesignTokens.openingLine
            for link in network.links {
                let start = point(link[0]), end = point(link[1])
                var path = Path()
                path.move(to: start)
                path.addLine(to: end)
                // Sample the fade along the link so it dims toward the orb on whichever side it approaches.
                func shading(_ base: Double) -> GraphicsContext.Shading {
                    let steps = 10
                    let stops = (0...steps).map { step -> Gradient.Stop in
                        let t = Double(step) / Double(steps)
                        let x = start.x + (end.x - start.x) * t, y = start.y + (end.y - start.y) * t
                        let distance = ((x - orbCenter.x) * (x - orbCenter.x) + (y - orbCenter.y) * (y - orbCenter.y)).squareRoot()
                        return Gradient.Stop(color: line.opacity(base * fade(distance)), location: t)
                    }
                    return .linearGradient(Gradient(stops: stops), startPoint: start, endPoint: end)
                }
                glow.stroke(path, with: shading(0.07), style: StrokeStyle(lineWidth: 3.2, lineCap: .round))
                context.stroke(path, with: shading(0.18), style: StrokeStyle(lineWidth: 0.7, lineCap: .round))
            }
            for index in network.nodes.indices where network.nodes[index].brightness > 0 {
                let p = point(index)
                let brightness = network.nodes[index].brightness
                glow.fill(
                    Path(ellipseIn: CGRect(x: p.x - 7, y: p.y - 7, width: 14, height: 14)),
                    with: .radialGradient(
                        Gradient(colors: [line.opacity(0.22 * brightness), line.opacity(0)]),
                        center: p, startRadius: 0, endRadius: 7
                    )
                )
                context.fill(
                    Path(ellipseIn: CGRect(x: p.x - 1.4, y: p.y - 1.4, width: 2.8, height: 2.8)),
                    with: .color(line.opacity(0.7 * brightness))
                )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A slim linear activity bar: a filled amber bar when the work reports real progress, otherwise an amber segment
/// that travels along the same track. With Reduce Motion the segment holds still and breathes in opacity.
/// It carries no text; the screen that shows it exposes the accessibility label and value.
struct JarvisActivityBar: View {
    var progress: JarvisOpeningProgress
    var isPaused = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let segmentFraction = 0.36

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(JarvisDesignTokens.openingTrack)
                if let fraction = progress.fraction {
                    Capsule()
                        .fill(JarvisDesignTokens.openingAmber)
                        .frame(width: width * fraction)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: fraction)
                } else if reduceMotion || isPaused {
                    TimelineView(.animation(minimumInterval: 1.0 / 15.0, paused: isPaused)) { timeline in
                        let beat = 0.5 + 0.5 * sin(timeline.date.timeIntervalSinceReferenceDate * 2 * .pi / 1.6)
                        Capsule()
                            .fill(JarvisDesignTokens.openingAmber)
                            .frame(width: width * segmentFraction)
                            .offset(x: width * (1 - segmentFraction) / 2)
                            .opacity(reduceMotion ? 0.5 + 0.5 * beat : 1)
                    }
                } else {
                    TimelineView(.animation) { timeline in
                        let cycle = timeline.date.timeIntervalSinceReferenceDate
                            .truncatingRemainder(dividingBy: JarvisDesignTokens.openingBarCycle) / JarvisDesignTokens.openingBarCycle
                        let eased = cycle * cycle * (3 - 2 * cycle)
                        let segment = width * segmentFraction
                        Capsule()
                            .fill(JarvisDesignTokens.openingAmber)
                            .frame(width: segment)
                            .offset(x: -segment + (width + segment) * eased)
                    }
                }
            }
            .clipShape(Capsule())
        }
        .accessibilityHidden(true)
    }
}
