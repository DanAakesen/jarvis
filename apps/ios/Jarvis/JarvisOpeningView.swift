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
/// the orb: the orb's disc is cut out of the network, so nothing is drawn over the sphere.
private struct JarvisOpeningNetworkView: View {
    var orbCenterY: Double
    var orbRadius: Double

    var body: some View {
        Canvas { context, size in
            var visible = Path(CGRect(origin: .zero, size: size))
            visible.addEllipse(in: CGRect(
                x: size.width / 2 - orbRadius, y: orbCenterY - orbRadius, width: orbRadius * 2, height: orbRadius * 2
            ))
            context.clip(to: visible, style: FillStyle(eoFill: true))
            let network = JarvisOpeningNetwork.shared
            func point(_ node: JarvisOpeningNetwork.Node) -> CGPoint {
                CGPoint(x: node.x * size.width, y: node.y * size.height)
            }
            var lines = Path()
            for link in network.links {
                lines.move(to: point(network.nodes[link[0]]))
                lines.addLine(to: point(network.nodes[link[1]]))
            }
            context.stroke(lines, with: .color(JarvisDesignTokens.openingLine.opacity(0.18)), lineWidth: 0.7)
            for node in network.nodes where node.brightness > 0 {
                let p = point(node)
                context.fill(
                    Path(ellipseIn: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8)),
                    with: .color(JarvisDesignTokens.openingLine.opacity(0.09 * node.brightness))
                )
                context.fill(
                    Path(ellipseIn: CGRect(x: p.x - 1.4, y: p.y - 1.4, width: 2.8, height: 2.8)),
                    with: .color(JarvisDesignTokens.openingLine.opacity(0.7 * node.brightness))
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
