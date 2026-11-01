import Charts
import Foundation
import JarvisCore
import SwiftUI

enum JarvisHealthDetailKind {
    case workout(String, [String: JSONValue])
    case sleep(String, JarvisHealthPeriod)
    case meals(JarvisHealthPeriod)
    case metric(String, JarvisHealthLocalizationKey, JarvisHealthPeriod)

    func title(language: JarvisAppLanguage) -> String {
        let copy = JarvisHealthCopy(language: language)
        switch self {
        case .workout(_, _): return copy.text(.workout)
        case .sleep: return copy.text(.sleepNight)
        case .meals: return copy.text(.meals)
        case .metric(_, let title, _): return copy.text(title)
        }
    }
}

private struct JarvisHealthDetailData {
    var items: [[String: JSONValue]] = []
    var heartRate: [[String: JSONValue]] = []
    var heartRateUnavailable = false
    var heartRateFailure: JarvisHealthFailure?
}

struct JarvisHealthDetailView: View {
    let client: JarvisHealthClient?
    let capabilities: JarvisHealthCapabilities?
    let kind: JarvisHealthDetailKind
    let language: JarvisAppLanguage

    @State private var data: JarvisHealthDetailData?
    @State private var failure: JarvisHealthFailure?
    @State private var unavailable = false
    @State private var retryVersion = 0
    @State private var loading = false

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        Group {
            if loading && data == nil {
                ProgressView(copy.text(.loading))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let failure {
                ContentUnavailableView {
                    Label(failure.title(language: language), systemImage: failure == .offline ? "wifi.slash" : "exclamationmark.triangle")
                } actions: {
                    Button(copy.text(.retry)) { retryVersion += 1 }
                        .buttonStyle(.glass)
                        .disabled(loading)
                }
            } else if unavailable && !isWorkout {
                ContentUnavailableView(copy.text(.unavailable), systemImage: "heart.text.square")
            } else if let data, data.items.isEmpty, !isWorkout {
                ContentUnavailableView(
                    copy.text(.empty),
                    systemImage: "heart.text.square"
                )
            } else if let data {
                detailList(data)
            }
        }
        .jarvisAmbientBackground()
        .navigationTitle(kind.title(language: language))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .environment(\.locale, language.locale)
        .tint(JarvisDesignTokens.healthAccent)
        .task(id: retryVersion) {
            await load()
        }
    }

    @ViewBuilder
    private func detailList(_ data: JarvisHealthDetailData) -> some View {
        switch kind {
        case .workout(_, let summary):
            workoutList(
                summary,
                detail: data.items.first ?? [:],
                heartRate: data.heartRate,
                heartRateUnavailable: data.heartRateUnavailable,
                heartRateFailure: data.heartRateFailure
            )
        case .sleep:
            sleepList(data.items)
        case .meals:
            mealsList(data.items)
        case .metric:
            metricList(data.items)
        }
    }

