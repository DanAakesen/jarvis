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

/// Observe laid-out content, not message IDs: tools and the dock resize independently.
struct JarvisChatFollowLatest: ViewModifier {
    let proxy: ScrollViewProxy
    let bottomID: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var follow = ChatFollowState()
    @State private var revision = 0

    private struct Metrics: Equatable {
        let contentSize: CGSize
        let containerSize: CGSize
        let insets: EdgeInsets
        let offsetY: CGFloat

        init(_ geometry: ScrollGeometry) {
            contentSize = geometry.contentSize
            containerSize = geometry.containerSize
            insets = geometry.contentInsets
            offsetY = geometry.contentOffset.y
        }

        var distanceFromBottom: Double {
            Double(contentSize.height + insets.bottom - containerSize.height - offsetY)
        }

        func hasSameLayout(as other: Self) -> Bool {
            contentSize == other.contentSize && containerSize == other.containerSize && insets == other.insets
        }
    }

    func body(content: Content) -> some View {
        content
            .environment(\.chatSelectionChanged) { id, selected in
                follow.selectionChanged(messageID: id, isSelected: selected)
                revision += 1
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .onScrollGeometryChange(for: Metrics.self) { Metrics($0) } action: { old, new in
                if !old.hasSameLayout(as: new), follow.shouldFollow { revision += 1 }
            }
            .onScrollPhaseChange { old, new, context in
                switch new {
                case .tracking, .interacting, .decelerating:
                    follow.interactionBegan()
                case .idle:
                    if old != .animating {
                        follow.interactionEnded(distanceFromBottom: old == .tracking ? nil :
                            Metrics(context.geometry).distanceFromBottom)
                    }
                    revision += 1
                default: break
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { revision += 1 }
            }
            .task(id: revision) {
                await Task.yield()
                guard !Task.isCancelled, follow.shouldFollow, scenePhase == .active else { return }
                // Continuous activity follows without animation, including Reduce Motion.
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    proxy.scrollTo(bottomID, anchor: .bottom)
                }
            }
    }
}
