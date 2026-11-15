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

/// The cold-start opening screen: the cognitive lattice orb, the name and a slim bar on the living neural
/// background, with no caption. Specification: docs/ui/opening-final-2026-11-14/README.md. Neurons fire out from the
/// orb and return while the app starts (full effects, the working state); it never touches the microphone and never
/// claims progress it cannot measure.
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
                // The orb stays calm, as approved; the network around it works (`.signingIn`), without implying listening.
                JarvisNeuralBackground(
                    activity: .signingIn, effects: .full,
                    orb: .local(center: CGPoint(x: center, y: layout.orbCenterY), radius: layout.orbDiameter / 2),
                    isPaused: isPaused
                )
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
