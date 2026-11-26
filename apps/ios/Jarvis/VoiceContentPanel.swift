import JarvisCore
import SwiftUI
import UIKit

struct VoiceContentSlot: View {
    @ObservedObject var runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let maximumHeight: CGFloat
    @Binding var height: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var isExpanded: Bool
    @State private var summaryHeight: CGFloat?

    private var hasVisuals: Bool { runtime.voiceVisuals?.selectedID != nil }

    var body: some View {
        Group {
            if hasVisuals {
                VoiceVisualCarousel(runtime: runtime, language: language, isExpanded: isExpanded) {
                    setExpanded(!isExpanded)
                }
                // A single short text result leaves room for captions above the panel.
                .frame(height: isExpanded ? maximumHeight : min(maximumHeight, summaryHeight ?? maximumHeight))
                .onPreferenceChange(VoiceSummaryHeight.self) { summaryHeight = $0 }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : JarvisDesignTokens.voicePanelMotion, value: hasVisuals)
        .onChange(of: hasVisuals, initial: true) { _, visible in
            if !visible {
                height = 0
                setExpanded(false)
            }
#if DEBUG && targetEnvironment(simulator)
            if visible, ProcessInfo.processInfo.arguments.contains("--screenshot-voice-fullscreen") {
                setExpanded(true)
            }
#endif
        }
    }

    private func setExpanded(_ expanded: Bool) {
        var transaction = Transaction()
        transaction.disablesAnimations = reduceMotion
        withTransaction(transaction) { isExpanded = expanded }
    }
}

private struct VoiceSummaryHeight: PreferenceKey {
    static var defaultValue: CGFloat? { nil }
    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) {
        if let height = nextValue() { value = height }
    }
}

struct VoiceWindowBounds: PreferenceKey {
    static var defaultValue: Anchor<CGRect>? { nil }
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

struct VoiceWindowMenu: View {
    @ObservedObject var runtime: WorkspaceRuntime
    let language: JarvisAppLanguage

    var body: some View {
        Menu {
            let windows = runtime.voiceVisuals?.windows ?? []
            if windows.isEmpty {
                Text(JarvisWorkspaceLocalization.string(.voiceWindowsEmpty, language: language))
            }
            ForEach(windows) { window in
                Button {
                    runtime.reopenVoiceVisual(window)
                } label: {
                    Label(window.view.workspaceTitle(language: language),
                          systemImage: window.id == runtime.voiceVisuals?.selectedID ? "checkmark" : "macwindow")
                }
            }
        } label: {
            Label(JarvisWorkspaceLocalization.string(.voiceWindows, language: language),
                  systemImage: "rectangle.on.rectangle")
        }
    }
}

private struct VoiceVisualCarousel: View {
    @ObservedObject var runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let isExpanded: Bool
    let toggleExpanded: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var horizontalDrag: CGFloat = 0

    private var entries: [PresentedWorkspaceView] { runtime.voiceVisuals?.entries ?? [] }
    private var selectedID: String? { runtime.voiceVisuals?.selectedID }
    private var inset: CGFloat { JarvisDesignTokens.rowSpacing + JarvisDesignTokens.compactSpacing }

