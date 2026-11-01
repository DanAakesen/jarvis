import JarvisCore
import SwiftUI
import UIKit

/// Opens the trailing drawer from the system screen-edge pan. The recogniser lives on the window so it
/// never intercepts touches meant for scrolling, the composer, or the system back swipe on the leading edge.
struct JarvisSidebarEdgeOpener: UIViewRepresentable {
    let isEnabled: Bool
    let drawerWidth: CGFloat
    let onProgress: (Double) -> Void
    let onCancel: () -> Void
    let onOpen: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> AnchorView {
        let view = AnchorView()
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: AnchorView, context: Context) {
        context.coordinator.update(self)
    }

    static func dismantleUIView(_ view: AnchorView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class AnchorView: UIView {
        weak var coordinator: Coordinator?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(to: window)
        }
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private var parent: JarvisSidebarEdgeOpener?
        private weak var window: UIWindow?
        private lazy var recognizer: UIScreenEdgePanGestureRecognizer = {
            let recognizer = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handle(_:)))
            recognizer.edges = .right
            recognizer.cancelsTouchesInView = false
            recognizer.delegate = self
            return recognizer
        }()

        func update(_ parent: JarvisSidebarEdgeOpener) {
            self.parent = parent
            recognizer.isEnabled = parent.isEnabled
        }

        func attach(to newWindow: UIWindow?) {
            guard newWindow !== window else { return }
            detach()
            window = newWindow
            newWindow?.addGestureRecognizer(recognizer)
        }

        func detach() {
            window?.removeGestureRecognizer(recognizer)
            window = nil
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            parent?.isEnabled == true && window?.rootViewController?.presentedViewController == nil
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool {
            true
        }

        // The page follows the finger while the pan is live; only a completed, qualifying pan commits.
        @objc private func handle(_ recognizer: UIScreenEdgePanGestureRecognizer) {
            guard let parent, let view = recognizer.view else { return }
            let translation = recognizer.translation(in: view)
            switch recognizer.state {
            case .began, .changed:
                guard parent.drawerWidth > 0, translation.x < 0,
                      abs(translation.x) > abs(translation.y) else { return }
                parent.onProgress(Double(-translation.x / parent.drawerWidth))
            case .ended:
                let velocity = recognizer.velocity(in: view)
                guard JarvisSidebarGesturePolicy.shouldOpen(
                    translationX: Double(translation.x),
                    translationY: Double(translation.y),
                    velocityX: Double(velocity.x),
                    drawerWidth: Double(parent.drawerWidth),
                    openThreshold: Double(JarvisDesignTokens.sidebarOpenThreshold)
                ) else {
                    parent.onCancel()
                    return
                }
                parent.onOpen()
            default:
                parent.onCancel()
            }
        }
    }
}
