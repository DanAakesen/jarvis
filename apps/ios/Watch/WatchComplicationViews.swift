import JarvisCore
import SwiftUI
import WidgetKit

struct WatchEntry: TimelineEntry {
    var date: Date
    var health: WatchHealthSnapshot?
    var current: Bool
}
struct WatchHealthView: View {
    let entry: WatchEntry
    private var health: WatchHealthSnapshot? { entry.current ? entry.health : nil }
    private func number(_ value: Int?) -> String { value.map { $0.formatted() } ?? "—" }
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(number(health?.steps))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.75).lineLimit(1)
            WatchStepsChart(
                values: health?.steps == nil ? [] : health?.cumulativeSteps ?? [],
                goal: health?.stepGoal
            ).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(health?.steps != nil
            ? "Daily steps \(number(health?.steps)), target \(number(health?.stepGoal))."
            : "Steps unavailable. Open Jarvis on iPhone.")
    }
}
struct WatchStepsChart: View {
    var values: [Int]
    var goal: Int? = nil
    var body: some View {
        Canvas { context, size in
            let plot = WatchStepsPlot(values: values, goal: goal)
            let inset: CGFloat = 1
            let width = max(0, size.width - 2 * inset)
            let height = max(0, size.height - 2 * inset)
            let baseline = inset + height
            if let target = plot.goalHeight {
                var reference = Path()
                let y = baseline - height * target
                reference.move(to: CGPoint(x: inset, y: y))
                reference.addLine(to: CGPoint(x: inset + width, y: y))
                context.stroke(reference, with: .color(.white.opacity(0.55)),
                               style: StrokeStyle(lineWidth: 0.7, dash: [3, 2]))
            }
            guard !plot.values.isEmpty, width > 0, height > 0 else { return }
            let points = plot.values.enumerated().map { index, value in
                CGPoint(x: inset + width * CGFloat(index) / 23,
                        y: baseline - height * value / plot.ceiling)
            }
            // Fine luminous stems follow the measured curve without adding future hours.
            let lastX = points.last?.x ?? inset
            let count = Int(width / 3)
            for index in 0...max(0, count) {
                let x = inset + CGFloat(index) * 3
                guard x <= lastX, let value = plot.height(at: Double((x - inset) / width * 23)) else { continue }
                let y = baseline - height * value
                let rect = CGRect(x: x, y: y, width: 1.8, height: max(0, baseline - y))
                context.fill(Path(roundedRect: rect, cornerRadius: 0.9),
                             with: .linearGradient(
                                Gradient(colors: [WatchStyle.amber, WatchStyle.amber.opacity(0.03)]),
                                startPoint: CGPoint(x: x, y: y), endPoint: CGPoint(x: x, y: baseline)))
            }
            var line = Path()
            if let first = points.first {
                line.move(to: first)
                points.dropFirst().forEach { line.addLine(to: $0) }
                if points.count == 1 {
                    context.fill(Path(ellipseIn: CGRect(x: first.x - 1, y: first.y - 1, width: 2, height: 2)),
                                 with: .color(WatchStyle.amber))
                }
            }
            context.stroke(line, with: .color(WatchStyle.amber),
                           style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
        }.accessibilityHidden(true)
    }
}
