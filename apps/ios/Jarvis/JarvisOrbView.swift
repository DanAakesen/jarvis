import SwiftUI

enum JarvisOrbActivity: Equatable {
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

struct JarvisOrbView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var pulse = false

    let activity: JarvisOrbActivity
    var diameter: CGFloat = JarvisDesignTokens.gateOrbSize
    var usesStaticFilaments = false

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

    private var animationDuration: Double {
        switch activity {
        case .signingIn: JarvisDesignTokens.gateOrbSigningDuration
        case .listening: JarvisDesignTokens.voiceOrbListeningDuration
        case .thinking: JarvisDesignTokens.voiceOrbThinkingDuration
        case .speaking: JarvisDesignTokens.voiceOrbSpeakingDuration
        default: JarvisDesignTokens.gateOrbIdleDuration
        }
    }

    var body: some View {
        if NavigationBisectVariant.current == .H {
            Color.clear.accessibilityHidden(true)
        } else {
            orbBody
        }
    }

    private var orbBody: some View {
        GeometryReader { geometry in
            if usesStaticFilaments {
                sphere(size: geometry.size.width, phase: 0)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animatesCore)) { timeline in
                let phase = animatesCore
                    ? timeline.date.timeIntervalSinceReferenceDate * 2 * .pi / animationDuration
                    : 0
                sphere(size: geometry.size.width, phase: phase)
                }
            }
        }
        .frame(width: diameter, height: diameter)
        .onAppear { pulse = true }
    }

    private func sphere(size: CGFloat, phase: Double) -> some View {
        let energy = CGFloat(sin(phase)) * amplitude
        return ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JarvisDesignTokens.orbGlassHighlight,
                                JarvisDesignTokens.orbGlass,
                                JarvisDesignTokens.orbGlassShadow,
                            ],
                            center: JarvisDesignTokens.orbGlassCenter,
                            startRadius: size * JarvisDesignTokens.orbGlassStartRadiusScale,
                            endRadius: size * JarvisDesignTokens.orbGlassEndRadiusScale
                        )
                    )
                    .overlay {
                        Circle()
                            .strokeBorder(
                                JarvisDesignTokens.orbGlassEdge,
                                lineWidth: size * JarvisDesignTokens.orbGlassEdgeWidthScale
                            )
                    }
                    .overlay {
                        Circle()
                            .strokeBorder(
                                JarvisDesignTokens.orbCyan.opacity(0.18),
                                lineWidth: size * 0.07
                            )
                            .blur(radius: size * 0.045)
                    }
                    .shadow(
                        color: JarvisDesignTokens.orbGlassShadowColor,
                        radius: size * JarvisDesignTokens.orbGlassShadowRadiusScale
                    )
                    .shadow(color: JarvisDesignTokens.orbCyan.opacity(0.24), radius: size * 0.14)
                ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JarvisDesignTokens.orbCore,
                                JarvisDesignTokens.orbCore.opacity(JarvisDesignTokens.orbCoreEdgeOpacity),
                                .clear,
                            ],
                            center: JarvisDesignTokens.orbCoreCenter,
                            startRadius: 0,
                            endRadius: size * JarvisDesignTokens.orbCoreGlowRadiusScale
                        )
                    )
                    .frame(
                        width: size * 0.56,
                        height: size * 0.56
                    )
                Group {
                    if usesStaticFilaments {
                        staticFilaments
                            .frame(width: size * 0.42, height: size * 0.42)
                    } else {
                Canvas { context, canvasSize in
                    let filamentSize = CGSize(width: size * 0.42, height: size * 0.42)
                    context.translateBy(
                        x: (canvasSize.width - filamentSize.width) / 2,
                        y: (canvasSize.height - filamentSize.height) / 2
                    )
                    var glowContext = context
                    glowContext.addFilter(.blur(radius: filamentSize.width * 0.08))

                    for (index, points) in self.filamentCurves.enumerated() {
                        let path = self.filamentPath(points, size: filamentSize)
                        let color = self.filamentColors[index % self.filamentColors.count]
                        glowContext.stroke(
                            path,
                            with: .color(color.opacity(0.9)),
                            lineWidth: filamentSize.width * 0.065
                        )
                        context.stroke(
                            path,
                            with: .color(color.opacity(0.9)),
                            lineWidth: filamentSize.width * 0.022
                        )
                        context.stroke(
                            path,
                            with: .color(JarvisDesignTokens.orbCoreHighlight.opacity(0.82)),
                            lineWidth: filamentSize.width * 0.006
                        )
                    }

                    for (index, point) in self.filamentSparks.enumerated() {
                        let diameter = filamentSize.width * (index.isMultiple(of: 3) ? 0.035 : 0.022)
                        let rect = CGRect(
                            x: point.x * filamentSize.width - diameter / 2,
                            y: point.y * filamentSize.height - diameter / 2,
                            width: diameter,
                            height: diameter
                        )
                        context.fill(
                            Path(ellipseIn: rect),
                            with: .color(JarvisDesignTokens.orbCoreHighlight.opacity(0.9))
                        )
                    }
                    }
                }
                }
                .frame(width: size * 0.7, height: size * 0.7)
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [JarvisDesignTokens.orbCoreHighlight, JarvisDesignTokens.orbCore],
                            center: JarvisDesignTokens.orbCoreHighlightCenter,
                            startRadius: 0,
                            endRadius: size * JarvisDesignTokens.orbCenterSizeScale
                        )
                    )
                    .frame(
                        width: size * JarvisDesignTokens.orbCenterSizeScale,
                        height: size * JarvisDesignTokens.orbCenterSizeScale
                    )
                    .shadow(
                        color: JarvisDesignTokens.orbCore.opacity(JarvisDesignTokens.orbCenterGlowOpacity),
                        radius: size * JarvisDesignTokens.orbCenterGlowRadiusScale
                    )
                }
                .opacity(animatesCore ? 0.82 + (sin(phase) + 1) * 0.09 : 1)
                .mask {
                    RadialGradient(
                        stops: [.init(color: .white, location: 0.6), .init(color: .clear, location: 1)],
                        center: .center,
                        startRadius: 0,
                        endRadius: size * 0.35
                    )
                }
                .scaleEffect(x: 1 + energy, y: 1 - energy * 0.5)
                .rotationEffect(.degrees(animatesCore ? sin(phase * 0.7) * 12 : 0))
            }
            .frame(width: size, height: size)
            .scaleEffect(scale)
            .animation(pulseAnimation, value: pulse)
            .animation(pulseAnimation, value: activity)
            .animation(pulseAnimation, value: scenePhase)
            .saturation(saturation)
            .grayscale(activity == .offline ? 1 : 0)
            .brightness(brightness)
    }

    private var saturation: Double {
        switch activity {
        case .muted: 0.35
        case .reconnecting: 0.6
        case .offline: 0
        default: 1
        }
    }

    private var brightness: Double {
        switch activity {
        case .muted: -0.2
        case .offline: -0.3
        default: 0
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

    private var staticFilaments: some View {
        GeometryReader { geometry in
            ZStack {
                ForEach(filamentCurves.indices, id: \.self) { index in
                    let path = filamentPath(filamentCurves[index], size: geometry.size)
                    let color = filamentColors[index % filamentColors.count]
                    path.stroke(color.opacity(0.9), lineWidth: geometry.size.width * 0.065)
                        .blur(radius: geometry.size.width * 0.08)
                    path.stroke(color.opacity(0.9), lineWidth: geometry.size.width * 0.022)
                    path.stroke(
                        JarvisDesignTokens.orbCoreHighlight.opacity(0.82),
                        lineWidth: geometry.size.width * 0.006
                    )
                }
                ForEach(filamentSparks.indices, id: \.self) { index in
                    let point = filamentSparks[index]
                    let diameter = geometry.size.width * (index.isMultiple(of: 3) ? 0.035 : 0.022)
                    Circle()
                        .fill(JarvisDesignTokens.orbCoreHighlight.opacity(0.9))
                        .frame(width: diameter, height: diameter)
                        .position(x: point.x * geometry.size.width, y: point.y * geometry.size.height)
                }
            }
        }
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

    private var scale: CGFloat {
        guard activity == .idle || activity == .signingIn,
              !reduceMotion, scenePhase == .active, amplitude > 0 else { return 1 }
        return pulse ? 1 + amplitude : 1 - amplitude
    }

    private var pulseAnimation: Animation? {
        guard activity == .idle || activity == .signingIn,
              !reduceMotion, scenePhase == .active, amplitude > 0 else { return nil }
        return .easeInOut(duration: animationDuration).repeatForever(autoreverses: true)
    }

    private var animatesCore: Bool {
        !usesStaticFilaments && !reduceMotion && scenePhase == .active &&
            (activity == .listening || activity == .thinking || activity == .speaking)
    }
}
