import JarvisCore
import SwiftUI

struct VoiceContentSlot: View {
    @ObservedObject var runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let maximumHeight: CGFloat
    @Binding var height: CGFloat
    @Binding var frame: CGRect

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded = false

    private var hasVisuals: Bool { runtime.voiceVisuals?.selectedID != nil }

    var body: some View {
        Group {
            if hasVisuals {
                VoiceVisualCarousel(runtime: runtime, language: language, isExpanded: false, isActive: !isExpanded) {
                    isExpanded = true
                }
                .frame(height: maximumHeight)
                .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("voiceScreen")) } action: { frame = $0 }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : JarvisDesignTokens.voicePanelMotion, value: hasVisuals)
        .onChange(of: hasVisuals, initial: true) { _, visible in
            if !visible {
                height = 0
                frame = .zero
                isExpanded = false
            }
#if DEBUG && targetEnvironment(simulator)
            if visible, ProcessInfo.processInfo.arguments.contains("--screenshot-voice-fullscreen") {
                isExpanded = true
            }
#endif
        }
        .fullScreenCover(isPresented: $isExpanded) {
            VoiceVisualCarousel(runtime: runtime, language: language, isExpanded: true, isActive: isExpanded) {
                isExpanded = false
            }
            .background { JarvisScreenBackground().ignoresSafeArea() }
        }
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
            .overlay(alignment: .topLeading) {
                HStack(spacing: JarvisDesignTokens.rowSpacing) {
                    JarvisIconButton(title: text(.voicePanelClose), systemImage: "xmark", identifier: "voice.panel.close") {
                        runtime.userDismissedView()
                    }
                    JarvisIconButton(
                        title: text(isExpanded ? .voicePanelCollapse : .voicePanelExpand),
                        systemImage: isExpanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                        identifier: "voice.panel.expand",
                        action: toggleExpanded
                    )
                }
                .padding(inset)
            }
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
        .padding(.bottom, JarvisDesignTokens.compactSpacing)
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

    private var isHTML: Bool {
        if case .htmlApp = presented.view { return true }
        return false
    }

    private var controlsWidth: CGFloat {
        JarvisDesignTokens.controlMinimumHeight * 2 + JarvisDesignTokens.rowSpacing * 2
    }

    var body: some View {
        GeometryReader { geometry in
            content(htmlHeight: max(JarvisDesignTokens.controlMinimumHeight, geometry.size.height - 2 * inset))
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
                        .frame(minHeight: JarvisDesignTokens.controlMinimumHeight, alignment: .center)
                        .padding(.leading, controlsWidth)
                }
                sourceNote.padding(.leading, isHTML ? controlsWidth : 0)
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
            .padding(inset)
            // A title-less visual can scroll under the controls, but its first content must also be readable at rest.
            .padding(.top, isHTML || title?.isEmpty == false ? 0 : JarvisDesignTokens.controlMinimumHeight)
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
