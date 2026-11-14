import JarvisCore
import SwiftUI

/// The Jarvis orb for the Home widgets, drawn once and without motion. The widget extension cannot compile the app's
/// animated `JarvisOrb` (that would need the project file changed), so this follows the same look: a dark glass sphere,
/// a cyan rim and a tangled orange centre. It is plain SwiftUI shapes, which WidgetKit can archive in every rendering
/// mode, and it is scaled by `size` only.
struct JarvisWidgetOrb: View {
    var size: CGFloat

    private static let cyan = Color(red: JarvisOrbAppearance.cool.r, green: JarvisOrbAppearance.cool.g, blue: JarvisOrbAppearance.cool.b)
    private static let amber = Color(red: JarvisOrbAppearance.warm.r, green: JarvisOrbAppearance.warm.g, blue: JarvisOrbAppearance.warm.b)

    var body: some View {
        ZStack {
            Circle().fill(Color(red: 0.01, green: 0.03, blue: 0.06))
            Circle().fill(
                RadialGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .clear, location: 0.6),
                        .init(color: Self.cyan.opacity(0.2), location: 0.84),
                        .init(color: Self.cyan.opacity(0.78), location: 1),
                    ],
                    center: .center, startRadius: 0, endRadius: size / 2
                )
            )
            Circle().fill(
                RadialGradient(
                    colors: [Self.amber.opacity(JarvisOrbAppearance.glowOpacity), .clear],
                    center: .center, startRadius: 0, endRadius: size * JarvisOrbAppearance.glowRadius / 2.24
                )
            )
            JarvisWidgetOrbTangle()
                .stroke(Self.amber.opacity(0.95), style: StrokeStyle(lineWidth: max(0.8, size / 36), lineCap: .round))
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// Seven looping filaments around the centre, from fixed angles so the orb looks the same on every render.
struct JarvisWidgetOrbTangle: Shape {
    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        func point(_ angle: Double, _ fraction: Double) -> CGPoint {
            CGPoint(x: center.x + radius * fraction * cos(angle), y: center.y + radius * fraction * sin(angle))
        }
        var path = Path()
        for index in 0..<7 {
            let angle = Double(index) * 0.9
            path.move(to: point(angle, 0.3))
            path.addCurve(
                to: point(angle + 2.6, 0.3),
                control1: point(angle + 1.7, 0.56),
                control2: point(angle + 3.9, 0.56)
            )
        }
        return path
    }
}
