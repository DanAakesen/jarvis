import Charts
import Foundation
import JarvisCore
import SwiftUI

struct JarvisHealthRingsSection: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        JarvisHealthPanel(title: copy.text(.activity)) {
            HStack(alignment: .top, spacing: JarvisDesignTokens.healthRowSpacing) {
                ring(
                    label: copy.text(.gym),
                    value: workoutCount(.gym),
                    target: JarvisHealthLogic.scaledWeeklyTarget(data.trainingTargets?.targets.gymSessionsPerWeek, days: period.dayCount),
                    tint: JarvisDesignTokens.healthAccent,
                    state: data.workouts.state,
                    failure: data.trainingTargetFailure
                )
                ring(
                    label: copy.text(.run),
                    value: workoutCount(.run),
                    target: JarvisHealthLogic.scaledWeeklyTarget(data.trainingTargets?.targets.runSessionsPerWeek, days: period.dayCount),
                    tint: JarvisDesignTokens.healthAccentSecondary,
                    state: data.workouts.state,
                    failure: data.trainingTargetFailure
                )
                ring(
                    label: copy.text(.steps),
                    value: stepCount,
                    target: scaledStepsTarget,
                    tint: .secondary,
                    state: data.steps.state,
                    failure: data.trainingTargetFailure
                )
            }
        }
    }

    private func ring(
        label: String,
        value: Double?,
        target: Double?,
        tint: Color,
        state: JarvisHealthReadState,
        failure: JarvisHealthFailure?
    ) -> some View {
        JarvisHealthRing(
            label: label,
            value: state == .available || state == .empty ? value : nil,
            target: state == .available || state == .empty ? target : nil,
            tint: tint,
            caption: targetCaption(target, failure: failure),
            unavailable: state == .notServed || state == .failed || state == .offline
                ? copy.text(.unavailable)
                : nil,
            language: language
        )
    }

    private var scaledStepsTarget: Double? {
        guard let target = data.trainingTargets?.targets.dailySteps else { return nil }
        return target * Double(period.dayCount)
    }

    private func targetCaption(_ target: Double?, failure: JarvisHealthFailure?) -> String {
        if let failure { return failure.title(language: language) }
        guard let target else { return copy.text(.noTarget) }
        return String(
            format: copy.text(.target),
            locale: language.locale,
            formatNumber(target, language: language)
        )
    }

    private var stepCount: Double? {
        guard data.steps.state == .available else { return nil }
        let rows = data.steps.items.filter {
            date($0["metric_date"]).map { $0 >= period.startDate && $0 <= period.endDate } == true &&
                $0["unit"]?.stringValue == "count"
        }
        guard !rows.isEmpty else { return nil }
        return rows.compactMap { $0["value"]?.numberValue }.reduce(0, +)
    }

    private func workoutCount(_ kind: JarvisHealthLogic.WorkoutKind) -> Double? {
        guard data.workouts.state == .available || data.workouts.state == .empty else { return nil }
        return Double(data.workouts.items.filter { row in
            let date = date(row["workout_date"]) ?? date(row["start_at"])
            guard let date, date >= period.startDate, date <= period.endDate else { return false }
            return JarvisHealthLogic.workoutKind(row["workout_type"]?.stringValue) == kind
        }.count)
    }
}

struct JarvisHealthRing: View {
    let label: String
    let value: Double?
    let target: Double?
    let tint: Color
    let caption: String
    let unavailable: String?
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private var progress: Double? { JarvisHealthLogic.ringProgress(value: value, target: target) }
    private var number: String { value.map { formatNumber($0, language: language) } ?? "—" }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
            ZStack {
                Circle()
                    .stroke(.quaternary, lineWidth: JarvisDesignTokens.healthRingStroke)
                if let progress {
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(
                            tint,
                            style: StrokeStyle(
                                lineWidth: JarvisDesignTokens.healthRingStroke,
                                lineCap: .round
                            )
                        )
                        .rotationEffect(.degrees(-90))
                }
                Text(number)
                    .font(.subheadline.weight(.semibold))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            }
            .frame(width: JarvisDesignTokens.healthRingSize, height: JarvisDesignTokens.healthRingSize)
            Text(label)
                .font(.caption.weight(.medium))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(unavailable ?? caption)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        guard let value else { return unavailable ?? copy.text(.notRecorded) }
        return "\(formatNumber(value, language: language)), \(caption)"
    }
}

