import SwiftUI

/// The one loading animation, used by every page, sheet and list: three pulsing accent dots with an optional
/// caption. With Reduce Motion the dots stay still. Replaces every ad-hoc `ProgressView` spinner.
/// Motion pauses offscreen and in the background; pending content never waits for animation.
struct JarvisLoadingView: View {
    /// Only the size differs: `.area` fills its container, `.inline` is a small dot row for buttons and rows.
    enum Size { case area, inline }

    var title: String?
    var size: Size = .area
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    private var dotSize: CGFloat { size == .inline ? 6 : 10 }

    var body: some View {
        VStack(spacing: 8) {
            if reduceMotion || !visible || scenePhase != .active {
                dots(at: nil)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
                    dots(at: timeline.date)
                }
            }
            if let title {
                Text(title)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: size == .area ? .infinity : nil)
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title ?? "")
        .accessibilityHidden(title == nil)
        .accessibilityIdentifier("jarvis.loading")
    }

    private func dots(at date: Date?) -> some View {
        HStack(spacing: size == .inline ? 4 : 8) {
            ForEach(0..<3, id: \.self) { index in
                let phase = (date?.timeIntervalSinceReferenceDate ?? 0) * .pi / 0.6 - Double(index) * 0.7
                let strength = date == nil ? 1 : 0.72 + 0.28 * cos(phase)
                Circle()
                    .fill(JarvisDesignTokens.primaryAccent)
                    .frame(width: dotSize, height: dotSize)
                    .scaleEffect(strength)
                    .opacity(strength)
            }
        }
    }
}
