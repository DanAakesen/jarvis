import SwiftUI

enum JarvisOrbActivity: Equatable {
    case idle
    case signingIn
    case calm
}

struct JarvisOrbView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var pulse = false

    let activity: JarvisOrbActivity

    private var amplitude: CGFloat {
        switch activity {
        case .idle: JarvisDesignTokens.gateIdlePulse
        case .signingIn: JarvisDesignTokens.gateSigningPulse
        case .calm: 0
        }
    }

    private var animationDuration: Double {
        activity == .signingIn
            ? JarvisDesignTokens.gateOrbSigningDuration
            : JarvisDesignTokens.gateOrbIdleDuration
    }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size.width
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JarvisDesignTokens.orbAccent.opacity(JarvisDesignTokens.orbHaloStrongOpacity),
                                JarvisDesignTokens.orbAccent.opacity(JarvisDesignTokens.orbHaloSoftOpacity),
                                .clear,
                            ],
                            center: UnitPoint(
                                x: JarvisDesignTokens.orbHaloCenterX,
                                y: JarvisDesignTokens.orbHaloCenterY
                            ),
                            startRadius: JarvisDesignTokens.orbGradientStartRadius,
                            endRadius: size * JarvisDesignTokens.orbHaloRadiusScale
                        )
                    )
                Circle()
                    .strokeBorder(
                        JarvisDesignTokens.orbAccent.opacity(JarvisDesignTokens.orbRingOpacity),
                        lineWidth: size * JarvisDesignTokens.orbRingWidthScale
                    )
                    .padding(size * JarvisDesignTokens.orbRingInsetScale)
                    .shadow(
                        color: JarvisDesignTokens.orbAccent.opacity(JarvisDesignTokens.orbRingGlowOpacity),
                        radius: size * JarvisDesignTokens.orbRingGlowRadiusScale
                    )
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JarvisDesignTokens.orbCore,
                                JarvisDesignTokens.orbAccent.opacity(JarvisDesignTokens.orbCoreAccentOpacity),
                                Color(uiColor: .systemBackground).opacity(JarvisDesignTokens.orbCoreBaseOpacity),
                            ],
                            center: UnitPoint(
                                x: JarvisDesignTokens.orbCoreCenterX,
                                y: JarvisDesignTokens.orbCoreCenterY
                            ),
                            startRadius: 0,
                            endRadius: size * JarvisDesignTokens.orbHaloRadiusScale
                        )
                    )
                    .padding(size * JarvisDesignTokens.orbCoreInsetScale)
                Circle()
                    .fill(JarvisDesignTokens.orbCore)
                    .frame(
                        width: size * JarvisDesignTokens.orbCenterSizeScale,
                        height: size * JarvisDesignTokens.orbCenterSizeScale
                    )
                    .shadow(
                        color: JarvisDesignTokens.orbCore.opacity(JarvisDesignTokens.orbCenterGlowOpacity),
                        radius: size * JarvisDesignTokens.orbCenterGlowRadiusScale
                    )
            }
            .frame(width: size, height: size)
            .scaleEffect(scale)
            .animation(pulseAnimation, value: pulse)
            .animation(pulseAnimation, value: activity)
            .animation(pulseAnimation, value: scenePhase)
            .accessibilityHidden(true)
        }
        .frame(width: JarvisDesignTokens.gateOrbSize, height: JarvisDesignTokens.gateOrbSize)
        .onAppear { pulse = true }
    }

    private var scale: CGFloat {
        guard !reduceMotion, scenePhase == .active, amplitude > 0 else { return 1 }
        return pulse ? 1 + amplitude : 1 - amplitude
    }

    private var pulseAnimation: Animation? {
        guard !reduceMotion, scenePhase == .active, amplitude > 0 else { return nil }
        return .easeInOut(duration: animationDuration).repeatForever(autoreverses: true)
    }
}
