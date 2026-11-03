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
    var isCircle = false
    var isInteractive = false

    private var shape: AnyShape {
        if isCircle { AnyShape(Circle()) } else if let cornerRadius { AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)) } else { AnyShape(Capsule()) }
    }

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(.regularMaterial, in: shape)
        } else {
            content.glassEffect(isInteractive ? JarvisGlass.surface(tint: tint).interactive() : JarvisGlass.surface(tint: tint), in: shape)
        }
    }
}

extension View {
    /// Glass behind a floating control. Pass a radius for a rounded rectangle, or none for a capsule. A tint colours
    /// accent surfaces such as the user bubble.
    func jarvisGlassSurface(cornerRadius: CGFloat? = nil, tint: Color? = nil) -> some View {
        modifier(JarvisGlassBackground(cornerRadius: cornerRadius, tint: tint))
    }

    /// Interactive glass in a capsule for the shared labelled buttons and tabs.
    func jarvisGlassCapsule() -> some View {
        modifier(JarvisGlassBackground(isInteractive: true))
    }

    /// Glass in a true circle for the shared icon and menu buttons.
    func jarvisGlassCircle() -> some View {
        modifier(JarvisGlassBackground(isCircle: true, isInteractive: true))
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

/// The one icon button, identical to the Chat header buttons: Apple glass, 44 pt target, secondary accent icon.
/// Optional busy state (a progress view in place of the icon), count badge, selected state, tint and short text glyph.
/// HIG: Buttons, Toolbars, Materials. API: ButtonStyle.glass, ButtonBorderShape.circle, ProgressView.
struct JarvisIconButton: View {
    let title: String
    var systemImage: String?
    var identifier: String
    var text: String?
    var badge = 0
    var isBusy = false
    var isDisabled = false
    var isSelected = false
    var tint: Color?
    var hint = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            JarvisControlGlyph(
                systemImage: systemImage, text: text, badge: badge, isBusy: isBusy,
                isDisabled: isDisabled, isSelected: isSelected, tint: tint
            )
        }
        .jarvisControlChrome()
        .disabled(isDisabled || isBusy)
        .accessibilityLabel(title)
        .accessibilityHint(hint)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }
}

/// The one menu button: a glass icon, the same as `JarvisIconButton`, that opens a menu.
struct JarvisMenuButton<Content: View>: View {
    let title: String
    let systemImage: String
    var identifier: String
    var text: String?
    var isDisabled = false
    var tint: Color?
    var hint = ""
    var value = ""
    let content: Content

    init(
        title: String,
        systemImage: String,
        identifier: String,
        text: String? = nil,
        isDisabled: Bool = false,
        tint: Color? = nil,
        hint: String = "",
        value: String = "",
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.identifier = identifier
        self.text = text
        self.isDisabled = isDisabled
        self.tint = tint
        self.hint = hint
        self.value = value
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            JarvisControlGlyph(
                systemImage: text == nil ? systemImage : nil, text: text, badge: 0, isBusy: false,
                isDisabled: isDisabled, isSelected: false, tint: tint
            )
        }
        .jarvisControlChrome()
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityValue(value)
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier)
    }
}

/// The text of a labelled control: optional leading icon or progress view, title, optional subtitle and chevron.
private struct JarvisLabelledContent: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    var leading: AnyView?
    var trailingSystemImage: String?
    var isBusy = false
    var isDisabled = false
    var isFullWidth = false
    var isLeading = false
    var isEmphasised = false
    var isDestructive = false

    private var tint: Color {
        if isDestructive { return .red }
        return isEmphasised ? JarvisDesignTokens.primaryAccent : JarvisDesignTokens.secondaryAccent
    }

    var body: some View {
        HStack(spacing: 8) {
            if isBusy {
                ProgressView().accessibilityHidden(true)
            } else if let leading {
                leading
            } else if let systemImage {
                Image(systemName: systemImage).accessibilityHidden(true)
            }
            if let subtitle {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            } else {
                Text(title).font(.body.weight(.semibold)).lineLimit(1)
            }
            if isLeading { Spacer(minLength: 0) }
            if let trailingSystemImage {
                Image(systemName: trailingSystemImage)
                    .font(.caption.weight(.semibold))
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(tint.opacity(isDisabled ? 0.4 : 1))
        .padding(.horizontal, JarvisDesignTokens.labelledHorizontalPadding)
        .padding(.vertical, JarvisDesignTokens.labelledVerticalPadding)
        .frame(
            maxWidth: isFullWidth ? .infinity : nil,
            minHeight: JarvisDesignTokens.chatMinimumTapTarget,
            alignment: isLeading ? .leading : .center
        )
        .contentShape(Capsule())
    }
}

/// The one labelled button: text with an optional icon on Apple glass, secondary accent, no orange fill.
/// `isEmphasised` colours the text with the primary accent (never a fill); `subtitle` adds a second line and
/// `isLeading` left-aligns a full-width button, for quick-action rows.
struct JarvisLabelledButton: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    var leading: AnyView?
    var trailingSystemImage: String?
    var identifier: String?
    var isBusy = false
    var isDisabled = false
    var isFullWidth = false
    var isLeading = false
    var isEmphasised = false
    var isSelected = false
    var isDestructive = false
    var hint = ""
    var accessibilityTitle: String?
    var accessibilityValue = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            JarvisLabelledContent(
                title: title, subtitle: subtitle, systemImage: systemImage, leading: leading,
                trailingSystemImage: trailingSystemImage, isBusy: isBusy, isDisabled: isDisabled,
                isFullWidth: isFullWidth, isLeading: isLeading, isEmphasised: isEmphasised || isSelected,
                isDestructive: isDestructive
            )
        }
        .buttonStyle(.plain)
        .jarvisGlassCapsule()
        .disabled(isDisabled || isBusy)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityLabel(accessibilityTitle ?? subtitle.map { "\(title). \($0)" } ?? title)
        .accessibilityValue(accessibilityValue)
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier ?? "")
    }
}

