import JarvisCore
import SwiftUI

private struct ChatSelectionChangedKey: EnvironmentKey {
    static let defaultValue: (String, Bool) -> Void = { _, _ in }
}

extension EnvironmentValues {
    var chatSelectionChanged: (String, Bool) -> Void {
        get { self[ChatSelectionChangedKey.self] }
        set { self[ChatSelectionChangedKey.self] = newValue }
    }
}

struct JarvisChatFollowContent: Equatable {
    let historyRevision: Int
    let isSending: Bool
    let acknowledgment: String
    let progressUpdates: [String]
    let streamingText: String
    let tools: [ChatToolActivity]
    let isReconnecting: Bool
    let errors: [String?]
}

extension ChatFollowState.Phase {
    init(_ phase: ScrollPhase) {
        switch phase {
        case .tracking: self = .tracking
        case .interacting: self = .dragging
        case .decelerating: self = .coasting
        case .animating: self = .programmatic
        case .idle: self = .idle
        @unknown default: self = .programmatic
        }
    }
}

extension ChatFollowState.Viewport {
    init(_ geometry: ScrollGeometry) {
        self.init(
            offset: Double(geometry.contentOffset.y),
            top: -Double(geometry.contentInsets.top),
            bottom: Double(geometry.contentSize.height + geometry.contentInsets.bottom - geometry.containerSize.height)
        )
    }
}

/// Keep the transcript at the bottom after content or layout changes, except while the owner is reading history.
struct JarvisChatFollowLatest: ViewModifier {
    let proxy: ScrollViewProxy
    let contentState: JarvisChatFollowContent
    let sendRevision: Int
    /// Counts each time the keyboard opens, so the transcript scrolls to the latest message above it.
    var keyboardRevision = 0
    let jumpToLatestTitle: String
    var isEnabled = true
    var focusMessageID: String?
    @Environment(\.scenePhase) private var scenePhase
    @State private var follow = ChatFollowState()
    @State private var position = ScrollPosition()

    func body(content: Content) -> some View {
        content
            .environment(\.chatSelectionChanged) { id, selected in
                follow.selectionChanged(messageID: id, isSelected: selected)
                if !selected { followBottom() }
            }
            .scrollPosition($position)
            .defaultScrollAnchor(isEnabled && focusMessageID == nil ? .bottom : nil, for: .initialOffset)
            .onScrollPhaseChange { _, new in
                if follow.scrollPhaseChanged(.init(new)) { followBottom() }
            }
            .onScrollGeometryChange(for: ChatFollowState.Viewport.self) { .init($0) } action: { old, new in
                var updated = follow
                let needsScroll = updated.viewportChanged(from: old, to: new)
                if updated != follow { follow = updated }
                if needsScroll { followBottom() }
            }
            .onChange(of: scenePhase) { _, _ in
                followBottom()
            }
            .onChange(of: contentState) { _, _ in
                if follow.messageArrived() { followBottom() }
            }
            .onChange(of: sendRevision) { _, _ in
                follow.messageSent()
                followBottom()
            }
            .onChange(of: keyboardRevision) { _, _ in
                follow.keyboardOpened()
                followBottom()
            }
            .onChange(of: isEnabled) { _, enabled in
                if enabled {
                    follow = ChatFollowState()
                    followBottom()
                }
            }
            .onChange(of: focusMessageID, initial: true) { _, focusMessageID in
                if focusMessageID != nil {
                    follow.notificationMessageOpened()
                }
            }
            .task(id: focusMessageID) {
                guard let focusMessageID else { return }
                await Task.yield()
                guard !Task.isCancelled, scenePhase == .active else { return }
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    proxy.scrollTo(focusMessageID, anchor: .center)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if isEnabled && follow.shouldShowJumpToLatest {
                    JarvisIconButton(
                        title: jumpToLatestTitle,
                        systemImage: "arrow.down",
                        identifier: "chat.jumpToLatest"
                    ) {
                        follow.jumpedToLatest()
                        followBottom()
                    }
                    .padding(.trailing, JarvisDesignTokens.chatHorizontalInset)
                    .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
                }
            }
    }

    private func followBottom() {
        guard isEnabled, follow.shouldFollow, scenePhase == .active else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            // Target the actual edge, not an off-screen row the lazy stack may not have laid out yet.
            position.scrollTo(edge: .bottom)
        }
    }
}
