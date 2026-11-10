import Charts
import Foundation
import JarvisCore
import SwiftUI

enum JarvisHealthDetailKind {
    case workout(String, [String: JSONValue])
    case sleep(String, JarvisHealthPeriod)
    case meals(JarvisHealthPeriod)
    case metric(String, JarvisHealthLocalizationKey, JarvisHealthPeriod)

    var contextID: String {
        switch self {
        case .workout(let id, _): "workout:\(id)"
        case .sleep(let day, _): "sleep:\(day)"
        case .meals(let period): "meals:\(period.startDate):\(period.endDate)"
        case .metric(let name, _, let period): "metric:\(name):\(period.startDate):\(period.endDate)"
        }
    }

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
    var itemsLoaded = false
    var heartRate: [[String: JSONValue]] = []
    var heartRateLoaded = false
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
    @State private var selectedMetricReading: Int?
    @State private var dataContext: String?
    @State private var loadID: UUID?
    @State private var heartRateLoading = true

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private var currentData: JarvisHealthDetailData? { dataContext == kind.contextID ? data : nil }

    var body: some View {
        detailList(currentData ?? JarvisHealthDetailData())
        .jarvisAmbientBackground()
        .navigationTitle(kind.title(language: language))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .environment(\.locale, language.locale)
        .tint(JarvisDesignTokens.healthAccent)
        .task(id: "\(kind.contextID):\(retryVersion)") {
            await load()
        }
        .refreshable { await load() }
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
        case .metric(_, let title, let period):
            metricList(data.items, title: title, period: period)
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
            Section(header: JarvisSectionHeadline(copy.text(.workout)).textCase(nil)) {
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
                Section(header: JarvisSectionHeadline(copy.text(.metricTrend)).textCase(nil)) {
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
            Section { requestFeedback }
            Section(header: JarvisSectionHeadline(copy.text(.heartRate)).textCase(nil)) {
                if let heartRateFailure {
                    Label(
                        heartRateFailure.title(language: language),
                        systemImage: heartRateFailure == .offline ? "wifi.slash" : "exclamationmark.triangle"
                    )
                    if !heartRate.isEmpty { Text(copy.text(.stale)).foregroundStyle(.secondary) }
                    JarvisLabelledButton(title: copy.text(.retry), isDisabled: loading) { retryVersion += 1 }
                }
                if heartRate.isEmpty && (dataContext != kind.contextID || (heartRateLoading && currentData?.heartRateLoaded != true)) {
                    JarvisHealthStateLine(state: .loading, language: language)
                } else if heartRateUnavailable || (heartRate.isEmpty && heartRateFailure == nil) {
                    Text(copy.text(heartRateUnavailable ? .unavailable : .empty))
                        .foregroundStyle(.secondary)
                } else if !heartRate.isEmpty {
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
            if rows.isEmpty {
                Section(header: JarvisSectionHeadline(sleepDateLabel).textCase(nil)) {
                    healthValue(copy.text(.sleep), "—")
                    healthValue(copy.text(.duration), "—")
                    requestFeedback
                }
            } else {
                Section { requestFeedback }
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Section(header: JarvisSectionHeadline(JarvisHealthLocalization.formattedDate(date(row["sleep_date"]) ?? "", language: language)).textCase(nil)) {
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
            Section { requestFeedback }
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                Section(header: JarvisSectionHeadline(row["meal_name"]?.stringValue ?? "\(copy.text(.meals)) \(index + 1)").textCase(nil)) {
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

    private func metricList(_ rows: [[String: JSONValue]], title: JarvisHealthLocalizationKey,
                            period: JarvisHealthPeriod) -> some View {
        let trend = JarvisBodyTrend(rows: rows, period: period)
        let selected = trend.readings.first { $0.id == selectedMetricReading } ?? trend.latest
        return JarvisList {
            Section(header: JarvisSectionHeadline(copy.text(.metricTrend)).textCase(nil)) {
                if let selected {
                    healthValue(JarvisHealthLocalization.formattedDate(selected.day, language: language),
                                "\(formatBodyMeasurement(selected.value, language: language)) \(selected.unit)")
                    JarvisBodyTrendPlot(trend: trend, period: period, title: copy.text(title),
                                        language: language, selectedID: $selectedMetricReading)
                    if trend.excludesOtherUnits {
                        Text(copy.text(.partial)).foregroundStyle(.secondary)
                    }
                } else {
                    healthValue(copy.text(title), "—")
                }
            }
            Section(header: JarvisSectionHeadline(copy.text(.measurements)).textCase(nil)) {
                requestFeedback
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    if let date = date(row["metric_date"]),
                       let value = row["value"]?.numberValue ?? row["avg_value"]?.numberValue {
                        healthValue(
                            JarvisHealthLocalization.formattedDate(date, language: language),
                            "\(formatBodyMeasurement(value, language: language)) \(row["unit"]?.stringValue ?? "")"
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

    private var sleepDateLabel: String {
        if case .sleep(let day, _) = kind {
            return JarvisHealthLocalization.formattedDate(day, language: language)
        }
        return copy.text(.sleepNight)
    }

    @ViewBuilder
    private var requestFeedback: some View {
        if dataContext != kind.contextID {
            JarvisHealthStateLine(state: .loading, language: language)
        } else if let failure {
            Label(failure.title(language: language), systemImage: failure == .offline ? "wifi.slash" : "exclamationmark.triangle")
            if currentData?.itemsLoaded == true { Text(copy.text(.stale)).foregroundStyle(.secondary) }
            JarvisLabelledButton(title: copy.text(.retry), isDisabled: loading) { retryVersion += 1 }
        } else if unavailable {
            Text(copy.text(.unavailable)).foregroundStyle(.secondary)
        } else if currentData == nil || (loading && currentData?.itemsLoaded != true) {
            JarvisHealthStateLine(state: .loading, language: language)
        } else if currentData?.items.isEmpty == true && !isWorkout {
            Text(copy.text(.empty)).foregroundStyle(.secondary)
        }
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

    @MainActor
    private func load() async {
        let context = kind.contextID
        let requestID = UUID()
        loadID = requestID
        if dataContext != context {
            dataContext = context
            data = nil
            failure = nil
            unavailable = false
            selectedMetricReading = nil
            heartRateLoading = true
        }
        guard let client else {
            failure = .unavailable
            heartRateLoading = false
            return
        }
        guard let source = source,
              capabilities?.availableSources.contains(source.rawValue) == true else {
            unavailable = true
            data = JarvisHealthDetailData()
            heartRateLoading = false
            return
        }
        loading = true
        failure = nil
        unavailable = false
        defer {
            if loadID == requestID { loading = false }
        }
        do {
            switch kind {
            case .workout(let id, _):
                if data == nil { data = JarvisHealthDetailData() }
                async let details: Void = loadWorkoutDetails(client, id: id, context: context, requestID: requestID)
                async let heartRate: Void = loadWorkoutHeartRate(client, id: id, context: context, requestID: requestID)
                _ = await (details, heartRate)
            case .sleep(let date, _):
                guard let period = JarvisHealthPeriod(startDate: date, endDate: date) else {
                    failure = .failed
                    return
                }
                let query = try JarvisHealthQuery(source: .sleep, period: period, limit: 500)
                let result = try await client.queryAll(query)
                guard ownsLoad(requestID, context: context) else { return }
                data = JarvisHealthDetailData(items: result.items, itemsLoaded: true)
            case .meals(let period):
                let query = try JarvisHealthQuery(source: .meals, period: period, limit: 100)
                let result = try await client.queryAll(query)
                guard ownsLoad(requestID, context: context) else { return }
                data = JarvisHealthDetailData(items: result.items, itemsLoaded: true)
            case .metric(let name, _, let period):
                let query = try JarvisHealthQuery(source: .metrics, period: period, metric: name, limit: 500)
                let result = try await client.queryAll(query)
                guard ownsLoad(requestID, context: context) else { return }
                selectedMetricReading = JarvisBodyTrend(rows: result.items, period: period).selectionID(
                    retaining: selectedMetricReading,
                    from: JarvisBodyTrend(rows: data?.items ?? [], period: period)
                )
                data = JarvisHealthDetailData(items: result.items, itemsLoaded: true)
            }
        } catch is CancellationError {
            return
        } catch {
            if ownsLoad(requestID, context: context) { failure = JarvisHealthFailure(error) }
        }
    }

    private func ownsLoad(_ requestID: UUID, context: String) -> Bool {
        !Task.isCancelled && loadID == requestID && kind.contextID == context
    }

    @MainActor
    private func loadWorkoutDetails(_ client: JarvisHealthClient, id: String, context: String, requestID: UUID) async {
        do {
            let result = try await client.queryAll(JarvisHealthQuery(source: .workout, workoutId: id))
            guard ownsLoad(requestID, context: context) else { return }
            data?.items = result.items
            data?.itemsLoaded = true
        } catch {
            if ownsLoad(requestID, context: context) { failure = JarvisHealthFailure(error) }
        }
    }

    @MainActor
    private func loadWorkoutHeartRate(_ client: JarvisHealthClient, id: String, context: String, requestID: UUID) async {
        heartRateLoading = true
        defer {
            if loadID == requestID { heartRateLoading = false }
        }
        guard capabilities?.availableSources.contains(JarvisHealthSource.heartRate.rawValue) == true else {
            data?.heartRateUnavailable = true
            return
        }
        do {
            let result = try await client.queryAll(JarvisHealthQuery(source: .heartRate, workoutId: id, limit: 500))
            guard ownsLoad(requestID, context: context) else { return }
            data?.heartRate = result.items
            data?.heartRateLoaded = true
            data?.heartRateFailure = nil
        } catch {
            if ownsLoad(requestID, context: context) { data?.heartRateFailure = JarvisHealthFailure(error) }
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
