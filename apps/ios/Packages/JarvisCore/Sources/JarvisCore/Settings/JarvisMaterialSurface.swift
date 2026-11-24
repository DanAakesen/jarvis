#if os(iOS) || os(watchOS)
import SwiftUI

public extension EnvironmentValues {
    @Entry var jarvisMaterialPreview: JarvisMaterialSettings? = nil
}

/// Paints only the background. Content, touch targets and text stay fully opaque.
public struct JarvisMaterialSurface<S: Shape>: View {
    public enum Style { case card, control, joinedRow }
    private let shape: S
    private let style: Style
    private let tint: Color
    private let highlight: Color?
    private let solid: Color
    private let interactive: Bool
    @Environment(\.jarvisMaterialPreview) private var preview
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale

    public init(in shape: S, style: Style, tint: Color, highlight: Color? = nil,
                solid: Color, interactive: Bool = false) {
        self.shape = shape
        self.style = style
        self.tint = tint
        self.highlight = highlight
        self.solid = solid
        self.interactive = interactive
    }

    public var body: some View {
        let finish = preview ?? JarvisMaterialPreferences.shared.current
        let gradient = finish[.gradient], frost = finish[.frost], glass = finish[.glass]
        let card = style != .control
        let horizontal = style == .joinedRow
        if reduceTransparency {
            shape.fill(solid)
        } else {
            ZStack {
                if frost > 0 { shape.fill(.regularMaterial).opacity(frost) }
                if glass > 0 && !horizontal {
                    Color.clear.glassEffect(.clear.interactive(interactive && !reduceMotion), in: shape)
                        .opacity(glass * (card ? 0.22 : 1))
                }
                shape.fill(LinearGradient(
                    colors: [tint.opacity((card ? 0.695 : 0.84) + gradient * (card ? 0.29 : 0.16)),
                             tint.opacity((card ? 0.695 : 0.84) - gradient * (card ? 0.29 : 0.16))],
                    startPoint: horizontal ? .leading : .topLeading,
                    endPoint: horizontal ? .trailing : .bottomTrailing))
                if gradient > 0 && !horizontal {
                    let wash = highlight?.opacity(0.30) ?? Color.white.opacity(0.07)
                    shape.fill(EllipticalGradient(colors: [wash.opacity(gradient), .clear],
                                                  center: .topLeading, startRadiusFraction: 0, endRadiusFraction: 0.82))
                }
                if glass > 0 {
                    if horizontal {
                        // Keep adjacent list slices continuous without a rim around each row.
                        shape.fill(LinearGradient(colors: [.white.opacity(0.08 * glass), .clear],
                                                  startPoint: .leading, endPoint: .trailing))
                    } else {
                        shape.stroke(LinearGradient(colors: [.primary.opacity(glass * 0.34), .primary.opacity(glass * 0.12)],
                                                    startPoint: .topLeading, endPoint: .bottomTrailing),
                                     lineWidth: 2 / max(1, displayScale))
                    }
                }
            }
            .clipShape(shape)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}
#endif
