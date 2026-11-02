import SwiftUI

/// The shared control layer. Screens use these instead of building their own button chrome:
/// icon-only, SF Symbols, 44 pt hit targets and the system glass or prominent styles.
/// HIG: Buttons, Toolbars, Sheets, Toggles, Pickers. API: ButtonStyle.glass, ToolbarContent, Label, LabelStyle.iconOnly.

/// The one glass look for anything that floats over content. The board's glass is clear: it bends and shows the
/// background and carries only a light fill for legibility, where the regular material frosts and blurs it.
/// API: Glass.clear, Glass.tint(_:), View.glassEffect(_:in:).
enum JarvisGlass {
    /// Clear glass with the board's light fill (`--g-fill-bar`), optionally tinted for accent surfaces such as the user bubble.
    static func surface(tint: Color? = nil) -> Glass {
        .clear.tint(tint ?? JarvisDesignTokens.glassFill)
    }
}

/// The one glass surface for anything that floats over content: Now bar, composer, pills, search, floating buttons.
/// Uses Apple's glass (`glassEffect`, iOS 26, the app's deployment target) and falls back to a solid system
/// material when Reduce Transparency is on. Toolbar items get the same glass from the system toolbar, so the
/// navigation bar itself stays transparent while each control keeps its own glass capsule or circle.
/// API: View.glassEffect(_:in:), Glass, Shape, AccessibilityEnvironment reduceTransparency.
struct JarvisGlassBackground: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var cornerRadius: CGFloat?

    private var shape: AnyShape {
        if let cornerRadius { AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)) } else { AnyShape(Capsule()) }
    }

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(.regularMaterial, in: shape)
        } else {
            content.glassEffect(JarvisGlass.surface(), in: shape)
        }
    }
}

extension View {
    /// Glass behind a floating control. Pass a radius for a rounded rectangle, or none for a capsule.
    func jarvisGlassSurface(cornerRadius: CGFloat? = nil) -> some View {
        modifier(JarvisGlassBackground(cornerRadius: cornerRadius))
    }
}

/// What the composer is doing, as the board's `data-cs` states: sets the rim's strength, speed and width.
enum JarvisRimState {
    case idle, typing, thinking, listening

    var opacity: Double {
        switch self {
        case .idle: 0.4
        case .typing, .listening: 0.9
        case .thinking: 1
        }
    }

    /// Seconds for one lap of the light sweep.
    var lap: Double {
        switch self {
        case .idle: 40
        case .typing: 14
        case .thinking: 7
        case .listening: 8
        }
    }

    var width: CGFloat {
        switch self {
        case .idle: 1.5
        case .typing, .listening: 2
        case .thinking: 3
        }
    }

    /// Deepest dip of the random pulse; the busy state breathes more than the idle one.
    var pulseDepth: ClosedRange<Double> {
        self == .thinking ? 0.25...0.5 : 0.1...0.25
    }
}

/// Orange rim with a slow travelling light and a randomised pulse (board: composer `.cring`).
/// Cheap by construction: one stroked shape redrawn at 12 fps, no mask, no blur, no offscreen pass.
/// Under Reduce Motion the rim is steady: no sweep and no pulse.
/// API: ShapeStyle.strokeBorder, AngularGradient, TimelineView, Animation.easeInOut.
struct JarvisRim: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let cornerRadius: CGFloat
    let state: JarvisRimState
    let isAnimated: Bool
    @State private var pulse = 1.0
    @State private var clock = RimClock()

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: cornerRadius, style: .continuous) }
    private var isStatic: Bool { reduceMotion || !isAnimated }

    func body(content: Content) -> some View {
        content.overlay {
            TimelineView(.animation(minimumInterval: 1.0 / 12, paused: isStatic)) { timeline in
                let angle = isStatic ? 0 : clock.advance(to: timeline.date, lap: state.lap)
                ZStack {
                    shape.strokeBorder(JarvisDesignTokens.primaryAccent.opacity(0.35), lineWidth: 1)
                    shape.strokeBorder(
                        AngularGradient(
                            stops: [
                                .init(color: .clear, location: 0),
                                .init(color: .clear, location: 0.52),
                                .init(color: JarvisDesignTokens.primaryAccent, location: 0.78),
                                .init(color: JarvisDesignTokens.rimGlint, location: 0.94),
                                .init(color: .clear, location: 1),
                            ],
                            center: .center,
                            angle: .degrees(angle)
                        ),
                        lineWidth: state.width
                    )
                }
                .opacity(state.opacity * pulse)
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .task(id: "\(state)-\(isStatic)") { await breathe() }
    }

    /// Dips the rim at random intervals and depths, so it never ticks like a metronome.
    private func breathe() async {
        pulse = 1
        guard !isStatic else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(Double.random(in: 2.5...7)))
            let duration = Double.random(in: 1.2...2.6)
            withAnimation(.easeInOut(duration: duration)) { pulse = 1 - Double.random(in: state.pulseDepth) }
            try? await Task.sleep(for: .seconds(duration))
            withAnimation(.easeInOut(duration: duration)) { pulse = 1 }
            try? await Task.sleep(for: .seconds(duration))
        }
    }
}