/// A quick-action tile: a round accent icon chip, a title and a subtitle on one glass surface. Tiles side by side
/// share the row equally.
struct JarvisTileButton: View {
    let title: String
    var subtitle: String?
    let systemImage: String
    var identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    .frame(width: 36, height: 36)
                    .background(JarvisDesignTokens.primaryAccent.opacity(0.18), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .lineLimit(1)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
            .padding(.leading, 10)
            .padding(.trailing, 12)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .accessibilityLabel(subtitle.map { "\(title). \($0)" } ?? title)
        .accessibilityIdentifier(identifier)
    }
}

/// One entry of a `JarvisTabStrip`.
struct JarvisTabItem<Tag: Hashable> {
    let tag: Tag
    let title: String
    var identifier: String?
}

/// The one tab strip and segmented control: a row of the shared labelled capsules, each on a single line with
/// comfortable padding and a 44 pt minimum height. It scrolls horizontally when the tabs do not fit, and never wraps.
struct JarvisTabStrip<Tag: Hashable>: View {
    let title: String
    let identifierPrefix: String
    let items: [JarvisTabItem<Tag>]
    @Binding var selection: Tag

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    JarvisLabelledButton(
                        title: item.title,
                        identifier: item.identifier ?? "\(identifierPrefix).\(index)",
                        isSelected: selection == item.tag
                    ) { selection = item.tag }
                }
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .accessibilityLabel(title)
    }
}

/// A labelled button that opens a menu (the period picker): the same glass, text and chevron.
struct JarvisLabelledMenu<Content: View>: View {
    let title: String
    var identifier: String?
    var isDisabled = false
    var isFullWidth = false
    var accessibilityTitle: String?
    let content: Content

    init(
        title: String,
        identifier: String? = nil,
        isDisabled: Bool = false,
        isFullWidth: Bool = false,
        accessibilityTitle: String? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.identifier = identifier
        self.isDisabled = isDisabled
        self.isFullWidth = isFullWidth
        self.accessibilityTitle = accessibilityTitle
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            JarvisLabelledContent(
                title: title, trailingSystemImage: "chevron.down", isDisabled: isDisabled,
                isFullWidth: isFullWidth, isLeading: isFullWidth
            )
        }
        .buttonStyle(.plain)
        .jarvisGlassCapsule()
        .disabled(isDisabled)
        .accessibilityLabel(accessibilityTitle ?? title)
        .accessibilityIdentifier(identifier ?? "")
    }
}

