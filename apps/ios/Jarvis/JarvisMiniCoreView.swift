import SwiftUI

enum JarvisMiniCoreActivity: Equatable {
    case idle
    case signingIn
    case calm
    case listening
    case thinking
    case speaking
    case muted
    case reconnecting
    case offline
}

/// The one Jarvis mark: the amber filament tangle of the chat bubble's mini core on a transparent canvas, scaled to
/// any size. The gate, Voice, the chat bubble, the lock-screen preview and the Voice Live Activity all draw it.
/// It breathes uniformly (no rotation, no bending) and is steady under Reduce Motion or when `isStatic` is set.
/// API: Canvas, TimelineView, Environment(\.accessibilityReduceMotion).
struct JarvisMiniCoreView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    let activity: JarvisMiniCoreActivity
    var diameter: CGFloat = JarvisDesignTokens.gateOrbSize
    var isStatic = false

    private var amplitude: CGFloat {
        switch activity {
        case .idle: JarvisDesignTokens.gateIdlePulse
        case .signingIn: JarvisDesignTokens.gateSigningPulse
        case .listening: JarvisDesignTokens.voiceOrbListeningPulse
        case .thinking: JarvisDesignTokens.voiceOrbThinkingPulse
        case .speaking: JarvisDesignTokens.voiceOrbSpeakingPulse
        case .calm, .muted, .reconnecting, .offline: 0
        }
    }

    private var duration: Double {
        switch activity {
        case .signingIn: JarvisDesignTokens.gateOrbSigningDuration
        case .listening: JarvisDesignTokens.voiceOrbListeningDuration
        case .thinking: JarvisDesignTokens.voiceOrbThinkingDuration
        case .speaking: JarvisDesignTokens.voiceOrbSpeakingDuration
        default: JarvisDesignTokens.gateOrbIdleDuration
        }
    }

    private var animates: Bool {
        !isStatic && !reduceMotion && scenePhase == .active && amplitude > 0
    }

    private var saturation: Double {
        switch activity {
        case .muted: 0.35
        case .reconnecting: 0.6
        case .offline: 0
        default: 1
        }
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animates)) { timeline in
            let wave = animates
                ? sin(timeline.date.timeIntervalSinceReferenceDate * 2 * .pi / duration)
                : 0
            core
                .scaleEffect(1 + CGFloat(wave) * amplitude)
                .opacity(animates ? 0.88 + (wave + 1) * 0.06 : 1)
        }
        .frame(width: diameter, height: diameter)
        .saturation(saturation)
        .grayscale(activity == .offline ? 1 : 0)
        .accessibilityHidden(true)
    }

    private var core: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let filament = CGSize(width: side * 0.62, height: side * 0.62)
            let glowRect = CGRect(x: side * 0.1, y: side * 0.1, width: side * 0.8, height: side * 0.8)
            context.fill(
                Path(ellipseIn: glowRect),
                with: .radialGradient(
                    Gradient(colors: [
                        JarvisDesignTokens.orbCore.opacity(0.55),
                        JarvisDesignTokens.orbCore.opacity(JarvisDesignTokens.orbCoreEdgeOpacity),
                        .clear,
                    ]),
                    center: CGPoint(x: side / 2, y: side / 2),
                    startRadius: 0,
                    endRadius: side * 0.4
                )
            )
            context.translateBy(x: (size.width - filament.width) / 2, y: (size.height - filament.height) / 2)
            var glow = context
            glow.addFilter(.blur(radius: filament.width * 0.08))
            for (index, points) in filamentCurves.enumerated() {
                let path = filamentPath(points, size: filament)
                let color = filamentColors[index % filamentColors.count]
                glow.stroke(path, with: .color(color.opacity(0.9)), lineWidth: filament.width * 0.065)
                context.stroke(path, with: .color(color.opacity(0.9)), lineWidth: filament.width * 0.022)
                context.stroke(
                    path,
                    with: .color(JarvisDesignTokens.orbCoreHighlight.opacity(0.82)),
                    lineWidth: filament.width * 0.006
                )
            }
            for (index, point) in filamentSparks.enumerated() {
                let spark = filament.width * (index.isMultiple(of: 3) ? 0.035 : 0.022)
                context.fill(
                    Path(ellipseIn: CGRect(
                        x: point.x * filament.width - spark / 2,
                        y: point.y * filament.height - spark / 2,
                        width: spark,
                        height: spark
                    )),
                    with: .color(JarvisDesignTokens.orbCoreHighlight.opacity(0.9))
                )
            }
        }
    }

    private var filamentColors: [Color] {
        [
            JarvisDesignTokens.orbCore,
            JarvisDesignTokens.orbCoreHighlight,
            Color(red: 1, green: 0.48, blue: 0.16),
            Color(red: 1, green: 0.78, blue: 0.38),
        ]
    }

    private var filamentCurves: [[CGPoint]] {
        [
            [
                CGPoint(x: 0.08, y: 0.52), CGPoint(x: 0.06, y: 0.2), CGPoint(x: 0.44, y: 0.08),
                CGPoint(x: 0.61, y: 0.32), CGPoint(x: 0.81, y: 0.58), CGPoint(x: 0.66, y: 0.84),
                CGPoint(x: 0.43, y: 0.68), CGPoint(x: 0.18, y: 0.5), CGPoint(x: 0.79, y: 0.4),
                CGPoint(x: 0.34, y: 0.28), CGPoint(x: 0.16, y: 0.11), CGPoint(x: 0.04, y: 0.39),
                CGPoint(x: 0.08, y: 0.52),
            ],
            [
                CGPoint(x: 0.2, y: 0.18), CGPoint(x: 0.38, y: 0.02), CGPoint(x: 0.7, y: 0.2),
                CGPoint(x: 0.56, y: 0.43), CGPoint(x: 0.47, y: 0.62), CGPoint(x: 0.17, y: 0.69),
                CGPoint(x: 0.34, y: 0.48), CGPoint(x: 0.54, y: 0.25), CGPoint(x: 0.86, y: 0.54),
                CGPoint(x: 0.65, y: 0.78), CGPoint(x: 0.47, y: 0.92), CGPoint(x: 0.12, y: 0.67),
                CGPoint(x: 0.2, y: 0.18),
            ],
            [
                CGPoint(x: 0.82, y: 0.28), CGPoint(x: 0.56, y: 0.12), CGPoint(x: 0.27, y: 0.3),
                CGPoint(x: 0.47, y: 0.48), CGPoint(x: 0.69, y: 0.69), CGPoint(x: 0.38, y: 0.85),
                CGPoint(x: 0.21, y: 0.62), CGPoint(x: 0.14, y: 0.35), CGPoint(x: 0.56, y: 0.22),
                CGPoint(x: 0.78, y: 0.45), CGPoint(x: 0.82, y: 0.65), CGPoint(x: 0.66, y: 0.82),
                CGPoint(x: 0.82, y: 0.28),
            ],
            [
                CGPoint(x: 0.36, y: 0.12), CGPoint(x: 0.12, y: 0.3), CGPoint(x: 0.62, y: 0.39),
                CGPoint(x: 0.75, y: 0.58), CGPoint(x: 0.46, y: 0.74), CGPoint(x: 0.22, y: 0.56),
                CGPoint(x: 0.43, y: 0.37), CGPoint(x: 0.64, y: 0.24), CGPoint(x: 0.83, y: 0.48),
                CGPoint(x: 0.68, y: 0.75), CGPoint(x: 0.38, y: 0.89), CGPoint(x: 0.15, y: 0.64),
                CGPoint(x: 0.36, y: 0.12),
            ],
        ]
    }

    private var filamentSparks: [CGPoint] {
        [
            CGPoint(x: 0.18, y: 0.38), CGPoint(x: 0.3, y: 0.2), CGPoint(x: 0.48, y: 0.16),
            CGPoint(x: 0.73, y: 0.3), CGPoint(x: 0.78, y: 0.54), CGPoint(x: 0.62, y: 0.78),
            CGPoint(x: 0.4, y: 0.73), CGPoint(x: 0.22, y: 0.62), CGPoint(x: 0.51, y: 0.5),
        ]
    }

    private func filamentPath(_ points: [CGPoint], size: CGSize) -> Path {
        let resolvedPoints = points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
        var path = Path()
        guard let start = resolvedPoints.first else { return path }
        path.move(to: start)

        var index = 1
        while index + 2 < resolvedPoints.count {
            path.addCurve(
                to: resolvedPoints[index + 2],
                control1: resolvedPoints[index],
                control2: resolvedPoints[index + 1]
            )
            index += 3
        }
        return path
    }
}
