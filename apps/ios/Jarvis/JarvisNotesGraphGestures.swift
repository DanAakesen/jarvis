import SwiftUI
import UIKit

/// The graph's touch layer. SwiftUI's drag is one finger only, so the two-finger turn needs UIKit recognisers:
/// two fingers dragging turn and tilt the graph, a twist turns it, a pinch zooms about the fingers, one finger pans,
/// a tap selects and a long press focuses a note's neighbourhood. Moving, pinching and twisting can happen together.
/// The strip at the leading edge is left to the system back swipe.
/// API: UIPanGestureRecognizer, UIPinchGestureRecognizer, UIRotationGestureRecognizer, UIGestureRecognizerDelegate.
struct JarvisGraphGestureLayer: UIViewRepresentable {
    /// The first finger of a gesture lands: stop any glide.
    var onBegan: () -> Void
    /// Two-finger drag since the last call, in points.
    var onOrbit: (CGSize) -> Void
    /// Two-finger twist since the last call, in radians (clockwise is positive).
    var onTwist: (CGFloat) -> Void
    var onPan: (CGSize) -> Void
    /// Pinch scale since the last call and the point between the fingers.
    var onPinch: (CGFloat, CGPoint) -> Void
    /// Every finger is up; the last two-finger drag velocity in points per second.
    var onEnded: (CGSize) -> Void
    var onTap: (CGPoint) -> Void
    var onLongPress: (CGPoint) -> Void

    static let leadingEdgeInset: CGFloat = 24

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.isMultipleTouchEnabled = true
        let coordinator = context.coordinator

        coordinator.orbit.addTarget(coordinator, action: #selector(Coordinator.handleOrbit(_:)))
        coordinator.orbit.minimumNumberOfTouches = 2
        coordinator.orbit.maximumNumberOfTouches = 2
        coordinator.pan.addTarget(coordinator, action: #selector(Coordinator.handlePan(_:)))
        coordinator.pan.minimumNumberOfTouches = 1
        coordinator.pan.maximumNumberOfTouches = 1
        coordinator.pinch.addTarget(coordinator, action: #selector(Coordinator.handlePinch(_:)))
        coordinator.rotation.addTarget(coordinator, action: #selector(Coordinator.handleRotation(_:)))
        coordinator.tap.addTarget(coordinator, action: #selector(Coordinator.handleTap(_:)))
        coordinator.longPress.addTarget(coordinator, action: #selector(Coordinator.handleLongPress(_:)))
        coordinator.longPress.minimumPressDuration = 0.45

        for recogniser in coordinator.recognisers {
            recogniser.delegate = coordinator
            view.addGestureRecognizer(recogniser)
        }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: JarvisGraphGestureLayer
        let orbit = UIPanGestureRecognizer()
        let pan = UIPanGestureRecognizer()
        let pinch = UIPinchGestureRecognizer()
        let rotation = UIRotationGestureRecognizer()
        let tap = UITapGestureRecognizer()
        let longPress = UILongPressGestureRecognizer()
        private var active = 0
        private var orbitVelocity = CGSize.zero

        var recognisers: [UIGestureRecognizer] { [orbit, pan, pinch, rotation, tap, longPress] }

        init(_ parent: JarvisGraphGestureLayer) {
            self.parent = parent
        }

        private func began() {
            if active == 0 { parent.onBegan() }
            active += 1
        }

        private func ended() {
            active = max(0, active - 1)
            guard active == 0 else { return }
            let velocity = orbitVelocity
            orbitVelocity = .zero
            parent.onEnded(velocity)
        }

        @objc func handleOrbit(_ recogniser: UIPanGestureRecognizer) {
            switch recogniser.state {
            case .began:
                began()
            case .changed:
                let translation = recogniser.translation(in: recogniser.view)
                recogniser.setTranslation(.zero, in: recogniser.view)
                parent.onOrbit(CGSize(width: translation.x, height: translation.y))
            case .ended, .cancelled:
                let velocity = recogniser.velocity(in: recogniser.view)
                orbitVelocity = recogniser.state == .ended ? CGSize(width: velocity.x, height: velocity.y) : .zero
                ended()
            default:
                break
            }
        }

        @objc func handlePan(_ recogniser: UIPanGestureRecognizer) {
            switch recogniser.state {
            case .began:
                began()
            case .changed:
                let translation = recogniser.translation(in: recogniser.view)
                recogniser.setTranslation(.zero, in: recogniser.view)
                parent.onPan(CGSize(width: translation.x, height: translation.y))
            case .ended, .cancelled:
                ended()
            default:
                break
            }
        }

        @objc func handlePinch(_ recogniser: UIPinchGestureRecognizer) {
            switch recogniser.state {
            case .began:
                began()
            case .changed:
                parent.onPinch(recogniser.scale, recogniser.location(in: recogniser.view))
                recogniser.scale = 1
            case .ended, .cancelled:
                ended()
            default:
                break
            }
        }

        @objc func handleRotation(_ recogniser: UIRotationGestureRecognizer) {
            switch recogniser.state {
            case .began:
                began()
            case .changed:
                parent.onTwist(recogniser.rotation)
                recogniser.rotation = 0
            case .ended, .cancelled:
                ended()
            default:
                break
            }
        }

        @objc func handleTap(_ recogniser: UITapGestureRecognizer) {
            guard recogniser.state == .ended else { return }
            parent.onTap(recogniser.location(in: recogniser.view))
        }

        @objc func handleLongPress(_ recogniser: UILongPressGestureRecognizer) {
            guard recogniser.state == .began else { return }
            parent.onLongPress(recogniser.location(in: recogniser.view))
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool {
            let together: [UIGestureRecognizer] = [orbit, pinch, rotation]
            return together.contains { $0 === gestureRecognizer } && together.contains { $0 === other }
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard gestureRecognizer === pan || gestureRecognizer === orbit, let view = gestureRecognizer.view else { return true }
            return touch.location(in: view).x > JarvisGraphGestureLayer.leadingEdgeInset
        }
    }
}