struct JarvisHealthSummarySection: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let periodPreset: JarvisHealthPeriodPreset
    let client: JarvisHealthClient?
    let language: JarvisAppLanguage
    let isToday: Bool
    let now: Date

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        JarvisHealthPanel(title: copy.period(periodPreset)) {
            HStack(alignment: .top, spacing: JarvisDesignTokens.healthRowSpacing) {
                summaryValue(
                    label: copy.text(.proteinLeft),
                    amount: balance(for: "protein_grams", target: data.nutritionTargets?.targets.proteinGrams),
                    unit: "g",
                    missing: data.nutritionTargets?.targets.proteinGrams == nil ? copy.text(.noTarget) : nil,
                    destination: .meals(period)
                )
                summaryValue(
                    label: copy.text(.caloriesLeft),
                    amount: calorieBalance,
                    unit: "kcal",
                    missing: data.nutritionTargets?.targets.restingKcal == nil ||
                        data.nutritionTargets?.targets.deficitKcal == nil ? copy.text(.noTarget) : nil,
                    destination: .meals(period)
                )
                sleepValue
            }
        }
    }

    private func summaryValue(
        label: String,
        amount: JarvisHealthBalance?,
        unit: String,
        missing: String? = nil,
        destination: JarvisHealthDetailKind
    ) -> some View {
        NavigationLink {
            JarvisHealthDetailView(
                client: client,
                capabilities: data.capabilities,
                kind: destination,
                language: language
            )
        } label: {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(amount.map { $0.text(unit, language: language) } ?? missing ?? copy.text(.notRecorded))
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                if period.dayCount > 1 {
                    Text(copy.text(.averagePerDay))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.healthControlHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }

    private var sleepValue: some View {
        let sleep = sleepAverage
        return Group {
            if let sleep {
                NavigationLink {
                    JarvisHealthDetailView(
                        client: client,
                        capabilities: data.capabilities,
                        kind: .sleep(sleep.date, dayPeriod(sleep.date)),
                        language: language
                    )
                } label: {
                    sleepLabel(sleep.hours)
                }
                .buttonStyle(.plain)
            } else {
                sleepLabel(nil)
            }
        }
    }

    private func sleepLabel(_ hours: Double?) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
            Text(copy.text(.sleep))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(hours.map {
                "\(formatNumber($0, language: language)) \(copy.text(.hourShort))"
            } ?? copy.text(.notRecorded))
                .font(.headline)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if period.dayCount > 1 {
                Text(copy.text(.averagePerDay))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.healthControlHeight, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var calorieBalance: JarvisHealthBalance? {
        let energy = averageNutrient("energy_kcal")
        guard let target = data.nutritionTargets?.targets,
              let balance = JarvisHealthLogic.calorieBalance(
                eaten: energy.value,
                restingKcal: target.restingKcal,
                deficitKcal: target.deficitKcal
              ) else {
            return nil
        }
        return JarvisHealthBalance(amount: balance.amount, isOver: balance.isOver, isPartial: energy.partial)
    }

    private func balance(for key: String, target: Double?) -> JarvisHealthBalance? {
        let nutrient = averageNutrient(key)
        guard let eaten = nutrient.value, let target else { return nil }
        let difference = target - eaten
        return JarvisHealthBalance(
            amount: abs(difference),
            isOver: difference < 0,
            isPartial: nutrient.partial
        )
    }

    private func averageNutrient(_ key: String) -> (value: Double?, partial: Bool) {
        let rows = data.nutritionDays.items.filter {
            ($0["meal_date"]?.stringValue ?? "") >= period.startDate &&
                ($0["meal_date"]?.stringValue ?? "") <= period.endDate &&
                ($0["meal_count"]?.numberValue ?? 0) > 0
        }
        guard !rows.isEmpty else { return (nil, false) }
        let known = rows.compactMap { $0[key]?.numberValue }
        let partial = known.count < rows.count || rows.count < period.dayCount || rows.contains {
            $0["partial_nutrients"]?.arrayValue?.contains(.string(key)) == true
        }
        guard !known.isEmpty else { return (nil, partial) }
        return (known.reduce(0, +) / Double(period.dayCount), partial)
    }

    private var sleepAverage: (hours: Double, date: String)? {
        let rows = data.sleep.items.compactMap { row -> (String, Double)? in
            guard let date = row["sleep_date"]?.stringValue,
                  let hours = row["total_sleep_hours"]?.numberValue ?? row["asleep_hours"]?.numberValue,
                  hours > 0 else { return nil }
            return (date, hours)
        }.filter { $0.0 >= sleepStartDate && $0.0 <= period.endDate }
        guard !rows.isEmpty else { return nil }
        if isToday, let latest = rows.max(by: { $0.0 < $1.0 }) {
            return (latest.1, latest.0)
        }
        let average = rows.map(\.1).reduce(0, +) / Double(rows.count)
        return (average, rows.max(by: { $0.0 < $1.0 })!.0)
    }

    private func dayPeriod(_ date: String) -> JarvisHealthPeriod {
        JarvisHealthPeriod(startDate: date, endDate: date) ?? period
    }

    private var sleepStartDate: String {
        isToday ? JarvisHealthPeriod.make(.yesterday, now: now).startDate : period.startDate
    }
}

struct JarvisHealthBalance {
    let amount: Double
    let isOver: Bool
    let isPartial: Bool

    func text(_ unit: String, language: JarvisAppLanguage) -> String {
        let copy = JarvisHealthCopy(language: language)
        let bound = isPartial ? (isOver ? "≥ " : "≤ ") : ""
        let status = copy.text(isOver ? .over : .left)
        return "\(bound)\(formatNumber(amount, language: language)) \(unit) \(status)"
    }
}

struct JarvisHealthSessionsSection: View {
    let read: JarvisHealthRead
    let period: JarvisHealthPeriod
    let client: JarvisHealthClient?
    let capabilities: JarvisHealthCapabilities?
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        JarvisHealthPanel(title: copy.text(.recentSessions)) {
            if read.state == .loading {
                JarvisHealthStateLine(state: .loading, language: language)
            } else if read.state == .notServed || read.state == .failed || read.state == .offline {
                JarvisHealthStateLine(state: read.state, language: language)
            } else {
                let sessions = recentSessions
                if sessions.isEmpty {
                    Text(copy.text(.noSessions))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    VStack(spacing: JarvisDesignTokens.healthRowSpacing) {
                        ForEach(sessions.indices, id: \.self) { index in
                            sessionRow(sessions[index])
                        }
                    }
                }
            }
        }
    }

    private var recentSessions: [[String: JSONValue]] {
        read.items.filter { row in
            let day = date(row["workout_date"]) ?? date(row["start_at"])
            return day.map { $0 >= period.startDate && $0 <= period.endDate } == true
        }
        .sorted {
            (date($0["workout_date"]) ?? date($0["start_at"]) ?? "") >
                (date($1["workout_date"]) ?? date($1["start_at"]) ?? "")
        }
        .prefix(3)
        .map { $0 }
    }

    @ViewBuilder
    private func sessionRow(_ row: [String: JSONValue]) -> some View {
        let id = row["id"]?.stringValue
        let title = sessionTitle(row["workout_type"]?.stringValue)
        let dateText = date(row["workout_date"]) ?? date(row["start_at"]) ?? copy.text(.notRecorded)
        if let id {
            NavigationLink {
                JarvisHealthDetailView(
                    client: client,
                    capabilities: capabilities,
                    kind: .workout(id, row),
                    language: language
                )
            } label: {
                sessionLabel(title: title, date: dateText, row: row)
            }
            .buttonStyle(.plain)
        } else {
            sessionLabel(title: title, date: dateText, row: row)
        }
    }

    private func sessionLabel(title: String, date: String, row: [String: JSONValue]) -> some View {
        HStack(spacing: JarvisDesignTokens.healthRowSpacing) {
            Image(systemName: sessionSymbol(row["workout_type"]?.stringValue))
                .foregroundStyle(JarvisDesignTokens.healthAccent)
                .frame(width: JarvisDesignTokens.healthControlHeight)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                Text(JarvisHealthLocalization.formattedDate(date, language: language))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let duration = row["duration_seconds"]?.numberValue, duration >= 0 {
                Text(formatDuration(duration, language: language))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if row["id"]?.stringValue != nil {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: JarvisDesignTokens.healthControlHeight)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func sessionTitle(_ raw: String?) -> String {
        switch JarvisHealthLogic.workoutKind(raw) {
        case .gym: copy.text(.gym)
        case .run: copy.text(.run)
        case .other: copy.text(.workout)
        }
    }

    private func sessionSymbol(_ raw: String?) -> String {
        switch JarvisHealthLogic.workoutKind(raw) {
        case .gym: "figure.strengthtraining.traditional"
        case .run: "figure.run"
        case .other: "figure.mixed.cardio"
        }
    }
}

struct JarvisHealthBodySection: View {
    let metrics: [JarvisHealthMetricSeries]
    let dashboard: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let client: JarvisHealthClient?
    let language: JarvisAppLanguage
    let hasSearch: Bool

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        JarvisHealthPanel(title: copy.text(.bodyTrend)) {
            if dashboard.metricCatalog.state == .loading {
                JarvisHealthStateLine(state: .loading, language: language)
            } else if dashboard.metricCatalog.state == .notServed ||
                        dashboard.metricCatalog.state == .offline ||
                        dashboard.metricCatalog.state == .failed {
                JarvisHealthStateLine(state: dashboard.metricCatalog.state, language: language)
            } else if metrics.isEmpty {
                Text(copy.text(hasSearch ? .noResults : .empty))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: JarvisDesignTokens.healthRowSpacing) {
                    ForEach(metrics, id: \.metricName) { metric in
                        metricRow(metric)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func metricRow(_ metric: JarvisHealthMetricSeries) -> some View {
        let trend = metricTrend(metric.read, period: period)
        NavigationLink {
            JarvisHealthDetailView(
                client: client,
                capabilities: dashboard.capabilities,
                kind: .metric(metric.metricName, metric.title, period),
                language: language
            )
        } label: {
            HStack(spacing: JarvisDesignTokens.healthRowSpacing) {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
                    Text(copy.text(metric.title))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                    Text(metricValue(trend, read: metric.read))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if trend.values.count > 1 {
                    JarvisHealthSparkline(values: trend.values)
                        .frame(
                            width: JarvisDesignTokens.healthSparklineWidth,
                            height: JarvisDesignTokens.healthSparklineHeight
                        )
                        .accessibilityHidden(true)
                }
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: JarvisDesignTokens.healthControlHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }

    private func metricValue(_ trend: JarvisHealthMetricTrend, read: JarvisHealthRead) -> String {
        if let latest = trend.latest {
            return "\(formatNumber(latest, language: language)) \(trend.unit ?? "")"
        }
        switch read.state {
        case .loading: copy.text(.loading)
        case .notServed, .failed: copy.text(.unavailable)
        case .offline: copy.text(.offline)
        case .available, .empty: copy.text(.notRecorded)
        }
    }
}

struct JarvisHealthNutritionSection: View {
    let read: JarvisHealthRead
    let targets: JarvisNutritionTargets?
    let targetFailure: JarvisHealthFailure?
    let period: JarvisHealthPeriod
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        JarvisHealthPanel(title: copy.text(.nutrition)) {
            if read.state == .loading {
                JarvisHealthStateLine(state: .loading, language: language)
            } else if read.state == .notServed || read.state == .failed || read.state == .offline {
                JarvisHealthStateLine(state: read.state, language: language)
            } else if proteinPoints.isEmpty {
                Text(copy.text(.empty))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Chart {
                    ForEach(proteinPoints) { point in
                        BarMark(
                            x: .value(copy.text(.date), point.date),
                            y: .value(copy.text(.proteinChart), point.value)
                        )
                        .foregroundStyle(JarvisDesignTokens.healthAccent)
                        .annotation(position: .top) {
                            if point.isPartial {
                                Text("≤")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    if let target = targets?.targets.proteinGrams {
                        RuleMark(y: .value(copy.text(.target), target))
                            .lineStyle(StrokeStyle(
                                lineWidth: JarvisDesignTokens.healthTargetLineWidth,
                                dash: JarvisDesignTokens.healthTargetLineDash
                            ))
                            .foregroundStyle(JarvisDesignTokens.healthAccentSecondary)
                    }
                }
                .chartLegend(.hidden)
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisValueLabel()
                    }
                }
                .frame(height: JarvisDesignTokens.healthChartHeight)
                .accessibilityLabel(copy.text(.proteinChart))
                .accessibilityValue(chartSummary)
                if let failure = targetFailure {
                    Text(failure.title(language: language))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if targets?.targets.proteinGrams == nil {
                    Text(copy.text(.noTarget))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var proteinPoints: [JarvisHealthChartPoint] {
        read.items.compactMap { row in
            guard let date = row["meal_date"]?.stringValue,
                  date >= period.startDate, date <= period.endDate,
                  (row["meal_count"]?.numberValue ?? 0) > 0,
                  let value = row["protein_grams"]?.numberValue,
                  let parsedDate = parseDate(date) else {
                return nil
            }
            let partial = row["partial_nutrients"]?.arrayValue?.contains(.string("protein_grams")) == true
            return JarvisHealthChartPoint(date: parsedDate, value: value, isPartial: partial)
        }
        .sorted { $0.date < $1.date }
    }

    private var chartSummary: String {
        let values = proteinPoints.map {
            "\($0.isPartial ? "≤ " : "")\(formatNumber($0.value, language: language))"
        }
        guard !values.isEmpty else { return copy.text(.empty) }
        let target = targets?.targets.proteinGrams.map { "\(copy.text(.targetLabel)) \(formatNumber($0, language: language)) g" }
        return ([target] + [values.joined(separator: ", ")]).compactMap { $0 }.joined(separator: ". ")
    }
}

struct JarvisHealthPanel<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.primary)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(JarvisDesignTokens.healthSectionSpacing)
        .background(
            .regularMaterial,
            in: RoundedRectangle(cornerRadius: JarvisDesignTokens.healthPanelRadius, style: .continuous)
        )
    }
}

struct JarvisHealthStateLine: View {
    let state: JarvisHealthReadState
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
            if state == .loading {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
            } else if state == .offline {
                Image(systemName: "wifi.slash")
                    .accessibilityHidden(true)
            } else if state == .failed {
                Image(systemName: "exclamationmark.triangle")
                    .accessibilityHidden(true)
            }
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var label: String {
        switch state {
        case .loading: copy.text(.loading)
        case .available: copy.text(.fresh)
        case .empty: copy.text(.empty)
        case .notServed, .failed: copy.text(.unavailable)
        case .offline: copy.text(.offline)
        }
    }
}

struct JarvisHealthSparkline: View {
    let values: [Double]

    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { index, value in
            LineMark(
                x: .value("Reading", index),
                y: .value("Value", value)
            )
            .foregroundStyle(JarvisDesignTokens.healthAccentSecondary)
            .lineStyle(StrokeStyle(
                lineWidth: JarvisDesignTokens.healthChartLineWidth,
                lineCap: .round,
                lineJoin: .round
            ))
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
    }
}

struct JarvisHealthChartPoint: Identifiable {
    let date: Date
    let value: Double
    var isPartial = false
    var id: Date { date }
}

struct JarvisHealthMetricTrend {
    let latest: Double?
    let unit: String?
    let values: [Double]
}

func metricTrend(_ read: JarvisHealthRead, period: JarvisHealthPeriod) -> JarvisHealthMetricTrend {
    let rows = read.items.compactMap { row -> (date: String, value: Double, unit: String?)? in
        guard let date = date(row["metric_date"]),
              date >= period.startDate, date <= period.endDate,
              let value = row["avg_value"]?.numberValue ?? row["value"]?.numberValue else {
            return nil
        }
        return (date, value, row["unit"]?.stringValue)
    }
    guard let last = rows.max(by: { $0.date < $1.date }) else {
        return JarvisHealthMetricTrend(latest: nil, unit: nil, values: [])
    }
    let sameUnit = rows.filter { $0.unit == last.unit }.sorted { $0.date < $1.date }
    return JarvisHealthMetricTrend(latest: last.value, unit: last.unit, values: sameUnit.map(\.value))
}

func formatNumber(_ value: Double, language: JarvisAppLanguage = .default) -> String {
    value.formatted(.number.locale(language.locale).precision(.fractionLength(0)))
}

func formatDuration(_ seconds: Double, language: JarvisAppLanguage) -> String {
    let totalMinutes = max(Int(seconds / 60), 0)
    let hours = totalMinutes / 60
    let minutes = totalMinutes % 60
    let copy = JarvisHealthCopy(language: language)
    let minuteText = "\(formatNumber(Double(minutes), language: language)) \(copy.text(.minuteShort))"
    guard hours > 0 else { return minuteText }
    return "\(formatNumber(Double(hours), language: language)) \(copy.text(.hourShort)) \(minuteText)"
}

func date(_ value: JSONValue?) -> String? {
    guard let value = value?.stringValue else { return nil }
    if value.count >= 10 {
        let date = String(value.prefix(10))
        if JarvisHealthPeriod(startDate: date, endDate: date) != nil { return date }
    }
    return nil
}

func parseDate(_ value: String) -> Date? {
    let input = DateFormatter()
    input.locale = Locale(identifier: "en_US_POSIX")
    input.calendar = Calendar(identifier: .gregorian)
    input.timeZone = TimeZone(secondsFromGMT: 0)
    input.dateFormat = "yyyy-MM-dd"
    return input.date(from: value)
}
