import Charts
import Foundation
import JarvisCore
import SwiftUI

enum JarvisHealthFailure: Equatable {
    case offline
    case denied
    case unavailable
    case failed

    init(_ error: Error) {
        if let error = error as? JarvisClientError {
            switch error {
            case .networkFailure, .timedOut, .serviceUnavailable, .rateLimited:
                self = .offline
            case .notOwner:
                self = .denied
            case .httpStatus(404):
                self = .unavailable
            default:
                self = .failed
            }
        } else {
            self = .failed
        }
    }

    func title(language: JarvisAppLanguage) -> String {
        switch self {
        case .offline: JarvisHealthLocalization.string(.offline, language: language)
        case .denied: JarvisHealthLocalization.string(.accessDenied, language: language)
        case .unavailable: JarvisHealthLocalization.string(.unavailable, language: language)
        case .failed: JarvisHealthLocalization.string(.loadFailed, language: language)
        }
    }
}

enum JarvisHealthReadState: Equatable {
    case loading
    case available
    case empty
    case notServed
    case offline
    case failed
}

struct JarvisHealthRead {
    var state: JarvisHealthReadState
    var items: [[String: JSONValue]] = []
    var hasMore = false
    var failure: JarvisHealthFailure?
    var updatedAt: String?
    var isStale = false

    static var loading: Self { Self(state: .loading) }
    static var notServed: Self { Self(state: .notServed) }

    init(_ result: JarvisHealthQueryResult) {
        items = result.items
        hasMore = result.coverage.hasMore
        updatedAt = Self.latestTimestamp(result.freshness)
        state = items.isEmpty ? .empty : .available
    }

    init(error: Error, previous: JarvisHealthRead?) {
        let failure = JarvisHealthFailure(error)
        if let previous, !previous.items.isEmpty {
            state = .available
            items = previous.items
            hasMore = previous.hasMore
            updatedAt = previous.updatedAt
            isStale = true
        } else {
            state = failure == .offline ? .offline : .failed
        }
        self.failure = failure
    }

    private init(state: JarvisHealthReadState) {
        self.state = state
    }

    private static func latestTimestamp(_ values: [String: JSONValue]?) -> String? {
        guard let values else { return nil }
        return [
            values["latestReturnedRecordUpdatedAt"]?.stringValue,
            values["sourceProcessedCommittedAt"]?.stringValue,
            values["observedAt"]?.stringValue,
        ]
        .compactMap { $0 }
        .max()
    }
}

struct JarvisHealthMetricSeries {
    let metricName: String
    let title: JarvisHealthLocalizationKey
    let read: JarvisHealthRead
}

struct JarvisHealthDashboardData {
    let preset: JarvisHealthPeriodPreset
    var capabilities: JarvisHealthCapabilities?
    var workouts = JarvisHealthRead.loading
    var steps = JarvisHealthRead.loading
    var nutritionDays = JarvisHealthRead.loading
    var meals = JarvisHealthRead.loading
    var sleep = JarvisHealthRead.loading
    var metricCatalog = JarvisHealthRead.loading
    var sync = JarvisHealthRead.loading
    var bodyMetrics: [JarvisHealthMetricSeries] = []
    var trainingTargets: JarvisHealthTargets?
    var nutritionTargets: JarvisNutritionTargets?
    var trainingTargetFailure: JarvisHealthFailure?
    var nutritionTargetFailure: JarvisHealthFailure?
    var loading = true
    var failure: JarvisHealthFailure?

    var hasFailure: Bool {
        failure != nil || trainingTargetFailure != nil || nutritionTargetFailure != nil ||
            [workouts, steps, nutritionDays, meals, sleep, metricCatalog, sync]
            .contains { $0.failure != nil } || bodyMetrics.contains { $0.read.failure != nil }
    }

