import SwiftUI
import UIKit
import ObjectiveC

/// Swipe back, app wide: a swipe from the left edge does what the top-left back button does.
/// Pushed pages (a note's reader, Factory task and release, Settings details) use the system edge swipe of their
/// navigation stack, which UIKit switches off once a page hides the navigation bar and draws its own back button;
/// `jarvisSwipeBack()` keeps it on. Pages that go back by changing their own state (a Notes folder) use
/// `jarvisEdgeSwipeBack`, the same edge and direction. Neither touches sheets or the sidebar, which opens by a
/// swipe in the other direction.
/// HIG: Navigation, Gestures. API: UINavigationController.interactivePopGestureRecognizer, UIGestureRecognizerDelegate.
@MainActor
private final class JarvisSwipeBackDelegate: NSObject, UIGestureRecognizerDelegate {
    nonisolated(unsafe) static var associationKey: UInt8 = 0
    weak var navigationController: UINavigationController?

    /// Only a stack with something to pop may start the gesture: at the root it would freeze the screen.
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        (navigationController?.viewControllers.count ?? 0) > 1
    }

    static func attach(to navigationController: UINavigationController) {
        guard let recognizer = navigationController.interactivePopGestureRecognizer else { return }
        let delegate = objc_getAssociatedObject(navigationController, &associationKey) as? JarvisSwipeBackDelegate
            ?? JarvisSwipeBackDelegate()
        delegate.navigationController = navigationController
        objc_setAssociatedObject(navigationController, &associationKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        if recognizer.delegate !== delegate { recognizer.delegate = delegate }
        recognizer.isEnabled = true
    }
}

private struct JarvisSwipeBackEnabler: UIViewControllerRepresentable {
    final class Host: UIViewController {
        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            attach()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            attach()
        }

        func attach() {
            guard let navigationController else { return }
            JarvisSwipeBackDelegate.attach(to: navigationController)
        }
    }

    func makeUIViewController(context: Context) -> Host { Host() }

    func updateUIViewController(_ controller: Host, context: Context) { controller.attach() }
}

private struct JarvisEdgeSwipeBack: ViewModifier {
    let isEnabled: Bool
    let action: () -> Void

    /// How close to the left edge the swipe must start, and how far and how straight it must go.
    private let edgeWidth: CGFloat = 28
    private let minimumTravel: CGFloat = 64

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 20, coordinateSpace: .global)
                .onEnded { value in
                    guard isEnabled,
                          value.startLocation.x <= edgeWidth,
                          value.translation.width >= minimumTravel,
                          abs(value.translation.height) < value.translation.width / 2 else { return }
                    action()
                }
        )
    }
}

extension View {
    /// Keeps the system edge-swipe back working for every page pushed on the enclosing navigation stack.
    func jarvisSwipeBack() -> some View {
        background { JarvisSwipeBackEnabler().frame(width: 0, height: 0).accessibilityHidden(true) }
    }

    /// Edge-swipe back for a page whose back button changes its own state instead of popping a stack.
    func jarvisEdgeSwipeBack(isEnabled: Bool, perform action: @escaping () -> Void) -> some View {
        modifier(JarvisEdgeSwipeBack(isEnabled: isEnabled, action: action))
    }
}
