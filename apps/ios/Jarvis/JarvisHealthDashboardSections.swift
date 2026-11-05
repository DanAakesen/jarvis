import Charts
import Foundation
import JarvisCore
import SwiftUI

struct JarvisHealthRingsSection<Accessory: View>: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let language: JarvisAppLanguage
    let accessory: Accessory
    var fillsHeight = false

    init(
        data: JarvisHealthDashboardData,
        period: JarvisHealthPeriod,
        language: JarvisAppLanguage,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.data = data
        self.period = period
        self.language = language
        self.accessory = accessory()
    }

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        JarvisPageHeroCard(title: copy.text(.training), accessory: { accessory }) {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.healthSectionSpacing) {
                HStack(spacing: JarvisDesignTokens.healthSectionSpacing) {
                    workoutDonut
                    VStack(spacing: JarvisDesignTokens.healthRowSpacing) {
                        workoutLegend(.gym, title: .gym, tint: JarvisDesignTokens.healthAccent)
                        workoutLegend(.run, title: .run, tint: JarvisDesignTokens.healthAccentSecondary)
                    }
                }
                Divider()
                HStack(alignment: .top, spacing: JarvisDesignTokens.healthSectionSpacing) {
                    trainingStat(stepCount.map { formatNumber($0, language: language) } ?? "—", title: .steps)
                    Divider()
                    trainingStat(activeSeconds.map { formatDuration($0, language: language) } ?? "—", title: .activeTime)
                }
                .fixedSize(horizontal: false, vertical: true)
                JarvisHealthBarChart(
                    values: JarvisHealthChartValues(values: stepDays, endingOn: period.endDate,
                        count: max(period.dayCount, 7), target: data.trainingTargets?.targets.dailySteps),
                    unit: copy.text(.steps), title: copy.text(.steps), identifier: "health.chart.steps",
                    language: language, format: { formatNumber($0, language: language) }
                )
            }
        }
        .fillingHeight(fillsHeight)
    }

    private var workoutTotal: Double? {
        guard let gym = workoutCount(.gym), let run = workoutCount(.run) else { return nil }
        return gym + run
    }

    private var totalTarget: Double? {
        guard let gym = target(.gym), let run = target(.run) else { return nil }
        return gym + run
    }

    private func target(_ kind: JarvisHealthLogic.WorkoutKind) -> Double? {
        JarvisHealthLogic.scaledWeeklyTarget(kind == .gym
            ? data.trainingTargets?.targets.gymSessionsPerWeek : data.trainingTargets?.targets.runSessionsPerWeek,
            days: period.dayCount)
    }

    private var workoutDonut: some View {
        let gym = workoutCount(.gym) ?? 0
        let run = workoutCount(.run) ?? 0
        let remaining = max((totalTarget ?? gym + run) - gym - run, 0)
        return Chart {
            SectorMark(angle: .value("Gym", gym), innerRadius: .ratio(JarvisDesignTokens.healthDonutInnerRatio))
                .foregroundStyle(JarvisDesignTokens.healthAccent)
            SectorMark(angle: .value("Run", run), innerRadius: .ratio(JarvisDesignTokens.healthDonutInnerRatio))
                .foregroundStyle(JarvisDesignTokens.healthAccentSecondary)
            SectorMark(angle: .value("Remaining", gym + run + remaining == 0 ? 1 : remaining), innerRadius: .ratio(JarvisDesignTokens.healthDonutInnerRatio))
                .foregroundStyle(Color.secondary.opacity(0.2))
        }
        .chartLegend(.hidden)
        .frame(width: JarvisDesignTokens.healthHeroRingSize, height: JarvisDesignTokens.healthHeroRingSize)
        .overlay {
            VStack(spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                Text(workoutTotal.map { formatNumber($0, language: language) } ?? "—").font(.title.weight(.semibold))
                Text(totalTarget.map { String(format: copy.text(.totalTarget), formatNumber($0, language: language)) }
                    ?? copy.text(.noTarget)).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(copy.text(.training))
        .accessibilityValue(workoutTotal.map { formatNumber($0, language: language) } ?? copy.text(.unavailable))
        .accessibilityIdentifier("health.training.donut")
    }

    private func workoutLegend(_ kind: JarvisHealthLogic.WorkoutKind, title: JarvisHealthLocalizationKey, tint: Color) -> some View {
        HStack {
            Circle().fill(tint).frame(width: JarvisDesignTokens.healthLegendDotSize, height: JarvisDesignTokens.healthLegendDotSize).accessibilityHidden(true)
            Text(copy.text(title)).font(.subheadline)
            Spacer(minLength: 0)
            Text("\(workoutCount(kind).map { formatNumber($0, language: language) } ?? "—") / \(target(kind).map { formatNumber($0, language: language) } ?? "—")")
                .font(.subheadline.weight(.semibold))
        }
        .accessibilityElement(children: .combine)
    }

    private func trainingStat(_ value: String, title: JarvisHealthLocalizationKey) -> some View {
        VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
            Text(value).font(.title2.weight(.semibold))
            Text(copy.text(title)).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var stepDays: [String: Double] {
        data.steps.items.reduce(into: [:]) { days, row in
            if row["unit"]?.stringValue == "count", let day = date(row["metric_date"]), let value = row["value"]?.numberValue {
                days[day] = value
            }
        }
    }

    private var activeSeconds: Double? {
        if data.workouts.state == .empty { return 0 }
        let values = data.workouts.items.filter {
            guard let day = date($0["workout_date"]) ?? date($0["start_at"]) else { return false }
            return day >= period.startDate && day <= period.endDate
        }.compactMap { $0["duration_seconds"]?.numberValue }
        return values.isEmpty ? nil : values.reduce(0, +)
    }

    private var scaledStepsTarget: Double? {
        guard let target = data.trainingTargets?.targets.dailySteps else { return nil }
        return target * Double(period.dayCount)
    }

    func phraseInput(isToday: Bool) -> JarvisHealthPagePhrase.Input {
        JarvisHealthPagePhrase.Input(
            isToday: isToday,
            gymDone: Int(workoutCount(.gym) ?? 0),
            gymTarget: JarvisHealthLogic.scaledWeeklyTarget(data.trainingTargets?.targets.gymSessionsPerWeek, days: period.dayCount),
            steps: stepCount,
            stepsTarget: scaledStepsTarget
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

extension JarvisHealthRingsSection {
    func fillingHeight(_ fills: Bool = true) -> Self {
        var copy = self
        copy.fillsHeight = fills
        return copy
    }
}

extension JarvisHealthRingsSection where Accessory == EmptyView {
    init(data: JarvisHealthDashboardData, period: JarvisHealthPeriod, language: JarvisAppLanguage) {
        self.init(data: data, period: period, language: language) { EmptyView() }
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
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            JarvisSectionHeadline(copy.text(.recentSessions))
            JarvisRowGroup {
                if read.state == .loading {
                    JarvisHealthStateLine(state: .loading, language: language).jarvisListRow(separator: false)
                } else if read.state == .notServed || read.state == .failed || read.state == .offline {
                    JarvisHealthStateLine(state: read.state, language: language).jarvisListRow(separator: false)
                } else {
                    let sessions = recentSessions
                    if sessions.isEmpty {
                        Text(copy.text(.noSessions))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .jarvisListRow(separator: false)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(sessions.indices, id: \.self) { index in
                                sessionRow(sessions[index]).jarvisListRow(separator: index < sessions.count - 1)
                            }
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
        if let id, row["device_only"]?.booleanValue != true {
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
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
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
            if row["id"]?.stringValue != nil, row["device_only"]?.booleanValue != true {
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
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            JarvisSectionHeadline(copy.text(.bodyTrend)) {
                Text(copy.text(.thirtyDays)).font(.caption).foregroundStyle(.secondary)
            }
            JarvisRowGroup {
                if dashboard.metricCatalog.state == .loading {
                    JarvisHealthStateLine(state: .loading, language: language).jarvisListRow(separator: false)
                } else if dashboard.metricCatalog.state == .notServed ||
                            dashboard.metricCatalog.state == .offline ||
                            dashboard.metricCatalog.state == .failed {
                    JarvisHealthStateLine(state: dashboard.metricCatalog.state, language: language).jarvisListRow(separator: false)
                } else if metrics.isEmpty {
                    Text(copy.text(hasSearch ? .noResults : .empty))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .jarvisListRow(separator: false)
                } else {
                    VStack(spacing: 0) {
                        ForEach(metrics, id: \.metricName) { metric in
                            metricRow(metric).jarvisListRow(separator: metric.metricName != metrics.last?.metricName)
                        }
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
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    Text(copy.text(metric.title))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                    Text(metricValue(trend, read: metric.read))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let day = trend.date {
                        Text(JarvisHealthLocalization.formattedDate(day, language: language))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
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
        case .loading: return copy.text(.loading)
        case .notServed, .failed: return copy.text(.unavailable)
        case .offline: return copy.text(.offline)
        case .available, .empty: return copy.text(.notRecorded)
        }
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
            JarvisSectionHeadline(title)
            VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
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
}

struct JarvisHealthStateLine: View {
    let state: JarvisHealthReadState
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
            if state == .loading {
                JarvisLoadingView()
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
    let date: String?
    let latest: Double?
    let unit: String?
    let values: [Double]
}

func metricTrend(_ read: JarvisHealthRead, period: JarvisHealthPeriod) -> JarvisHealthMetricTrend {
    let rows = read.items.compactMap { row -> (date: String, value: Double, unit: String?)? in
        guard let date = date(row["metric_date"]),
              date >= period.startDate, date <= period.endDate,
              let value = row["value"]?.numberValue ?? row["avg_value"]?.numberValue else {
            return nil
        }
        return (date, value, row["unit"]?.stringValue)
    }
    guard let last = rows.max(by: { $0.date < $1.date }) else {
        return JarvisHealthMetricTrend(date: nil, latest: nil, unit: nil, values: [])
    }
    let sameUnit = rows.filter { $0.unit == last.unit }.sorted { $0.date < $1.date }
    return JarvisHealthMetricTrend(date: last.date, latest: last.value, unit: last.unit, values: sameUnit.map(\.value))
}

func formatNumber(_ value: Double, language: JarvisAppLanguage = .default) -> String {
    JarvisNumberFormat.compact(value, language: language)
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
    JarvisHealthLogic.day(value?.stringValue)
}

func parseDate(_ value: String) -> Date? {
    let input = DateFormatter()
    input.locale = Locale(identifier: "en_US_POSIX")
    input.calendar = Calendar(identifier: .gregorian)
    input.timeZone = TimeZone(secondsFromGMT: 0)
    input.dateFormat = "yyyy-MM-dd"
    return input.date(from: value)
}