    var isStale: Bool {
        failure != nil && capabilities != nil ||
            trainingTargetFailure != nil && trainingTargets != nil ||
            nutritionTargetFailure != nil && nutritionTargets != nil ||
            [workouts, steps, nutritionDays, meals, sleep, metricCatalog, sync]
                .contains { $0.isStale } || bodyMetrics.contains { $0.read.isStale }
    }

    var isPartial: Bool {
        [workouts, steps, nutritionDays, meals, sleep, metricCatalog, sync]
            .contains { $0.hasMore } || bodyMetrics.contains { $0.read.hasMore }
    }

    var latestUpdatedAt: String? {
        let values = [
            workouts.updatedAt, steps.updatedAt, nutritionDays.updatedAt,
            meals.updatedAt, sleep.updatedAt, metricCatalog.updatedAt, sync.updatedAt,
        ] + bodyMetrics.map(\.read.updatedAt)
        return values.compactMap { $0 }.max()
    }
}

extension JSONValue {
    var objectValue: [String: JSONValue]? {
        guard case .object(let value) = self else { return nil }
        return value
    }

    var arrayValue: [JSONValue]? {
        guard case .array(let value) = self else { return nil }
        return value
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var numberValue: Double? {
        guard case .number(let value) = self, value.isFinite else { return nil }
        return value
    }

    var booleanValue: Bool? {
        guard case .bool(let value) = self else { return nil }
        return value
    }
}

struct JarvisHealthCopy {
    let language: JarvisAppLanguage

    func text(_ key: JarvisHealthLocalizationKey) -> String {
        JarvisHealthLocalization.string(key, language: language)
    }

    func period(_ preset: JarvisHealthPeriodPreset) -> String {
        switch preset {
        case .today: text(.today)
        case .yesterday: text(.yesterday)
        case .sevenDays: text(.sevenDays)
        case .thirtyDays: text(.thirtyDays)
        }
    }
}

struct JarvisHealthArea: View {
    let client: JarvisHealthClient?
    let language: JarvisAppLanguage
    let observeRefreshEvents: Bool
    let onRetryConfiguration: () -> Void
    private let now: Date
    private let presentNewLiftAfterLoading: Bool

    @State private var periodPreset: JarvisHealthPeriodPreset = .today
    @State private var searchText = ""
    @State private var refreshVersion = 0
    @State private var dashboard: JarvisHealthDashboardData?
    @State private var isLoading = false
    @State private var trackWorkout = false
    @State private var newLiftPresented = false
    @State private var lifts: [[String: JSONValue]] = []
    @State private var pastExercises: [[String: JSONValue]] = []
    @State private var exercisesPartial = false
    @State private var liftCursor: JSONValue?
    @State private var liftsLoading = false
    @State private var liftLoadID: UUID?
    @State private var liftFailure: JarvisHealthFailure?
    @State private var previewSheetPresented = false