    private func workoutList(
        _ row: [String: JSONValue],
        detail: [String: JSONValue],
        heartRate: [[String: JSONValue]],
        heartRateUnavailable: Bool,
        heartRateFailure: JarvisHealthFailure?
    ) -> some View {
        JarvisList {
            Section(copy.text(.workout)) {
                let workoutDate = date(row["workout_date"]) ?? date(row["start_at"])
                healthValue(
                    copy.text(.date),
                    workoutDate.map { JarvisHealthLocalization.formattedDate($0, language: language) } ?? copy.text(.notRecorded)
                )
                if let duration = row["duration_seconds"]?.numberValue, duration >= 0 {
                    healthValue(copy.text(.duration), formatDuration(duration, language: language))
                }
                if let value = row["distance_value"]?.numberValue {
                    healthValue(copy.text(.distance), "\(formatNumber(value, language: language)) \(row["distance_unit"]?.stringValue ?? "")")
                }
                if let value = row["active_energy_value"]?.numberValue {
                    healthValue(copy.text(.energy), "\(formatNumber(value, language: language)) \(row["active_energy_unit"]?.stringValue ?? "")")
                }
                if let value = row["avg_heart_rate"]?.numberValue {
                    healthValue(copy.text(.average) + " " + copy.text(.heartRate), "\(formatNumber(value, language: language)) bpm")
                }
                if let value = row["max_heart_rate"]?.numberValue {
                    healthValue(copy.text(.heartRate), "\(formatNumber(value, language: language)) bpm")
                }
            }
            if let metrics = detail["additionalMetrics"]?.arrayValue, !metrics.isEmpty {
                Section(copy.text(.metricTrend)) {
                    ForEach(Array(metrics.enumerated()), id: \.offset) { _, metric in
                        let fields = metric.objectValue ?? [:]
                        let name = fields["metric_name"]?.stringValue ?? copy.text(.metricTrend)
                        if let value = fields["avg_value"]?.numberValue ?? fields["value"]?.numberValue {
                            healthValue(
                                name,
                                "\(formatNumber(value, language: language)) \(fields["unit"]?.stringValue ?? "")"
                            )
                        }
                    }
                }
            }
            if unavailable {
                Section { Text(copy.text(.unavailable)).foregroundStyle(.secondary) }
            }
            if let heartRateFailure {
                Section(copy.text(.heartRate)) {
                    Label(
                        heartRateFailure.title(language: language),
                        systemImage: heartRateFailure == .offline ? "wifi.slash" : "exclamationmark.triangle"
                    )
                    Button(copy.text(.retry)) { retryVersion += 1 }
                        .buttonStyle(.glass)
                        .tint(JarvisDesignTokens.healthAccent)
                        .disabled(loading)
                }
            } else if heartRateUnavailable || heartRate.isEmpty {
                Section(copy.text(.heartRate)) {
                    Text(copy.text(heartRateUnavailable ? .unavailable : .empty))
                        .foregroundStyle(.secondary)
                }
            } else {
                Section(copy.text(.heartRate)) {
                    Chart(heartRatePoints(heartRate)) { point in
                        LineMark(
                            x: .value(copy.text(.date), point.date),
                            y: .value(copy.text(.heartRate), point.value)
                        )
                        .foregroundStyle(JarvisDesignTokens.healthAccentSecondary)
                    }
                    .frame(height: JarvisDesignTokens.healthChartHeight)
                    .accessibilityLabel(copy.text(.heartRate))
                    .accessibilityValue(heartRate.map { formatNumber($0["avg_value"]?.numberValue ?? 0, language: language) }.joined(separator: ", "))
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func sleepList(_ rows: [[String: JSONValue]]) -> some View {
        JarvisList {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Section(JarvisHealthLocalization.formattedDate(date(row["sleep_date"]) ?? "", language: language)) {
                    if let hours = row["total_sleep_hours"]?.numberValue ?? row["asleep_hours"]?.numberValue {
                        healthValue(
                            copy.text(.sleep),
                            "\(formatNumber(hours, language: language)) \(copy.text(.hourShort))"
                        )
                    }
                    if let inBed = row["in_bed_hours"]?.numberValue {
                        healthValue(
                            copy.text(.duration),
                            "\(formatNumber(inBed, language: language)) \(copy.text(.hourShort))"
                        )
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func mealsList(_ rows: [[String: JSONValue]]) -> some View {
        JarvisList {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                Section(row["meal_name"]?.stringValue ?? "\(copy.text(.meals)) \(index + 1)") {
                    if let time = row["occurred_at"]?.stringValue {
                        healthValue(copy.text(.date), JarvisHealthLocalization.formattedDateTime(time, language: language))
                    }
                    if let value = row["energy_kcal"]?.numberValue {
                        healthValue(copy.text(.energy), "\(formatNumber(value, language: language)) kcal")
                    }
                    if let value = row["protein_grams"]?.numberValue {
                        healthValue(copy.text(.proteinLeft), "\(formatNumber(value, language: language)) g")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func metricList(_ rows: [[String: JSONValue]]) -> some View {
        let points = metricPoints(rows)
        return List {
            Section(copy.text(.metricTrend)) {
                if !points.isEmpty {
                    Chart(points) { point in
                        LineMark(
                            x: .value(copy.text(.date), point.date),
                            y: .value(copy.text(.metricTrend), point.value)
                        )
                        .foregroundStyle(JarvisDesignTokens.healthAccent)
                        PointMark(
                            x: .value(copy.text(.date), point.date),
                            y: .value(copy.text(.metricTrend), point.value)
                        )
                        .foregroundStyle(JarvisDesignTokens.healthAccent)
                    }
                    .frame(height: JarvisDesignTokens.healthChartHeight)
                    .accessibilityLabel(copy.text(.metricTrend))
                    .accessibilityValue(points.map { formatNumber($0.value, language: language) }.joined(separator: ", "))
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    if let date = date(row["metric_date"]),
                       let value = row["avg_value"]?.numberValue ?? row["value"]?.numberValue {
                        healthValue(
                            JarvisHealthLocalization.formattedDate(date, language: language),
                            "\(formatNumber(value, language: language)) \(row["unit"]?.stringValue ?? "")"
                        )
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func healthValue(_ label: String, _ value: String) -> some View {
        LabeledContent(label, value: value)
    }

    private func metricPoints(_ rows: [[String: JSONValue]]) -> [JarvisHealthChartPoint] {
        rows.compactMap { row in
            guard let date = date(row["metric_date"]),
                  let parsed = parseDate(date),
                  let value = row["avg_value"]?.numberValue ?? row["value"]?.numberValue else {
                return nil
            }
            return JarvisHealthChartPoint(date: parsed, value: value)
        }
        .sorted { $0.date < $1.date }
    }

    private func heartRatePoints(_ rows: [[String: JSONValue]]) -> [JarvisHealthChartPoint] {
        rows.compactMap { row in
            guard let minute = row["sample_minute"]?.stringValue,
                  let date = ISO8601DateFormatter().date(from: minute),
                  let value = row["avg_value"]?.numberValue else {
                return nil
            }
            return JarvisHealthChartPoint(date: date, value: value)
        }
        .sorted { $0.date < $1.date }
    }

    private func load() async {
        guard let client else {
            failure = .unavailable
            return
        }
        guard let source = source,
              capabilities?.availableSources.contains(source.rawValue) == true else {
            unavailable = true
            data = JarvisHealthDetailData()
            return
        }
        loading = true
        failure = nil
        unavailable = false
        defer { loading = false }
        do {
            switch kind {
            case .workout(let id, _):
                let query = try JarvisHealthQuery(source: .workout, workoutId: id)
                let result = try await client.queryAll(query)
                var heartRate: [[String: JSONValue]] = []
                let heartRateUnavailable =
                    capabilities?.availableSources.contains(JarvisHealthSource.heartRate.rawValue) != true
                var heartRateFailure: JarvisHealthFailure?
                if !heartRateUnavailable {
                    do {
                        let heartRateQuery = try JarvisHealthQuery(source: .heartRate, workoutId: id, limit: 500)
                        heartRate = try await client.queryAll(heartRateQuery).items
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        heartRateFailure = JarvisHealthFailure(error)
                    }
                }
                data = JarvisHealthDetailData(
                    items: result.items,
                    heartRate: heartRate,
                    heartRateUnavailable: heartRateUnavailable,
                    heartRateFailure: heartRateFailure
                )
            case .sleep(let date, _):
                guard let period = JarvisHealthPeriod(startDate: date, endDate: date) else {
                    failure = .failed
                    return
                }
                let query = try JarvisHealthQuery(source: .sleep, period: period, limit: 500)
                data = JarvisHealthDetailData(items: try await client.queryAll(query).items)
            case .meals(let period):
                let query = try JarvisHealthQuery(source: .meals, period: period, limit: 100)
                data = JarvisHealthDetailData(items: try await client.queryAll(query).items)
            case .metric(let name, _, let period):
                let query = try JarvisHealthQuery(source: .metrics, period: period, metric: name, limit: 500)
                data = JarvisHealthDetailData(items: try await client.queryAll(query).items)
            }
        } catch is CancellationError {
            return
        } catch {
            failure = JarvisHealthFailure(error)
        }
    }

    private var isWorkout: Bool {
        if case .workout = kind { true } else { false }
    }

    private var source: JarvisHealthSource? {
        switch kind {
        case .workout: .workout
        case .sleep: .sleep
        case .meals: .meals
        case .metric: .metrics
        }
    }
}
