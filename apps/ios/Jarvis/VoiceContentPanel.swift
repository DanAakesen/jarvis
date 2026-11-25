import JarvisCore
import SwiftUI

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
    @GestureState private var horizontalDrag: CGFloat = 0

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
            .simultaneousGesture(pageDrag(index: index, stride: stride, width: geometry.size.width, peek: peek))
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

    private func pageDrag(index: Int, stride: CGFloat, width: CGFloat, peek: CGFloat) -> some Gesture {
        func canPage(from start: CGPoint) -> Bool {
            guard entries.count > 1, entries.indices.contains(index) else { return false }
            switch entries[index].view {
            case .htmlApp, .map, .table, .knowledgeGraph, .code, .chart:
                // Keep horizontal interaction inside the content; the grip and adjacent cards still page.
                let grip = JarvisDesignTokens.controlMinimumHeight
                return start.x < peek || start.x > width - peek ||
                    (abs(start.x - width / 2) < grip * 0.75 && start.y < grip / 2)
            default:
                return true
            }
        }

        return DragGesture(minimumDistance: 10)
            .updating($horizontalDrag) { value, drag, transaction in
                guard canPage(from: value.startLocation), abs(value.translation.width) > abs(value.translation.height) else { return }
                transaction.animation = nil
                drag = value.translation.width
            }
            .onEnded { value in
                let delta = value.translation
                guard canPage(from: value.startLocation), abs(delta.width) > abs(delta.height),
                      abs(value.predictedEndTranslation.width) > stride * 0.2 else { return }
                let next = index + (delta.width < 0 ? 1 : -1)
                if entries.indices.contains(next) { runtime.selectVoiceVisual(entries[next].id) }
            }
    }

    private var resizeControl: some View {
        JarvisPanelGrabber(title: text(isExpanded ? .voicePanelCollapse : .voicePanelExpand), action: toggleExpanded)
            .frame(width: JarvisDesignTokens.controlMinimumHeight * 1.5)
            .offset(y: -JarvisDesignTokens.voicePanelEdgeInset)
            .onTapGesture(perform: toggleExpanded)
            .simultaneousGesture(DragGesture(minimumDistance: JarvisDesignTokens.voiceVerticalSwipeDistance)
                .onEnded { value in
                    let direction = VoiceVerticalSwipe(translation: value.translation,
                                                       minimumDistance: JarvisDesignTokens.voiceVerticalSwipeDistance)
                    if direction == (isExpanded ? .down : .up) { toggleExpanded() }
                })
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
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
