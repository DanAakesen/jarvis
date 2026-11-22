import JarvisCore
import SwiftUI

struct VoiceContentSlot: View {
    @ObservedObject var runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let maximumHeight: CGFloat
    @Binding var height: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded = false

    private var hasVisuals: Bool { runtime.voiceVisuals?.selectedID != nil }

    var body: some View {
        Group {
            if hasVisuals {
                VoiceVisualCarousel(runtime: runtime, language: language, isExpanded: false, isActive: !isExpanded) {
                    setExpanded(true)
                }
                .frame(height: maximumHeight)
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
        .fullScreenCover(isPresented: $isExpanded) {
            VoiceVisualCarousel(runtime: runtime, language: language, isExpanded: true, isActive: isExpanded) {
                setExpanded(false)
            }
            .background { JarvisScreenBackground().ignoresSafeArea() }
        }
    }

    private func setExpanded(_ expanded: Bool) {
        var transaction = Transaction()
        transaction.disablesAnimations = reduceMotion
        withTransaction(transaction) { isExpanded = expanded }
    }
}

private struct VoiceVisualCarousel: View {
    @ObservedObject var runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let isExpanded: Bool
    let isActive: Bool
    let toggleExpanded: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var entries: [PresentedWorkspaceView] { runtime.voiceVisuals?.entries ?? [] }
    private var selectedID: String? { runtime.voiceVisuals?.selectedID }
    private var index: Int? { entries.firstIndex { $0.id == selectedID } }
    private var inset: CGFloat { JarvisDesignTokens.rowSpacing + JarvisDesignTokens.compactSpacing }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                panelHeader
                TabView(selection: Binding(
                    get: { selectedID },
                    set: { if isActive, let id = $0 { runtime.selectVoiceVisual(id) } }
                )) {
                    ForEach(entries) { visual in
                        VoiceVisualPage(presented: visual, runtime: runtime, language: language, inset: inset)
                            .tag(visual.id)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(reduceMotion ? nil : JarvisDesignTokens.voicePanelMotion, value: selectedID)
            }
            .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
            if entries.count > 1, let index {
                navigation(at: index)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voice.panel")
        .onChange(of: selectedID, initial: true) { _, id in
            guard isActive, let visual = entries.first(where: { $0.id == id }) else { return }
            AccessibilityNotification.Announcement(
                String(format: text(.voicePanelShown), visual.view.workspaceTitle(language: language))
            ).post()
        }
    }

    private var panelHeader: some View {
        ZStack(alignment: .trailing) {
            JarvisPanelGrabber(
                title: text(isExpanded ? .voicePanelCollapse : .voicePanelExpand),
                action: toggleExpanded
            )
            .gesture(
                DragGesture(minimumDistance: JarvisDesignTokens.voiceVerticalSwipeDistance)
                    .onEnded { value in
                        let direction = VoiceVerticalSwipe(
                            translation: value.translation, minimumDistance: JarvisDesignTokens.voiceVerticalSwipeDistance
                        )
                        if direction == (isExpanded ? .down : .up) { toggleExpanded() }
                    }
            )
            .padding(.horizontal, JarvisDesignTokens.controlMinimumHeight)
            JarvisIconButton(title: text(.voicePanelClose), systemImage: "xmark", identifier: "voice.panel.close") {
                runtime.userDismissedView()
            }
        }
        .padding(.horizontal, inset)
    }

    private func navigation(at index: Int) -> some View {
        HStack(spacing: JarvisDesignTokens.rowSpacing) {
            JarvisIconButton(
                title: text(.voicePanelPrevious),
                systemImage: "chevron.backward",
                identifier: "voice.panel.previous",
                isDisabled: index == 0
            ) {
                runtime.selectVoiceVisual(entries[index - 1].id)
            }
            Text(JarvisWorkspaceLocalization.formatted(.voicePanelPosition, language: language, arguments: [index + 1, entries.count]))
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            JarvisIconButton(
                title: text(.voicePanelNext),
                systemImage: "chevron.forward",
                identifier: "voice.panel.next",
                isDisabled: index == entries.count - 1
            ) {
                runtime.selectVoiceVisual(entries[index + 1].id)
            }
        }
        .padding(.top, JarvisDesignTokens.compactSpacing)
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

    @Environment(\.openURL) private var openURL
    @State private var notice: String?

    private var title: String? {
        switch presented.view {
        case .htmlApp, .unknown, .unsupportedVersion: nil
        default: presented.view.workspaceTitle(language: language)
        }
    }

    var body: some View {
        GeometryReader { geometry in
            content(htmlHeight: max(
                JarvisDesignTokens.controlMinimumHeight, geometry.size.height - 2 * JarvisDesignTokens.compactSpacing
            ))
        }
    }

    private func content(htmlHeight: CGFloat) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                if let title, !title.isEmpty {
                    Text(title)
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
            .padding(.vertical, JarvisDesignTokens.compactSpacing)
        }
        .scrollBounceBehavior(.basedOnSize)
        .onChange(of: presented.view) { _, _ in notice = nil }
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
