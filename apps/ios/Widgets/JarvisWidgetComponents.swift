import JarvisCore
import SwiftUI
import UIKit
import WidgetKit

/// Colours: orange is the accent; blue only separates runs from lifts; the four Factory statuses keep their own.
enum JarvisWidgetPalette {
    static let lift = Color.orange
    static let run = Color.blue
    /// The secondary colour of the Notes and Home widgets: a warm grey that sits beside the orange accent.
    static let stone = Color(red: 0.66, green: 0.64, blue: 0.62)
    static let secondaryText = JarvisWidgetSecondaryTextStyle()

    static func status(_ status: JarvisFactoryWidgetData.Status) -> Color {
        switch status {
        case .running: .orange
        case .awaiting: .yellow
        case .review: .green
        case .failed: .red
        }
    }
}

/// Small supporting labels need stronger contrast on a light widget surface.
/// Keep the system's existing secondary treatment in dark and accented appearances.
struct JarvisWidgetSecondaryTextStyle: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> AnyShapeStyle {
        environment.colorScheme == .light && environment.widgetRenderingMode == .fullColor
            ? AnyShapeStyle(Color(white: 0.33))
            : AnyShapeStyle(.secondary)
    }
}

private struct JarvisWidgetStaleAppearance: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widgetRenderingMode) private var renderingMode
    let isStale: Bool

    func body(content: Content) -> some View {
        // Updated-time copy carries freshness; fading light-mode text makes it unreadable.
        content.opacity(isStale && (colorScheme == .dark || renderingMode != .fullColor) ? 0.55 : 1)
    }
}

