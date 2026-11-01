#if targetEnvironment(simulator)
import SwiftUI
import UIKit

struct JarvisInputHitTestingProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: ProbeView, context: Context) {
        uiView.scheduleReport()
    }

    final class ProbeView: UIView {
        private var reportScheduled = false
        private var lastReport = ""
        private var reportCount = 0

        override func didMoveToWindow() {
            super.didMoveToWindow()
            scheduleReport()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            scheduleReport()
        }

        func scheduleReport() {
            guard !reportScheduled, reportCount < 20 else { return }
            reportScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.reportScheduled = false
                self.report()
            }
        }

        private func report() {
            guard let window, !bounds.isEmpty, let scene = window.windowScene else { return }
            let point = convert(CGPoint(x: bounds.midX, y: bounds.midY), to: window)
            let windows = scene.windows.sorted { $0.windowLevel > $1.windowLevel }
            var lines = ["Composer point in app window: \(point)"]
            for candidate in windows {
                let converted = candidate.convert(point, from: window)
                lines.append("Window level=\(candidate.windowLevel.rawValue) hidden=\(candidate.isHidden)")
                lines.append("Hit ancestry: " + ancestry(candidate.hitTest(converted, with: nil)))
                for input in textInputs(in: candidate) {
                    lines.append("Native input ancestry: " + ancestry(input))
                }
            }
            let report = lines.joined(separator: "\n")
            guard report != lastReport else { return }
            lastReport = report
            reportCount += 1
            // Only fixture geometry and UIKit types are logged, never message text.
            print("Jarvis input hit test:\n\(report)")
        }

        private func textInputs(in view: UIView) -> [UIView] {
            if view is UITextField || view is UITextView { return [view] }
            return view.subviews.flatMap { textInputs(in: $0) }
        }

        private func ancestry(_ view: UIView?) -> String {
            var current = view
            var entries: [String] = []
            while let node = current, entries.count < 20 {
                entries.append(
                    "\(type(of: node)) frame=\(node.frame) bounds=\(node.bounds) " +
                    "hidden=\(node.isHidden) alpha=\(node.alpha) " +
                    "input=\(node.isUserInteractionEnabled) clips=\(node.clipsToBounds)"
                )
                current = node.superview
            }
            return entries.isEmpty ? "none" : entries.joined(separator: " -> ")
        }
    }
}
#endif
