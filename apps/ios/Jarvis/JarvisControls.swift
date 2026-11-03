import JarvisCore
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
    var tint: Color?

    private var shape: AnyShape {
        if let cornerRadius { AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)) } else { AnyShape(Capsule()) }
    }

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(.regularMaterial, in: shape)
        } else {
            content.glassEffect(JarvisGlass.surface(tint: tint), in: shape)
        }
    }
}

extension View {
    /// Glass behind a floating control. Pass a radius for a rounded rectangle, or none for a capsule. A tint colours
    /// accent surfaces such as the user bubble.
    func jarvisGlassSurface(cornerRadius: CGFloat? = nil, tint: Color? = nil) -> some View {
        modifier(JarvisGlassBackground(cornerRadius: cornerRadius, tint: tint))
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
        case .idle: 16
        case .typing: 8
        case .thinking: 4
        case .listening: 5
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
            Group {
                if isStatic {
                    rim(angle: 0)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 15)) { timeline in
                        ZStack {
                            rim(angle: clock.advance(to: timeline.date, lap: state.lap))
                            ripple(at: timeline.date)
                        }
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .task(id: "\(state)-\(isStatic)") { await breathe() }
    }

    private func rim(angle: Double) -> some View {
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

    /// A faint copy of the border that radiates outwards and fades, once every few seconds.
    private func ripple(at date: Date) -> some View {
        let period = state == .thinking ? 2.4 : 3.6
        let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
        return shape
            .inset(by: -JarvisDesignTokens.rimRippleReach * phase)
            .stroke(JarvisDesignTokens.primaryAccent, lineWidth: 1)
            .opacity((1 - phase) * 0.3 * state.opacity)
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
        if let last {
            let t = now.timeIntervalSinceReferenceDate
            // Two slow, unrelated waves make the sweep speed up and slow down without a fixed rhythm.
            let speed = 1 + 0.55 * sin(t / 2.3) + 0.25 * sin(t / 0.9 + 1)
            angle = (angle + now.timeIntervalSince(last) / lap * 360 * speed).truncatingRemainder(dividingBy: 360)
        }
        last = now
        return angle
    }
}

/// Sweeps a soft highlight across placeholder text while an answer is on the way. Steady under Reduce Motion.
struct JarvisShimmer: ViewModifier {
    let isActive: Bool
    @State private var phase: CGFloat = -0.5

    func body(content: Content) -> some View {
        if isActive {
            content
                .foregroundStyle(LinearGradient(
                    colors: [.secondary, JarvisDesignTokens.primaryAccent, .secondary],
                    startPoint: UnitPoint(x: phase - 0.4, y: 0.5),
                    endPoint: UnitPoint(x: phase + 0.4, y: 0.5)
                ))
                .onAppear {
                    withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) { phase = 1.5 }
                }
        } else {
            content
        }
    }
}

extension View {
    func jarvisShimmer(isActive: Bool) -> some View { modifier(JarvisShimmer(isActive: isActive)) }
}

extension View {
    /// `isAnimated` is false for fixture and UI-test runs: endless animation keeps XCUITest from ever seeing the app idle.
    func jarvisRim(cornerRadius: CGFloat, state: JarvisRimState, isAnimated: Bool = true) -> some View {
        modifier(JarvisRim(cornerRadius: cornerRadius, state: state, isAnimated: isAnimated))
    }
}

/// Where a button sits. `.glass` draws the Apple glass itself (floating over content, page title bars);
/// `.onGlass` is for a host that already provides the glass (the system toolbar, a glass row), so the button adds no
/// second fill.
enum JarvisControlChrome {
    case glass
    case onGlass
}

/// The one icon button, identical to the Chat header buttons: Apple glass, 44 pt target, secondary accent icon.
/// Optional busy state (a progress view in place of the icon) and optional count badge.
/// HIG: Buttons, Toolbars, Materials. API: ButtonStyle.glass, ButtonBorderShape.circle, ProgressView.
struct JarvisIconButton: View {
    let title: String
    let systemImage: String
    var identifier: String
    var badge = 0
    var isBusy = false
    var isDisabled = false
    var chrome: JarvisControlChrome = .glass
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            JarvisControlGlyph(systemImage: systemImage, badge: badge, isBusy: isBusy, isDisabled: isDisabled)
        }
        .jarvisControlChrome(chrome)
        .disabled(isDisabled || isBusy)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

/// The one menu button: a glass icon, the same as `JarvisIconButton`, that opens a menu.
struct JarvisMenuButton<Content: View>: View {
    let title: String
    let systemImage: String
    var identifier: String
    var isDisabled = false
    var chrome: JarvisControlChrome = .glass
    let content: Content

    init(
        title: String,
        systemImage: String,
        identifier: String,
        isDisabled: Bool = false,
        chrome: JarvisControlChrome = .glass,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.identifier = identifier
        self.isDisabled = isDisabled
        self.chrome = chrome
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            JarvisControlGlyph(systemImage: systemImage, badge: 0, isBusy: false, isDisabled: isDisabled)
        }
        .jarvisControlChrome(chrome)
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

/// The one labelled button: text with an optional icon on Apple glass, secondary accent, no orange fill.
struct JarvisLabelledButton: View {
    let title: String
    var systemImage: String?
    var leading: AnyView?
    var identifier: String?
    var isBusy = false
    var isDisabled = false
    var isFullWidth = false
    var isDestructive = false
    var hint = ""
    let action: () -> Void