/// Keeps the sweep angle continuous when the lap time changes with the state.
final class RimClock {
    private var angle = 0.0
    private var last: Date?

    func advance(to now: Date, lap: Double) -> Double {
        if let last { angle = (angle + now.timeIntervalSince(last) / lap * 360).truncatingRemainder(dividingBy: 360) }
        last = now
        return angle
    }
}

extension View {
    /// `isAnimated` is false for fixture and UI-test runs: endless animation keeps XCUITest from ever seeing the app idle.
    func jarvisRim(cornerRadius: CGFloat, state: JarvisRimState, isAnimated: Bool = true) -> some View {
        modifier(JarvisRim(cornerRadius: cornerRadius, state: state, isAnimated: isAnimated))
    }
}

/// Orange icon for the composer row (voice, dictation, send): primary accent, no background, 44 pt target.
struct JarvisComposerIconButton: View {
    let title: String
    let systemImage: String
    var identifier: String
    var hint = ""
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .regular))
                .foregroundStyle(JarvisDesignTokens.primaryAccent)
                .frame(
                    width: JarvisDesignTokens.chatMinimumTapTarget,
                    height: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier)
    }
}

/// Icon-only glass button for toolbars and floating controls.
struct JarvisIconButton: View {
    let title: String
    let systemImage: String
    var identifier: String?
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .frame(
                    minWidth: JarvisDesignTokens.chatMinimumTapTarget,
                    minHeight: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.glass)
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier ?? "")
    }
}

/// Check mark that confirms a sheet. Shows a progress view while the work runs.
struct JarvisSheetConfirmButton: View {
    let title: String
    var isWorking = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if isWorking {
                ProgressView()
            } else {
                Label(title, systemImage: "checkmark").labelStyle(.iconOnly)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(isDisabled || isWorking)
        .accessibilityLabel(title)
        .accessibilityIdentifier("sheet.confirm")
    }
}

/// X that closes a sheet. It sits on the right, within thumb reach.
struct JarvisSheetCloseButton: View {
    let title: String
    var identifier = "sheet.cancel"
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "xmark").labelStyle(.iconOnly)
        }
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

/// Toolbar content every sheet shares: check mark to confirm, X to close, both icon-only and trailing.
struct JarvisSheetToolbar: ToolbarContent {
    let confirmTitle: String
    let closeTitle: String
    var isWorking = false
    var isConfirmDisabled = false
    let onConfirm: () -> Void
    let onClose: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            JarvisSheetConfirmButton(
                title: confirmTitle,
                isWorking: isWorking,
                isDisabled: isConfirmDisabled,
                action: onConfirm
            )
        }
        ToolbarItem(placement: .topBarTrailing) {
            JarvisSheetCloseButton(title: closeTitle, isDisabled: isWorking, action: onClose)
        }
    }
}

/// Floating capsule pill for legends and filters.
struct JarvisChip: View {
    let title: String
    var systemImage: String?
    var isSelected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title).lineLimit(1)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            .contentShape(Capsule())
        }
        .buttonStyle(.glass)
        .tint(isSelected ? JarvisDesignTokens.primaryAccent : nil)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