/// The camera shutter: a white ring with a white disc, or a progress view while a photo is taken.
struct JarvisShutterButton: View {
    let title: String
    var identifier = "camera.shutter"
    var isBusy = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if isBusy {
                ProgressView()
                    .tint(.white)
                    .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
            } else {
                Circle()
                    .stroke(.white, lineWidth: JarvisDesignTokens.voiceOrbStrokeWidth * 2)
                    .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
                    .overlay(Circle().fill(.white).padding(JarvisDesignTokens.voiceStatusSpacing / 2))
            }
        }
        .buttonStyle(.plain)
        .disabled(isBusy || isDisabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

/// Icon, short text or progress view with the 44 pt target, the secondary accent and an optional count badge.
private struct JarvisControlGlyph: View {
    var systemImage: String?
    var text: String?
    let badge: Int
    let isBusy: Bool
    let isDisabled: Bool
    let isSelected: Bool
    var tint: Color?

    private var color: Color {
        (tint ?? (isSelected ? JarvisDesignTokens.primaryAccent : JarvisDesignTokens.secondaryAccent))
            .opacity(isDisabled ? 0.4 : 1)
    }

    var body: some View {
        Group {
            if isBusy {
                ProgressView()
            } else if let text {
                Text(text)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(color)
            } else if let systemImage {
                Image(systemName: systemImage)
                    .symbolVariant(badge > 0 ? .fill : .none)
                    .font(.system(size: JarvisDesignTokens.iconButtonGlyphSize, weight: .regular))
                    .foregroundStyle(color)
            }
        }
        .frame(width: JarvisDesignTokens.iconButtonDiameter, height: JarvisDesignTokens.iconButtonDiameter)
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
        .contentShape(Circle())
    }
}

private extension View {
    /// One circle for every icon and menu button: a fixed square frame from one token and a Circle glass surface.
    /// In a toolbar the item must also hide the system container (`sharedBackgroundVisibility(.hidden)`), or the
    /// system draws a second glass around this one.
    func jarvisControlChrome() -> some View {
        buttonStyle(.plain)
            .frame(width: JarvisDesignTokens.iconButtonDiameter, height: JarvisDesignTokens.iconButtonDiameter)
            .jarvisGlassCircle()
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
        .sharedBackgroundVisibility(.hidden)
        ToolbarItem(placement: .topBarTrailing) {
            JarvisSheetCloseButton(title: closeTitle, isDisabled: isWorking, action: onClose)
        }
        .sharedBackgroundVisibility(.hidden)
    }
}

/// The one orb: the Chat mini core, always square (fixed aspect ratio and a circular clip) and scaled by size
/// only, so it looks the same on Home, the Gate, Voice and in chat at every size. Never draw an orb elsewhere.
/// API: View.aspectRatio(_:contentMode:), View.clipShape(_:), Circle.
struct JarvisOrb: View {
    let activity: JarvisOrbActivity
    var size: CGFloat = JarvisDesignTokens.gateOrbSize
    var isStatic = false

    var body: some View {
        JarvisOrbCanvas(activity: activity, isStatic: isStatic)
            .aspectRatio(1, contentMode: .fit)
            .frame(width: size, height: size)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}

/// The orb as a button (Home composer voice entry): the shared orb in a 44 pt target, no extra chrome.
struct JarvisOrbButton: View {
    let title: String
    var identifier: String
    var activity: JarvisOrbActivity = .calm
    var size: CGFloat = 28
    var isStatic = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            JarvisOrb(activity: activity, size: size, isStatic: isStatic)
                .frame(
                    width: JarvisDesignTokens.chatMinimumTapTarget,
                    height: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

extension JarvisOrbActivity {
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

/// Orange icon for the composer row (voice, dictation, send, stop): primary accent, no background, 44 pt target.
/// While `isBusy` it shows a progress view instead of the icon.
struct JarvisComposerIconButton: View {
    let title: String
    let systemImage: String
    var identifier: String
    var hint = ""
    var isDisabled = false
    var isBusy = false
    var iconSize = JarvisDesignTokens.chatComposerIconSize
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            JarvisComposerGlyph(systemImage: systemImage, isBusy: isBusy, iconSize: iconSize)
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier)
    }
}

/// The composer's plus: the same orange, backgroundless icon, opening a menu.
struct JarvisComposerMenuButton<Content: View>: View {
    let title: String
    let systemImage: String
    var identifier: String
    var hint = ""
    var isDisabled = false
    let content: Content

    init(
        title: String,
        systemImage: String,
        identifier: String,
        hint: String = "",
        isDisabled: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.identifier = identifier
        self.hint = hint
        self.isDisabled = isDisabled
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            JarvisComposerGlyph(
                systemImage: systemImage, isBusy: false, iconSize: JarvisDesignTokens.chatComposerIconSize
            )
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .tint(JarvisDesignTokens.secondaryAccent)
        .menuOrder(.fixed)
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier)
    }
}

private struct JarvisComposerGlyph: View {
    let systemImage: String
    let isBusy: Bool
    let iconSize: CGFloat

    var body: some View {
        Group {
            if isBusy {
                ProgressView()
            } else {
                Image(systemName: systemImage)
                    .font(.system(size: iconSize, weight: .regular))
                    .foregroundStyle(JarvisDesignTokens.primaryAccent)
            }
        }
        .frame(
            width: JarvisDesignTokens.chatMinimumTapTarget,
            height: JarvisDesignTokens.chatMinimumTapTarget
        )
        .contentShape(Rectangle())
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
