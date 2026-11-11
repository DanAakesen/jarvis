import JarvisCore
import SwiftUI
import WidgetKit

struct WatchEntry: TimelineEntry {
    var date: Date
    var health: WatchHealthSnapshot?
    var current: Bool
    var dashboard: WatchDashboardSnapshot? = nil
    var dashboardStale = false
}

struct WatchMacroBar: View {
    let label: String
    let consumed: Double?
    let goal: Double?
    var compact = false
    var partial = false
    private var validConsumed: Double? { consumed.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil } }
    private var validGoal: Double? { goal.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } }
    private var nutritionAccessibilityValue: String {
        guard let consumed = validConsumed else { return "Unavailable" }
        let amount: String = "\(consumed.formatted()) grams"
        let goalDescription: String
        if let goal = validGoal {
            goalDescription = " of \(goal.formatted()) grams"
        } else {
            goalDescription = ", goal unavailable"
        }
        let prefix: String = partial ? "At least " : ""
        let caveat: String = partial ? ", lower-bound intake: some logged meals are missing this nutrient" : ""
        return prefix + amount + goalDescription + caveat
    }
    var body: some View {
        HStack(spacing: compact ? 4 : 7) {
            Text(label + (partial ? "*" : "")).font(.system(size: compact ? 10 : 12, weight: .semibold, design: .rounded))
                .frame(width: compact ? 31 : 39, alignment: .leading)
            if let consumed = validConsumed {
                if let validGoal {
                    GeometryReader { proxy in
                        let count = compact ? 16 : 20
                        let gap: CGFloat = 2
                        let width = max(0, (proxy.size.width - gap * CGFloat(count - 1)) / CGFloat(count))
                        let fraction = min(1, max(0, consumed / validGoal))
                        HStack(spacing: gap) {
                            ForEach(0..<count, id: \.self) { index in
                                let fill = min(1, max(0, fraction * Double(count) - Double(index)))
                                RoundedRectangle(cornerRadius: 1)
                                    .fill(.white.opacity(0.18))
                                    .overlay(alignment: .leading) {
                                        RoundedRectangle(cornerRadius: 1).fill(WatchStyle.amber)
                                            .frame(width: width * CGFloat(fill))
                                    }
                                    .frame(width: width)
                            }
                        }
                    }.frame(height: compact ? 9 : 13)
                } else {
                    Text("No goal").font(.caption2).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                Text("\(partial ? "≥" : "")\((partial ? floor(consumed) : consumed).formatted(.number.precision(.fractionLength(0))))g")
                    .font(.system(size: compact ? 10 : 12, weight: .medium, design: .rounded))
                    .lineLimit(1).minimumScaleFactor(0.7)
            } else {
                Text("—").foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label == "CARB" ? "Carbohydrates" : label == "PROT" ? "Protein" : "Fat")
        .accessibilityValue(nutritionAccessibilityValue)
    }
}

struct WatchBriefText: View {
    let text: String
    let highlightedTerms: [String]
    var lines: Int? = 4
    var compact = false
    private var phrase: AttributedString {
        var result = AttributedString(text)
        result.foregroundColor = .white
        for term in highlightedTerms where !term.isEmpty {
            if let range = result.range(of: term, options: [.caseInsensitive]) {
                result[range].foregroundColor = WatchStyle.amber
            }
        }
        return result
    }
    var body: some View {
        Text(phrase).font(compact ? .system(size: 14, weight: .medium, design: .rounded) : .system(.body, design: .rounded, weight: .medium))
            .lineLimit(lines).frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct WatchTaskPreviewRows: View {
    let titles: [String]
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 5 : 8) {
            ForEach(Array(titles.enumerated()), id: \.offset) { _, title in
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Image(systemName: "square").font(.system(size: compact ? 10 : 12, weight: .medium))
                        .foregroundStyle(WatchStyle.amber).accessibilityHidden(true)
                    Text(title).font(.system(size: compact ? 12 : 14, weight: .medium, design: .rounded))
                        .foregroundStyle(.white).lineLimit(compact ? 1 : 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

struct WatchBodyFatChart: View {
    let dates: [Date]
    let percentages: [Double]
    var showDates = true
    var compact = false
    private var values: [Double] { percentages.filter { $0.isFinite && (0...100).contains($0) } }
    private var lower: Double { max(0, floor(((values.min() ?? 0) - 1) / 5) * 5) }
    private var upper: Double { min(100, max(lower + 5, ceil(((values.max() ?? 0) + 1) / 5) * 5)) }
    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(percent(upper))
                    Spacer(minLength: 0)
                    if !compact {
                        Text(percent((lower + upper) / 2))
                        Spacer(minLength: 0)
                    }
                    Text(percent(lower))
                }.font(.system(size: 9, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
                Canvas { context, size in
                    let inset: CGFloat = 3
                    let width = max(0, size.width - 2 * inset)
                    let height = max(0, size.height - 2 * inset)
                    for fraction in [CGFloat(0), 0.5, 1] {
                        let y = inset + height * fraction
                        var guide = Path()
                        guide.move(to: CGPoint(x: inset, y: y))
                        guide.addLine(to: CGPoint(x: inset + width, y: y))
                        context.stroke(guide, with: .color(.white.opacity(0.28)),
                                       style: StrokeStyle(lineWidth: 0.6, dash: [3, 3]))
                    }

                    guard !values.isEmpty, dates.count == percentages.count, values.count == percentages.count else { return }
                    let start = dates.first?.timeIntervalSince1970 ?? 0
                    let interval = (dates.last?.timeIntervalSince1970 ?? start) - start
                    let points = zip(dates, values).map { date, value in
                        CGPoint(x: inset + width * CGFloat(interval > 0 ? (date.timeIntervalSince1970 - start) / interval : 0.5),
                                y: inset + height * CGFloat(1 - (value - lower) / (upper - lower)))
                    }
                    var line = Path()
                    guard let first = points.first, let last = points.last else { return }
                    line.move(to: first)
                    points.dropFirst().forEach { line.addLine(to: $0) }
                    if points.count > 1 {
                        var area = line
                        area.addLine(to: CGPoint(x: last.x, y: inset + height))
                        area.addLine(to: CGPoint(x: first.x, y: inset + height))
                        area.closeSubpath()
                        context.fill(area, with: .linearGradient(
                            Gradient(colors: [WatchStyle.amber.opacity(0.28), .clear]),
                            startPoint: CGPoint(x: 0, y: inset), endPoint: CGPoint(x: 0, y: inset + height)))
                    }
                    context.stroke(line, with: .color(WatchStyle.amber),
                                   style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    for point in points {
                        context.fill(Path(ellipseIn: CGRect(x: point.x - 1.7, y: point.y - 1.7, width: 3.4, height: 3.4)),
                                     with: .color(.white))
                    }
                }
            }
            if showDates, let first = dates.first, let last = dates.last {
                HStack {
                    Text(first, format: .dateTime.month(.abbreviated).day())
                    Spacer()
                    if first != last { Text(last, format: .dateTime.month(.abbreviated).day()) }
                }.font(compact ? .system(size: 9, weight: .medium, design: .rounded) : .caption2).foregroundStyle(.secondary)
            }
        }.accessibilityHidden(true)
    }
    private func percent(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1))) + "%"
    }
}
enum WatchDashboardFormatting {
    static func day(_ value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(value.prefix(10)))
    }
    static func percentage(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1))) + "%"
    }
    static func isPartialNutrient(_ label: String, in names: [String]) -> Bool {
        let aliases: Set<String>
        switch label {
        case "CARB": aliases = ["carbohydrate_grams", "carbohydrates_grams", "carbohydrates", "carbs"]
        case "PROT": aliases = ["protein_grams", "protein"]
        default: aliases = ["fat_grams", "fat"]
        }
        return names.contains { aliases.contains($0.lowercased()) }
    }
}

