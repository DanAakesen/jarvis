import JarvisCore
import SwiftUI

/// Generated content on the Voice page: below the orb and status, above the microphone, plus, CC and hang-up
/// controls. Closing it dismisses the panel only; the voice session goes on. The slot owns observing the runtime
/// and reports the panel's size so the page can keep the orb and the controls in view.
struct VoiceContentSlot: View {
    @ObservedObject var runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let compactMaximumHeight: CGFloat
    let expandedMaximumHeight: CGFloat
    @Binding var isExpanded: Bool
    @Binding var height: CGFloat
    @Binding var frame: CGRect

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var animation: Animation? {
        reduceMotion ? nil : .smooth(duration: 0.3)
    }

    var body: some View {
        Group {
            if let presented = runtime.presentedView {
                VoiceContentPanel(
                    presented: presented,
                    runtime: runtime,
                    language: language,
                    compactMaximumHeight: compactMaximumHeight,
                    expandedMaximumHeight: expandedMaximumHeight,
                    isExpanded: $isExpanded,
                    onClose: { runtime.userDismissedView() }
                )
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("voiceScreen")) } action: { frame = $0 }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { newHeight in
                    withAnimation(animation) { height = newHeight }
                }
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(animation, value: runtime.presentedView)
        .onChange(of: runtime.presentedView == nil) { _, isEmpty in
            if isEmpty {
                height = 0
                frame = .zero
                isExpanded = false
            }
        }
    }
}

private struct VoiceContentPanel: View {
    let presented: PresentedWorkspaceView
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let compactMaximumHeight: CGFloat
    let expandedMaximumHeight: CGFloat
    @Binding var isExpanded: Bool
    let onClose: () -> Void

    @Environment(\.openURL) private var openURL
    @State private var notice: String?
    @State private var contentHeight: CGFloat = 0
    @State private var chromeHeight: CGFloat = 0

    private var inset: CGFloat { JarvisDesignTokens.rowSpacing + JarvisDesignTokens.compactSpacing }
    private var title: String { presented.view.workspaceTitle(language: language) }
    private var source: GeneratedViewSource? { presented.view.workspaceSource }
    private var maximumHeight: CGFloat { isExpanded ? expandedMaximumHeight : compactMaximumHeight }

    /// The scrolling area takes what the content needs, up to what is left of the panel's own limit.
    private var scrollHeight: CGFloat {
        let available = maximumHeight - chromeHeight - inset * 2 - JarvisDesignTokens.rowSpacing
        return max(JarvisDesignTokens.chatMinimumTapTarget, min(contentHeight, available))
    }

    /// Expanding is offered only when the content needs more room than the compact panel has.
    private var canExpand: Bool {
        isExpanded || contentHeight > compactMaximumHeight - chromeHeight - inset * 2 - JarvisDesignTokens.rowSpacing
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                header
                sourceNote
                if let notice {
                    Text(notice)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { chromeHeight = $0 }
            ScrollView {
                GeneratedViewContent(
                    view: presented.view,
                    runtime: runtime,
                    webAppURL: runtime.webAppURL,
                    language: language,
                    previewImage: nil,
                    onAction: { notice = performGeneratedViewAction($0, runtime: runtime, language: language, openURL: openURL) }
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: scrollHeight)
        }
        .padding(inset)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voice.panel")
        .onAppear { announce() }
        .onChange(of: presented.viewId) { _, _ in
            notice = nil
            announce()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: JarvisDesignTokens.rowSpacing) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            if source?.status == .running {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(text(.voicePanelUpdating))
            }
            if canExpand {
                JarvisIconButton(
                    title: text(isExpanded ? .voicePanelCollapse : .voicePanelExpand),
                    systemImage: isExpanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                    identifier: "voice.panel.expand"
                ) { isExpanded.toggle() }
            }
            JarvisIconButton(
                title: text(.voicePanelClose),
                systemImage: "xmark",
                identifier: "voice.panel.close",
                action: onClose
            )
        }
    }

    @ViewBuilder
    private var sourceNote: some View {
        switch source?.status {
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

    private func announce() {
        AccessibilityNotification.Announcement(String(format: text(.voicePanelShown), title)).post()
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}