    var body: some View {
        GeometryReader { geometry in
            let peek = entries.count > 1 ? min(geometry.size.width * 0.09, 38) : 0
            let width = max(1, geometry.size.width - 2 * peek)
            let stride = width + JarvisDesignTokens.compactSpacing
            let index = entries.firstIndex { $0.id == selectedID } ?? 0
            let drag = max(index == entries.count - 1 ? 0 : -stride,
                           min(index == 0 ? 0 : stride, horizontalDrag))

            ZStack(alignment: .leading) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { position, visual in
                    if abs(position - index) <= 2 {
                        let distance = CGFloat(position - index) + drag / stride
                        let fraction = reduceMotion ? 0 : min(1, abs(distance))
                        page(visual, selected: position == index)
                            .frame(width: width, height: geometry.size.height)
                            .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
                            // A material over the card softens its contents without rasterizing WebKit.
                            .overlay {
                                RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius)
                                    .fill(.ultraThinMaterial)
                                    .opacity(0.55 * Double(fraction))
                                    .allowsHitTesting(false)
                            }
                            .scaleEffect(1 - 0.06 * fraction)
                            .offset(x: peek + distance * stride)
                    }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .leading)
            .contentShape(Rectangle())
            .clipped()
            .animation(reduceMotion ? nil : JarvisDesignTokens.voicePanelMotion, value: selectedID)
            .gesture(VoiceWindowPan(
                canPage: entries.count > 1, isExpanded: isExpanded,
                drag: { horizontalDrag = $0 },
                finish: { projected in
                    let next = index + (projected < 0 ? 1 : -1)
                    withAnimation(reduceMotion ? nil : JarvisDesignTokens.voicePanelMotion) {
                        horizontalDrag = 0
                        if abs(projected) > stride * 0.2, entries.indices.contains(next) {
                            runtime.selectVoiceVisual(entries[next].id)
                        }
                    }
                },
                resize: toggleExpanded
            ))
            .onChange(of: selectedID, initial: true) { _, id in
                guard let visual = entries.first(where: { $0.id == id }) else { return }
                AccessibilityNotification.Announcement(visual.view.workspaceTitle(language: language)).post()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAdjustableAction { direction in
            guard let index = entries.firstIndex(where: { $0.id == selectedID }) else { return }
            let next = index + (direction == .increment ? 1 : -1)
            if entries.indices.contains(next) { runtime.selectVoiceVisual(entries[next].id) }
        }
        .anchorPreference(key: VoiceWindowBounds.self, value: .bounds) { $0 }
        .accessibilityIdentifier("voice.panel")
    }

    private func page(_ visual: PresentedWorkspaceView, selected: Bool) -> some View {
        VoiceVisualPage(presented: visual, runtime: runtime, language: language,
                        inset: inset, measuresSummary: !isExpanded && entries.count == 1)
            .overlay(alignment: .top) { if selected { resizeControl } }
            .overlay(alignment: .topTrailing) {
                if selected {
                    JarvisIconButton(title: text(.voicePanelClose), systemImage: "xmark",
                                     identifier: "voice.panel.close", showsBackground: false) {
                        runtime.closeSelectedVoiceVisual()
                    }
                }
            }
            .overlay {
                if !selected {
                    Color.clear.contentShape(Rectangle()).onTapGesture { runtime.selectVoiceVisual(visual.id) }
                }
            }
            .accessibilityHidden(!selected)
    }

    private var resizeControl: some View {
        JarvisPanelGrabber(title: text(isExpanded ? .voicePanelCollapse : .voicePanelExpand), action: toggleExpanded)
            .frame(width: JarvisDesignTokens.controlMinimumHeight * 1.5)
            .offset(y: -JarvisDesignTokens.voicePanelEdgeInset)
            .onTapGesture(perform: toggleExpanded)

    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}

/// Observe the same touch as the embedded scroll view, including WebKit and native charts.
private struct VoiceWindowPan: UIGestureRecognizerRepresentable {
    let canPage: Bool
    let isExpanded: Bool
    let drag: (CGFloat) -> Void
    let finish: (CGFloat) -> Void
    let resize: () -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.cancelsTouchesInView = false
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        let delta = pan.translation(in: pan.view?.window)
        let coordinator = context.coordinator
        switch pan.state {
        case .began:
            let velocity = pan.velocity(in: pan.view?.window)
            coordinator.horizontal = abs(velocity.x) > abs(velocity.y)
        case .changed where coordinator.horizontal && canPage:
            drag(delta.x)
        case .ended where coordinator.horizontal && canPage:
            let projected = delta.x + pan.velocity(in: pan.view?.window).x * 0.15
            finish(projected)
        case .ended where !coordinator.horizontal:
            let direction = VoiceVerticalSwipe(translation: CGSize(width: delta.x, height: delta.y),
                                               minimumDistance: JarvisDesignTokens.voiceVerticalSwipeDistance)
            if (!isExpanded && direction == .up) || (isExpanded && coordinator.startedAtTop && direction == .down) {
                resize()
            }
        case .cancelled, .failed:
            finish(0)
        default:
            break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var horizontal = false
        var startedAtTop = true

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            startedAtTop = true
            var view = touch.view
            while let child = view, child !== gestureRecognizer.view {
                if let scroll = child as? UIScrollView,
                   scroll.contentOffset.y > -scroll.adjustedContentInset.top + 1 {
                    startedAtTop = false
                    break
                }
                view = child.superview
            }
            return true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }
    }
}

private struct VoiceVisualPage: View {
    let presented: PresentedWorkspaceView
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let inset: CGFloat
    let measuresSummary: Bool

    @Environment(\.openURL) private var openURL
    @State private var notice: String?

    private var fitsSummary: Bool {
        guard measuresSummary else { return false }
        switch presented.view {
        case .text, .detail, .list, .status: return true
        default: return false
        }
    }

    private var title: String? {
        switch presented.view {
        case .htmlApp, .unknown, .unsupportedVersion: nil
        default: presented.view.workspaceTitle(language: language)
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let height = max(JarvisDesignTokens.controlMinimumHeight, geometry.size.height)
            if usesWebScrolling {
                content(htmlHeight: height)
            } else {
                ScrollView { content(htmlHeight: height) }
                    .scrollBounceBehavior(.basedOnSize)
            }
        }
        .onChange(of: presented.view) { _, _ in notice = nil }
    }

    private func content(htmlHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            if let title, !title.isEmpty {
                Text(title)
                    .padding(.trailing, JarvisDesignTokens.controlMinimumHeight)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                    .accessibilityAddTraits(.isHeader)
            }
            sourceNote
            GeneratedViewContent(
                view: presented.view,
                runtime: runtime,
                language: language,
                previewImage: nil,
                voiceHTMLHeight: htmlHeight,
                onAction: { notice = performGeneratedViewAction($0, runtime: runtime, language: language, openURL: openURL) }
            )
            if let notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, inset)
        .padding(.vertical, usesWebScrolling ? 0 : JarvisDesignTokens.voicePanelEdgeInset)
        .background {
            if fitsSummary {
                GeometryReader { proxy in
                    Color.clear.preference(key: VoiceSummaryHeight.self, value: ceil(proxy.size.height))
                }
            }
        }
    }

    private var usesWebScrolling: Bool {
        if case .htmlApp = presented.view { return true }
        return false
    }

    @ViewBuilder
    private var sourceNote: some View {
        let source = presented.view.workspaceSource
        switch source?.status {
        case .running:
            ProgressView(text(.voicePanelUpdating))
                .controlSize(.small)
        case .partial:
            Label(source?.reason ?? text(.voicePanelPartial), systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(.secondary)
        case .unavailable:
            Label(source?.reason ?? text(.voicePanelUnavailable), systemImage: "exclamationmark.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
        default:
            EmptyView()
        }
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}
