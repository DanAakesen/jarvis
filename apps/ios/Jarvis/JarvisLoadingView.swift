import SwiftUI

/// Initial page loading has one stable, noninteractive layout. No filters or invented values are exposed.
/// A single localized announcement replaces the decorative shapes for VoiceOver. Static shapes also honor
/// Reduce Motion without keeping an animation alive while a request is pending (HIG: Loading, Accessibility).
struct JarvisPageLoadingView: View {
    let title: String
    var identifier = "page.loading"
    @ScaledMetric(relativeTo: .body) private var lineHeight = JarvisPageHeaderMetrics.skeletonLineHeight

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
            line()
            line().frame(maxWidth: JarvisPageHeaderMetrics.statMinimumWidth * 3)
            RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius)
                .fill(.secondary.opacity(0.12))
                .frame(height: JarvisPageHeaderMetrics.skeletonHeroHeight)
            line().frame(maxWidth: JarvisPageHeaderMetrics.statMinimumWidth * 2)
                .padding(.top, JarvisPageHeaderMetrics.spacing)
            JarvisRowGroup {
                ForEach(0..<3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        line()
                        line().frame(maxWidth: JarvisPageHeaderMetrics.statMinimumWidth * 2)
                    }
                    .jarvisListRow()
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }

    private func line() -> some View {
        RoundedRectangle(cornerRadius: JarvisPageHeaderMetrics.rowLineSpacing)
            .fill(.secondary.opacity(0.16))
            .frame(height: lineHeight)
    }
}

/// The one loading animation, used by every page, sheet and list: three pulsing accent dots with an optional
/// caption. With Reduce Motion the dots stay still. Replaces every ad-hoc `ProgressView` spinner.
/// HIG: Loading, Motion, Accessibility. API: accessibilityReduceMotion, repeatForever animation.
struct JarvisLoadingView: View {
    /// Only the size differs: `.area` fills its container, `.inline` is a small dot row for buttons and rows.
    enum Size { case area, inline }

    var title: String?
    var size: Size = .area
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var dotSize: CGFloat { size == .inline ? 6 : 10 }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: size == .inline ? 4 : 8) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(JarvisDesignTokens.primaryAccent)
                        .frame(width: dotSize, height: dotSize)
                        .scaleEffect(pulsing ? 1 : 0.55)
                        .opacity(pulsing ? 1 : 0.4)
                        .animation(
                            reduceMotion
                                ? nil
                                : .easeInOut(duration: 0.6).repeatForever(autoreverses: true).delay(Double(index) * 0.2),
                            value: pulsing
                        )
                }
            }
            if let title {
                Text(title)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: size == .area ? .infinity : nil)
        .onAppear { pulsing = true }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title ?? "")
        .accessibilityHidden(title == nil)
        .accessibilityIdentifier("jarvis.loading")
    }
}
