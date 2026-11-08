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
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .top, spacing: 3) {
                    Text(number(health?.steps)).font(.system(size: 24, weight: .semibold, design: .rounded)).minimumScaleFactor(0.65).lineLimit(1)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("/ \(health?.stepGoal.map { String($0) } ?? "—")")
                        Text("steps")
                    }.font(.system(size: 8)).foregroundStyle(WatchStyle.stone)
                }
                WatchStepsChart(values: health?.cumulativeSteps ?? []).frame(maxHeight: .infinity)
                HStack {
                    Text("00"); Spacer(minLength: 0); Text("06"); Spacer(minLength: 0); Text("12"); Spacer(minLength: 0); Text("18")
                }.font(.system(size: 6)).foregroundStyle(WatchStyle.stone).accessibilityHidden(true)
                HStack(spacing: 2) {
                    Image(systemName: "flame.fill")
                    Text("\(number(health?.dailyKcal)) kcal")
                    Spacer(minLength: 0); Text("Daily").foregroundStyle(WatchStyle.stone)
                }.font(.system(size: 8))
            }.frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 3) {
                goal("dumbbell.fill", value: health?.gym, target: health?.gymGoal, tint: WatchStyle.amber)
                goal("figure.run", value: health?.runs, target: health?.runGoal, tint: WatchStyle.stone)
                HStack(spacing: 2) { Image(systemName: "flame.fill"); Text("\(number(health?.weeklyKcal)) kcal").minimumScaleFactor(0.7).lineLimit(1) }
                    .font(.system(size: 10))
                HStack { Spacer(minLength: 0); Text("Weekly").font(.system(size: 8)).foregroundStyle(WatchStyle.stone) }
            }.frame(width: 64)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.current ? "Daily steps \(number(health?.steps)), active calories \(number(health?.dailyKcal)). Weekly gym \(number(health?.gym)) of \(number(health?.gymGoal)), runs \(number(health?.runs)) of \(number(health?.runGoal)), active calories \(number(health?.weeklyKcal))." : "Health unavailable. Open Jarvis on iPhone.")
    }
    private func goal(_ icon: String, value: Int?, target: Int?, tint: Color) -> some View {
        VStack(spacing: 1) {
            HStack(spacing: 2) { Image(systemName: icon); Spacer(minLength: 0); Text("\(number(value))/\(number(target))") }.font(.system(size: 10))
            GeometryReader { proxy in
                let ratio = target.map { $0 > 0 ? min(1, Double(value ?? 0) / Double($0)) : 0 } ?? 0
                Capsule().fill(.white.opacity(0.12))
                Capsule().fill(tint).frame(width: proxy.size.width * ratio)
            }.frame(height: 3)
        }
    }
}
struct WatchStepsChart: View {
    var values: [Int]
    var body: some View {
        GeometryReader { proxy in
            let points = values.enumerated().map { index, value in
                CGPoint(x: proxy.size.width * CGFloat(index) / 23, y: proxy.size.height * (1 - CGFloat(value) / CGFloat(max(values.max() ?? 1, 1))))
            }
            let line = Path { path in
                if let first = points.first { path.move(to: first); points.dropFirst().forEach { path.addLine(to: $0) } }
            }
            Path { path in
                guard let first = points.first, let last = points.last else { return }
                path.move(to: CGPoint(x: first.x, y: proxy.size.height)); path.addLine(to: first)
                points.dropFirst().forEach { path.addLine(to: $0) }
                path.addLine(to: CGPoint(x: last.x, y: proxy.size.height)); path.closeSubpath()
            }.fill(LinearGradient(colors: [WatchStyle.amber.opacity(0.5), .clear], startPoint: .top, endPoint: .bottom))
            line.stroke(WatchStyle.amber, style: StrokeStyle(lineWidth: 1.3, lineCap: .round, lineJoin: .round))
        }.accessibilityHidden(true)
    }
}