/// Bare icon and label, no background.
struct JarvisWidgetHeader: View {
    let symbol: String
    let title: String
    var staleText: String?

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.orange)
                .widgetAccentable()
                .accessibilityHidden(true)
            Text(title)
                .font(.footnote.weight(.semibold))
                .lineLimit(1)
                .layoutPriority(1)
                .accessibilityIdentifier("widget.header.title")
            if let staleText {
                Spacer(minLength: 4)
                Text(staleText)
                    .font(.caption2)
                    .foregroundStyle(JarvisWidgetPalette.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Loading, empty, error and offline: a bare symbol and one line, never a spinner.
struct JarvisWidgetMessage: View {
    let symbol: String
    let text: String

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(JarvisWidgetPalette.secondaryText)
                .accessibilityHidden(true)
            Text(text)
                .font(.caption)
                .foregroundStyle(JarvisWidgetPalette.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// Draws the non-content states of one topic, or the content closure for data.
struct JarvisWidgetStateView<Value: Equatable & Sendable, Content: View>: View {
    let state: JarvisWidgetViewState<Value>
    let language: JarvisAppLanguage
    let emptyCopy: JarvisWidgetCopy
    /// Loading draws this many skeleton rows instead of the message line; zero keeps the message.
    var skeletonRows = 0
    @ViewBuilder let content: (Value, Bool) -> Content

    var body: some View {
        switch state {
        case .loading:
            if skeletonRows > 0 {
                JarvisWidgetSkeleton(rows: skeletonRows, language: language)
            } else {
                JarvisWidgetMessage(symbol: "ellipsis", text: JarvisWidgetCopy.loading.text(language: language))
            }
        case .empty:
            JarvisWidgetMessage(symbol: "tray", text: emptyCopy.text(language: language))
        case .error:
            JarvisWidgetMessage(symbol: "exclamationmark.triangle", text: JarvisWidgetCopy.error.text(language: language))
        case .offline:
            JarvisWidgetMessage(symbol: "wifi.slash", text: JarvisWidgetCopy.offline.text(language: language))
        case .content(let value, let isStale):
            content(value, isStale)
        }
    }
}

/// Loading skeleton: a short heading bar and rows of muted bars. Static, so Reduce Motion needs no special case.
struct JarvisWidgetSkeleton: View {
    let rows: Int
    let language: JarvisAppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            bar(fraction: 0.4, height: 14)
            ForEach(0..<rows, id: \.self) { index in
                bar(fraction: index.isMultiple(of: 2) ? 0.92 : 0.66, height: 10)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(JarvisWidgetCopy.loading.text(language: language))
    }

    private func bar(fraction: Double, height: CGFloat) -> some View {
        GeometryReader { proxy in
            RoundedRectangle(cornerRadius: height / 2)
                .fill(Color.secondary.opacity(0.22))
                .frame(width: proxy.size.width * fraction)
        }
        .frame(height: height)
    }
}

/// A vertical bar chart with day (or week) labels under the bars, an optional dashed target line and the last bar
/// highlighted. It fills the space it is given.
struct JarvisWidgetBarChart: View {
    let values: [Int]
    let labels: [String]
    var target: Int?
    var accessibilityText: String

    var body: some View {
        VStack(spacing: 3) {
            GeometryReader { proxy in
                let ceiling = Double(max(values.max() ?? 0, target ?? 0, 1))
                ZStack(alignment: .bottom) {
                    HStack(alignment: .bottom, spacing: 4) {
                        ForEach(values.indices, id: \.self) { index in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(index == values.count - 1 ? Color.orange : Color.orange.opacity(0.4))
                                .frame(height: max(2, proxy.size.height * Double(values[index]) / ceiling))
                                .widgetAccentable(index == values.count - 1)
                        }
                    }
                    if let target, target > 0 {
                        JarvisWidgetTargetLine(fraction: Double(target) / ceiling)
                    }
                }
            }
            JarvisWidgetLabels(labels: labels)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

/// Lifts (orange) at the bottom and runs (blue) on top, per week, with a dashed weekly target and the current week
/// highlighted.
struct JarvisWidgetStackedChart: View {
    let weeks: [JarvisGymWidgetData.Week]
    let target: Int
    var accessibilityText: String

    var body: some View {
        VStack(spacing: 3) {
            GeometryReader { proxy in
                let ceiling = Double(max(weeks.map { $0.lifts + $0.runs }.max() ?? 0, target, 1))
                ZStack(alignment: .bottom) {
                    HStack(alignment: .bottom, spacing: 4) {
                        ForEach(weeks.indices, id: \.self) { index in
                            let current = index == weeks.count - 1
                            VStack(spacing: 1) {
                                Spacer(minLength: 0)
                                if weeks[index].runs > 0 {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(JarvisWidgetPalette.run.opacity(current ? 1 : 0.45))
                                        .frame(height: proxy.size.height * Double(weeks[index].runs) / ceiling)
                                }
                                if weeks[index].lifts > 0 {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(JarvisWidgetPalette.lift.opacity(current ? 1 : 0.45))
                                        .frame(height: proxy.size.height * Double(weeks[index].lifts) / ceiling)
                                }
                            }
                        }
                    }
                    if target > 0 {
                        JarvisWidgetTargetLine(fraction: Double(target) / ceiling)
                    }
                }
            }
            JarvisWidgetLabels(labels: weeks.map { String($0.weekNumber) })
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

private struct JarvisWidgetTargetLine: View {
    let fraction: Double

    var body: some View {
        GeometryReader { proxy in
            Path { path in
                let y = proxy.size.height * (1 - min(fraction, 1))
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: proxy.size.width, y: y))
            }
            .stroke(Color.secondary, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
        .allowsHitTesting(false)
    }
}

private struct JarvisWidgetLabels: View {
    let labels: [String]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(labels.indices, id: \.self) { index in
                Text(labels[index])
                    .font(.system(size: 9, weight: index == labels.count - 1 ? .bold : .regular))
                    .foregroundStyle(index == labels.count - 1
                        ? AnyShapeStyle(.primary) : AnyShapeStyle(JarvisWidgetPalette.secondaryText))
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }
}

/// Seven dots for the week: filled when trained, today's one ringed.
struct JarvisWidgetWeekDots: View {
    let trained: [Bool]
    let labels: [String]
    var accessibilityText: String

    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                ForEach(trained.indices, id: \.self) { index in
                    Circle()
                        .fill(trained[index] ? Color.orange : Color.secondary.opacity(0.3))
                        .frame(width: 10, height: 10)
                        .overlay {
                            if index == trained.count - 1 {
                                Circle().strokeBorder(Color.primary, lineWidth: 1.5).padding(-3)
                            }
                        }
                        .widgetAccentable(trained[index])
                        .frame(maxWidth: .infinity)
                }
            }
            JarvisWidgetLabels(labels: labels)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

/// The single steps ring in the Gym medium widget.
struct JarvisWidgetStepsRing: View {
    let steps: Int
    let goal: Int
    let language: JarvisAppLanguage

    var body: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.25), lineWidth: 8)
            Circle()
                .trim(from: 0, to: goal > 0 ? min(Double(steps) / Double(goal), 1) : 0)
                .stroke(Color.orange, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
            VStack(spacing: 0) {
                Text(JarvisWidgetFormat.count(steps, language: language))
                    .font(.title3.weight(.bold))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(JarvisWidgetFormat.ofGoal(goal, language: language))
                    .font(.system(size: 9))
                    .foregroundStyle(JarvisWidgetPalette.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .padding(10)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(JarvisWidgetCopy.steps.text(language: language)) \(steps) \(JarvisWidgetFormat.ofGoal(goal, language: language))"
        )
    }
}

extension View {
    func jarvisWidgetStaleAppearance(_ isStale: Bool) -> some View {
        modifier(JarvisWidgetStaleAppearance(isStale: isStale))
    }

    /// One shared widget surface: the system background in full colour, removed by Liquid Glass and tinted modes.
    func jarvisWidgetSurface() -> some View {
        containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    }
}
