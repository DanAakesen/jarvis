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
                    .shadow(
                        color: JarvisDesignTokens.orbGlassShadowColor,
                        radius: size * JarvisDesignTokens.orbGlassShadowRadiusScale
                    )
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
                        width: size * JarvisDesignTokens.orbCoreGlowSizeScale,
                        height: size * JarvisDesignTokens.orbCoreGlowSizeScale
                    )
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