    private var tint: Color { isDestructive ? .red : JarvisDesignTokens.secondaryAccent }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isBusy {
                    ProgressView().accessibilityHidden(true)
                } else if let leading {
                    leading
                } else if let systemImage {
                    Image(systemName: systemImage).accessibilityHidden(true)
                }
                Text(title)
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(tint.opacity(isDisabled ? 0.4 : 1))
            .padding(.horizontal, 12)
            .frame(maxWidth: isFullWidth ? .infinity : nil, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            .contentShape(Capsule())
        }
        .buttonStyle(.glass)
        .disabled(isDisabled || isBusy)
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier ?? "")
    }
}

/// Icon (or progress view) with the 44 pt target, the secondary accent and an optional count badge.
private struct JarvisControlGlyph: View {
    let systemImage: String
    let badge: Int
    let isBusy: Bool
    let isDisabled: Bool

    var body: some View {
        Group {
            if isBusy {
                ProgressView()
            } else {
                Image(systemName: systemImage)
                    .symbolVariant(badge > 0 ? .fill : .none)
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent.opacity(isDisabled ? 0.4 : 1))
            }
        }
        .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
        .overlay(alignment: .topTrailing) {
            if badge > 0 {
                Text(badge > 99 ? "99+" : "\(badge)")
                    .font(.system(size: 10, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(JarvisDesignTokens.primaryAccentForeground)
                    .padding(.horizontal, 4)
                    .frame(minWidth: 18, minHeight: 16)
                    .background(JarvisDesignTokens.primaryAccent, in: Capsule())
                    .offset(x: -2, y: 2)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
    }
}

private extension View {
    @ViewBuilder
    func jarvisControlChrome(_ chrome: JarvisControlChrome) -> some View {
        switch chrome {
        case .glass:
            buttonStyle(.glass).buttonBorderShape(.circle)
        case .onGlass:
            buttonStyle(.plain)
        }
    }
}

/// Check mark that confirms a sheet. Shows a progress view while the work runs.
struct JarvisSheetConfirmButton: View {
    let title: String
    var isWorking = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        JarvisIconButton(
            title: title,
            systemImage: "checkmark",
            identifier: "sheet.confirm",
            isBusy: isWorking,
            isDisabled: isDisabled,
            chrome: .onGlass,
            action: action
        )
    }
}

/// X that closes a sheet. It sits on the right, within thumb reach.
struct JarvisSheetCloseButton: View {
    let title: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        JarvisIconButton(
            title: title,
            systemImage: "xmark",
            identifier: "sheet.cancel",
            isDisabled: isDisabled,
            chrome: .onGlass,
            action: action
        )
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

/// The one orb: the Chat mini core, always square (fixed aspect ratio and a circular clip) and scaled by size
/// only, so it looks the same on Home, the Gate, Voice and in chat at every size. Never draw an orb elsewhere.
/// API: View.aspectRatio(_:contentMode:), View.clipShape(_:), Circle.
struct JarvisOrb: View {
    let activity: JarvisMiniCoreActivity
    var size: CGFloat = JarvisDesignTokens.gateOrbSize
    var isStatic = false

    var body: some View {
        JarvisMiniCoreView(activity: activity, diameter: size, isStatic: isStatic)
            .aspectRatio(1, contentMode: .fit)
            .frame(width: size, height: size)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}

extension JarvisMiniCoreActivity {
    /// The orb's activity for a live Voice session.
    init(voiceState: VoiceSessionState, isMuted: Bool) {
        if isMuted {
            self = .muted
            return
        }
        switch voiceState {
        case .listening: self = .listening
        case .ready: self = .thinking
        case .speaking: self = .speaking
        case .reconnecting: self = .reconnecting
        case .failed, .ended: self = .offline
        case .idle, .connecting: self = .calm
        }
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

/// Live audio line for dictation: a centred line whose peaks follow the microphone level, newest on the right.
/// One Canvas, no per-frame work beyond the level updates it is given.
struct JarvisWaveform: View {
    let levels: [Float]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Canvas { context, size in
            guard !levels.isEmpty else { return }
            let step = size.width / CGFloat(levels.count)
            var path = Path()
            for (index, level) in levels.enumerated() {
                let x = (CGFloat(index) + 0.5) * step
                let half = max(1, CGFloat(level) * size.height / 2)
                path.move(to: CGPoint(x: x, y: size.height / 2 - half))
                path.addLine(to: CGPoint(x: x, y: size.height / 2 + half))
            }
            context.stroke(
                path,
                with: .color(JarvisDesignTokens.primaryAccent),
                style: StrokeStyle(lineWidth: max(1.5, step * 0.5), lineCap: .round)
            )
        }
        .frame(height: JarvisDesignTokens.chatMinimumTapTarget)
        .animation(reduceMotion ? nil : .linear(duration: 0.05), value: levels)
        .accessibilityHidden(true)
    }
}