    init(
        client: JarvisHealthClient?,
        language: JarvisAppLanguage,
        observeRefreshEvents: Bool,
        onRetryConfiguration: @escaping () -> Void = {},
        now: Date = Date(),
        workoutInitiallySelected: Bool = false,
        presentNewLiftAfterLoading: Bool = false
    ) {
        self.client = client
        self.language = language
        self.observeRefreshEvents = observeRefreshEvents
        self.onRetryConfiguration = onRetryConfiguration
        self.now = now
        self.presentNewLiftAfterLoading = presentNewLiftAfterLoading
        _trackWorkout = State(initialValue: workoutInitiallySelected)
    }

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private var liftsAvailable: Bool {
        dashboard?.capabilities?.availableSources.contains(JarvisHealthSource.lifts.rawValue) == true
    }
    private var period: JarvisHealthPeriod {
        JarvisHealthPeriod.make(periodPreset, now: now)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.healthSectionSpacing) {
                    if trackWorkout {
                        if let liftFailure { failureRow(liftFailure) }
                        JarvisHealthLiftLog(
                            lifts: lifts,
                            exercises: pastExercises,
                            searchText: searchText,
                            loading: liftsLoading,
                            failed: liftFailure != nil,
                            hasMore: liftCursor != nil,
                            exercisesPartial: exercisesPartial,
                            language: language,
                            loadMore: { Task { await loadLifts(more: true) } }
                        )
                    } else {
                        periodMenu
                        if let dashboard {
                            if let failure = dashboard.failure {
                                failureRow(failure)
                            }
                            if dashboard.failure == nil && dashboard.hasFailure {
                                failureRow(firstFailure(in: dashboard))
                            }
                            if dashboard.capabilities != nil {
                                JarvisHealthRingsSection(
                                    data: dashboard,
                                    period: period,
                                    language: language
                                )
                                JarvisHealthSummarySection(
                                    data: dashboard,
                                    period: period,
                                    periodPreset: periodPreset,
                                    client: client,
                                    language: language,
                                    isToday: periodPreset == .today,
                                    now: now
                                )
                                JarvisHealthSessionsSection(
                                    read: dashboard.workouts,
                                    period: period,
                                    client: client,
                                    capabilities: dashboard.capabilities,
                                    language: language
                                )
                                JarvisHealthBodySection(
                                    metrics: visibleMetrics(in: dashboard),
                                    dashboard: dashboard,
                                    period: period,
                                    client: client,
                                    language: language,
                                    hasSearch: !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                )
                                JarvisHealthNutritionSection(
                                    read: dashboard.nutritionDays,
                                    targets: dashboard.nutritionTargets,
                                    targetFailure: dashboard.nutritionTargetFailure,
                                    period: period,
                                    language: language
                                )
                                freshnessLine(dashboard)
                            }
                        } else {
                            ProgressView(copy.text(.loading))
                                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.healthChartHeight)
                        }
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
                .padding(.top, JarvisDesignTokens.healthSectionSpacing)
                .padding(.bottom, JarvisDesignTokens.healthSectionSpacing)
            }
            .scrollIndicators(.hidden)
        }
        .jarvisAmbientBackground()
        .tint(JarvisDesignTokens.healthAccent)
        .environment(\.locale, language.locale)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                segmentSwitcher
                searchBar
            }
            .padding(.vertical, JarvisDesignTokens.healthSectionSpacing)
            .background(.bar)
        }
        .task(id: "\(periodPreset.rawValue)-\(refreshVersion)") {
            await loadDashboard()
        }
        .task(id: "\(liftsAvailable)-\(refreshVersion)") {
            await loadLifts()
        }
        .sheet(isPresented: $newLiftPresented) {
            JarvisHealthNewLiftSheet(
                client: client,
                exercises: pastExercises,
                language: language,
                onSaved: { refreshVersion += 1 }
            )
        }
        .task {
            guard observeRefreshEvents, let client else { return }
            do {
                for try await _ in client.refreshEvents() {
                    guard !Task.isCancelled, !isLoading else { continue }
                    refreshVersion += 1
                }
            } catch is CancellationError {
            } catch {
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var header: some View {
        HStack {
            Text(copy.text(.title))
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(.primary)
            Spacer()
            Button {
                refreshVersion += 1
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: JarvisDesignTokens.notesIconSize, weight: .medium))
                    .frame(width: JarvisDesignTokens.healthControlHeight, height: JarvisDesignTokens.healthControlHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.glass)
            .disabled(isLoading)
            .accessibilityLabel(copy.text(.refresh))
        }
        .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
        .padding(.top, JarvisDesignTokens.healthSectionSpacing)
    }

    private var segmentSwitcher: some View {
        Picker(copy.text(.title), selection: $trackWorkout) {
            Text(copy.text(.dashboard)).tag(false)
            Text(copy.text(.trackWorkout)).tag(true)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("health.mode")
        .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
        .onChange(of: trackWorkout) { _, _ in searchText = "" }
    }

    private var periodMenu: some View {
        HStack {
            Spacer(minLength: 0)
            Menu {
                ForEach(JarvisHealthPeriodPreset.allCases) { preset in
                    Button {
                        periodPreset = preset
                    } label: {
                        if periodPreset == preset {
                            Label(copy.period(preset), systemImage: "checkmark")
                        } else {
                            Text(copy.period(preset))
                        }
                    }
                }
            } label: {
                HStack(spacing: JarvisDesignTokens.healthMenuSpacing) {
                    Text(copy.period(periodPreset))
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .padding(.horizontal, JarvisDesignTokens.healthSectionSpacing)
                .frame(minHeight: JarvisDesignTokens.healthControlHeight)
            }
            .buttonStyle(.glass)
            .accessibilityLabel(copy.period(periodPreset))
        }
    }

    private var searchBar: some View {
        HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
            HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(copy.text(.search), text: $searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(copy.text(.search))
                    .accessibilityIdentifier("health.search")
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .frame(width: JarvisDesignTokens.healthControlHeight, height: JarvisDesignTokens.healthControlHeight)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(copy.text(.clearSearch))
                }
            }
            .padding(.leading, JarvisDesignTokens.healthSectionSpacing)
            .padding(.trailing, JarvisDesignTokens.notesCompactInset)
            .frame(minHeight: JarvisDesignTokens.healthControlHeight)
            .background(
                .regularMaterial,
                in: RoundedRectangle(cornerRadius: JarvisDesignTokens.healthPanelRadius, style: .continuous)
            )
            Button {
                newLiftPresented = true
            } label: {
                Image(systemName: "plus")
                    .frame(width: JarvisDesignTokens.healthControlHeight, height: JarvisDesignTokens.healthControlHeight)
            }
            .buttonStyle(.glass)
            .disabled(!liftsAvailable || liftsLoading)
            .accessibilityLabel(copy.text(liftsAvailable ? .newLift : .unavailable))
            .accessibilityIdentifier("health.plus")
        }
        .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
    }

    @MainActor
    private func loadLifts(more: Bool = false) async {
        guard !more || !liftsLoading else { return }
        let loadID = UUID()
        liftLoadID = loadID
        guard let client, liftsAvailable else {
            liftsLoading = false
            liftFailure = .unavailable
            return
        }
        liftsLoading = true
        defer {
            if liftLoadID == loadID { liftsLoading = false }
        }
        do {
            let history = try await client.query(JarvisHealthQuery(
                source: .lifts, limit: 100, cursor: more ? liftCursor : nil
            ))
            let latest = more ? nil : try await client.queryAll(JarvisHealthQuery(
                source: .lifts, limit: 100, lastPerExercise: true
            ))
            try Task.checkCancellation()
            guard liftLoadID == loadID else { return }
            lifts = more ? lifts + history.items : history.items
            liftCursor = history.coverage.next
            if let latest {
                pastExercises = latest.items
                exercisesPartial = latest.coverage.hasMore
                if presentNewLiftAfterLoading && !previewSheetPresented {
                    previewSheetPresented = true
                    newLiftPresented = true
                }
            }
            liftFailure = nil
        } catch is CancellationError {
        } catch {
            if liftLoadID == loadID { liftFailure = JarvisHealthFailure(error) }
        }
    }

    private func failureRow(_ failure: JarvisHealthFailure) -> some View {
        HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
            Image(systemName: failure == .offline ? "wifi.slash" : "exclamationmark.triangle")
                .accessibilityHidden(true)
            Text(failure.title(language: language))
                .font(.subheadline)
                .lineLimit(2)
            Spacer(minLength: 0)
            Button(copy.text(.retry)) {
                if client == nil {
                    onRetryConfiguration()
                } else {
                    refreshVersion += 1
                }
            }
            .buttonStyle(.glass)
            .tint(JarvisDesignTokens.healthAccent)
            .disabled(isLoading)
        }
        .foregroundStyle(failure == .offline ? .secondary : .primary)
        .accessibilityElement(children: .contain)
    }

    private func freshnessLine(_ data: JarvisHealthDashboardData) -> some View {
        HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
            Image(systemName: data.isStale ? "clock.arrow.circlepath" : "arrow.triangle.2.circlepath")
                .accessibilityHidden(true)
            Text(freshnessText(data))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    private func freshnessText(_ data: JarvisHealthDashboardData) -> String {
        if data.isStale && data.isPartial {
            return "\(copy.text(.stale)) · \(copy.text(.partial))"
        }
        if data.isStale { return copy.text(.stale) }
        if data.isPartial { return copy.text(.partial) }
        if let updatedAt = latestSyncTimestamp(data.sync) {
            return "\(copy.text(.lastSync)) · \(JarvisNotesLocalization.formattedUpdatedDate(updatedAt, language: language))"
        }
        return copy.text(.noSync)
    }

    private func visibleMetrics(in data: JarvisHealthDashboardData) -> [JarvisHealthMetricSeries] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return data.bodyMetrics }
        return data.bodyMetrics.filter {
            copy.text($0.title).localizedCaseInsensitiveContains(query) ||
                $0.metricName.localizedCaseInsensitiveContains(query)
        }
    }

    private func firstFailure(in data: JarvisHealthDashboardData) -> JarvisHealthFailure {
        data.trainingTargetFailure ?? data.nutritionTargetFailure ??
            [data.workouts, data.steps, data.nutritionDays, data.meals, data.sleep, data.metricCatalog, data.sync]
            .compactMap(\.failure).first ?? data.bodyMetrics.compactMap(\.read.failure).first ?? .failed
    }

    private func loadDashboard() async {
        let previous = dashboard?.preset == periodPreset ? dashboard : nil
        isLoading = true
        defer { isLoading = false }
        if previous == nil {
            dashboard = JarvisHealthDashboardData(preset: periodPreset)
        }
        guard let client else {
            var failure = JarvisHealthDashboardData(preset: periodPreset)
            failure.failure = .unavailable
            failure.loading = false
            dashboard = failure
            return
        }

        var next = JarvisHealthDashboardData(preset: periodPreset)
        let selectedPeriod = period
        do {
            next.capabilities = try await client.capabilities()
        } catch is CancellationError {
            return
        } catch {
            if var stale = previous {
                stale.failure = JarvisHealthFailure(error)
                stale.loading = false
                dashboard = stale
            } else {
                next.failure = JarvisHealthFailure(error)
                next.loading = false
                guard !Task.isCancelled else { return }
                dashboard = next
            }
            return
        }

        do {
            next.trainingTargets = try await client.trainingTargets()
        } catch is CancellationError {
            return
        } catch {
            next.trainingTargetFailure = JarvisHealthFailure(error)
            next.trainingTargets = previous?.trainingTargets
        }
        do {
            next.nutritionTargets = try await client.nutritionTargets()
        } catch is CancellationError {
            return
        } catch {
            next.nutritionTargetFailure = JarvisHealthFailure(error)
            next.nutritionTargets = previous?.nutritionTargets
        }

        next.workouts = await read(
            .workouts, period: selectedPeriod, limit: 200,
            capabilities: next.capabilities, previous: previous?.workouts, client: client
        )
        guard !Task.isCancelled else { return }
        next.steps = await read(
            .metrics, period: selectedPeriod, metric: "step_count", limit: 500,
            capabilities: next.capabilities, previous: previous?.steps, client: client
        )
        guard !Task.isCancelled else { return }
        next.nutritionDays = await read(
            .nutritionDays, period: selectedPeriod, limit: 400,
            capabilities: next.capabilities, previous: previous?.nutritionDays, client: client
        )
        guard !Task.isCancelled else { return }
        next.meals = await read(
            .meals, period: selectedPeriod, limit: 100,
            capabilities: next.capabilities, previous: previous?.meals, client: client
        )
        guard !Task.isCancelled else { return }
        next.sleep = await read(
            .sleep, period: sleepPeriod(selectedPeriod), limit: 500,
            capabilities: next.capabilities, previous: previous?.sleep, client: client
        )
        guard !Task.isCancelled else { return }
        next.metricCatalog = await read(
            .metricCatalog, period: selectedPeriod, limit: 500,
            capabilities: next.capabilities, previous: previous?.metricCatalog, client: client
        )
        guard !Task.isCancelled else { return }
        next.sync = await read(
            .sync, period: nil, limit: nil,
            capabilities: next.capabilities, previous: previous?.sync, client: client
        )
        guard !Task.isCancelled else { return }
        next.bodyMetrics = await loadBodyMetrics(
            catalog: next.metricCatalog,
            period: selectedPeriod,
            capabilities: next.capabilities,
            previous: previous?.bodyMetrics ?? [],
            client: client
        )
        next.loading = false
        guard !Task.isCancelled else { return }
        dashboard = next
    }

    private func read(
        _ source: JarvisHealthSource,
        period: JarvisHealthPeriod?,
        metric: String? = nil,
        limit: Int?,
        capabilities: JarvisHealthCapabilities?,
        previous: JarvisHealthRead?,
        client: JarvisHealthClient
    ) async -> JarvisHealthRead {
        guard capabilities?.availableSources.contains(source.rawValue) == true else {
            return .notServed
        }
        do {
            let query = try JarvisHealthQuery(
                source: source,
                period: period,
                metric: metric,
                limit: limit
            )
            return JarvisHealthRead(try await client.queryAll(query))
        } catch is CancellationError {
            return previous ?? .loading
        } catch {
            return JarvisHealthRead(error: error, previous: previous)
        }
    }

    private func loadBodyMetrics(
        catalog: JarvisHealthRead,
        period: JarvisHealthPeriod,
        capabilities: JarvisHealthCapabilities?,
        previous: [JarvisHealthMetricSeries],
        client: JarvisHealthClient
    ) async -> [JarvisHealthMetricSeries] {
        let definitions: [(JarvisHealthLogic.BodyMetric, JarvisHealthLocalizationKey)] = [
            (.weight, .weight), (.fatPercent, .bodyFat), (.leanMass, .leanMass),
        ]
        var metrics: [JarvisHealthMetricSeries] = []
        for (kind, title) in definitions {
            guard let metricName = catalog.items.compactMap({ $0["metric_name"]?.stringValue })
                .first(where: { JarvisHealthLogic.bodyMetricName($0, matching: kind) }) else {
                continue
            }
            let old = previous.first { $0.metricName == metricName }?.read
            let read = await self.read(
                .metrics, period: period, metric: metricName, limit: 500,
                capabilities: capabilities, previous: old, client: client
            )
            if Task.isCancelled { return metrics }
            metrics.append(JarvisHealthMetricSeries(metricName: metricName, title: title, read: read))
        }
        return metrics
    }

    private func sleepPeriod(_ period: JarvisHealthPeriod) -> JarvisHealthPeriod {
        guard periodPreset == .today else { return period }
        let yesterday = JarvisHealthPeriod.make(.yesterday, now: now).startDate
        return JarvisHealthPeriod(startDate: yesterday, endDate: period.endDate) ?? period
    }

    private func latestSyncTimestamp(_ read: JarvisHealthRead) -> String? {
        let keys: Set<String> = [
            "accepted_evidence_at", "last_received_at", "last_accepted_at",
            "last_processed_upload_at", "processed_committed_at",
            "latest_updated_at", "updated_at",
        ]
        func collect(_ value: JSONValue, key: String? = nil) -> [String] {
            if let key, keys.contains(key), let timestamp = value.stringValue { return [timestamp] }
            if let object = value.objectValue {
                return object.flatMap { collect($0.value, key: $0.key) }
            }
            if let array = value.arrayValue { return array.flatMap { collect($0) } }
            return []
        }
        return read.items.flatMap { collect(.object($0)) }.max()
    }

}