struct WatchComplicationUnavailable: View {
    let title: String
    let message: String
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(.caption, design: .rounded, weight: .semibold))
            Text(message).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct WatchNutritionComplicationView: View {
    let entry: WatchEntry
    var body: some View {
        if let nutrition = entry.dashboard?.nutrition {
            VStack(alignment: .leading, spacing: 5) {
                WatchMacroBar(label: "CARB", consumed: nutrition.carbsGrams, goal: nutrition.carbsGoalGrams, compact: true,
                              partial: WatchDashboardFormatting.isPartialNutrient("CARB", in: nutrition.partialNutrients))
                WatchMacroBar(label: "FAT", consumed: nutrition.fatGrams, goal: nutrition.fatGoalGrams, compact: true,
                              partial: WatchDashboardFormatting.isPartialNutrient("FAT", in: nutrition.partialNutrients))
                WatchMacroBar(label: "PROT", consumed: nutrition.proteinGrams, goal: nutrition.proteinGoalGrams, compact: true,
                              partial: WatchDashboardFormatting.isPartialNutrient("PROT", in: nutrition.partialNutrients))
                if !nutrition.partialNutrients.isEmpty {
                    Text("* Lower-bound intake").font(.system(size: 9)).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
            WatchComplicationUnavailable(title: "Nutrition", message: entry.dashboardStale ? "Data expired. Open Jarvis on iPhone" : "Open Jarvis on iPhone")
        }
    }
}

struct WatchHomeComplicationView: View {
    let entry: WatchEntry
    var body: some View {
        if let brief = entry.dashboard?.brief, brief.isCurrent(at: entry.date), !brief.text.isEmpty {
            WatchBriefText(text: brief.text, highlightedTerms: brief.highlights, lines: 4, compact: true)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .accessibilityLabel(brief.text)
        } else {
            WatchComplicationUnavailable(title: "Home", message: entry.dashboardStale || entry.dashboard?.brief != nil
                                         ? "Brief expired. Open Jarvis on iPhone" : "Open Jarvis on iPhone for your brief")
        }
    }
}

struct WatchTasksComplicationView: View {
    let entry: WatchEntry
    var body: some View {
        if let preview = entry.dashboard?.todayTasks {
            if preview.totalCount == 0 {
                WatchComplicationUnavailable(title: "Tasks", message: "No tasks due today")
            } else if preview.tasks.isEmpty {
                WatchComplicationUnavailable(title: "Tasks", message: "Open to see \(preview.totalCount) tasks")
            } else {
                WatchTaskPreviewRows(titles: Array(preview.tasks.prefix(3)).map(\.text), compact: true)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .accessibilityLabel("\(preview.totalCount) tasks today, including overdue. " + preview.tasks.prefix(3).map(\.text).joined(separator: ". "))
            }
        } else if entry.current, let count = entry.health?.tasksToday {
            WatchComplicationUnavailable(title: "Tasks", message: count == 0 ? "No tasks due today" : "\(count) today. Open for task titles")
        } else {
            WatchComplicationUnavailable(title: "Tasks", message: entry.dashboardStale ? "Data expired. Open Jarvis on iPhone" : "Open Jarvis on iPhone")
        }
    }
}

struct WatchBodyFatComplicationView: View {
    let entry: WatchEntry
    private var points: [WatchBodyFatPoint] { entry.dashboard?.bodyFat ?? [] }
    var body: some View {
        if let latest = points.last {
            GeometryReader { proxy in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Body Fat").font(.system(size: 12, weight: .semibold, design: .rounded))
                        Spacer(minLength: 3)
                        Text(WatchDashboardFormatting.percentage(latest.percent))
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                    WatchBodyFatChart(dates: points.compactMap { WatchDashboardFormatting.day($0.date) },
                                      percentages: points.map(\.percent), showDates: true, compact: proxy.size.height < 76)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Body fat \(WatchDashboardFormatting.percentage(latest.percent)), measured \(latest.date). \(points.count) measurements, from \(points.first?.date ?? latest.date) to \(latest.date).")
        } else {
            WatchComplicationUnavailable(title: "Body Fat", message: entry.dashboardStale
                                         ? "Data expired. Open Jarvis on iPhone"
                                         : entry.dashboard?.bodyFat == nil ? "Open Jarvis on iPhone" : "No measurements")
        }
    }
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
