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

/// How one dashboard pass reads: `cacheOnly` paints cached data without any request, `force` refreshes everything.
struct JarvisHealthLoadMode {
    var cacheOnly = false
    var force = false
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

    init(_ stored: JarvisHealthStoredRead) {
        items = stored.items
        hasMore = stored.hasMore
        updatedAt = Self.latestTimestamp(stored.freshness)
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
    /// The Home model, so the plus menu opens the very same log sheets as the Home tiles.
    private let gymModel: JarvisTodayModel?

    @State private var periodPreset: JarvisHealthPeriodPreset = .today
    @State private var searchText = ""
    @State private var refreshVersion = 0
    @State private var dashboard: JarvisHealthDashboardData?
    @State private var isLoading = false
    @State private var trackWorkout = false
    @State private var newLiftPresented = false
    @State private var newWorkoutPresented = false
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
        presentNewLiftAfterLoading: Bool = false,
        gymModel: JarvisTodayModel? = nil
    ) {
        self.client = client
        self.language = language
        self.observeRefreshEvents = observeRefreshEvents
        self.onRetryConfiguration = onRetryConfiguration
        self.now = now
        self.presentNewLiftAfterLoading = presentNewLiftAfterLoading
        self.gymModel = gymModel
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
                        if let headline { JarvisPageHeadline(phrase: headline) }
                        if let dashboard {
                            if let failure = dashboard.failure {
                                failureRow(failure)
                            }
                            if dashboard.failure == nil && dashboard.hasFailure {
                                failureRow(firstFailure(in: dashboard))
                            }
                            if let capabilities = dashboard.capabilities, capabilities.availableSources.isEmpty {
                                ContentUnavailableView(
                                    copy.text(.notAuthorised),
                                    systemImage: "heart.text.square"
                                )
                                .accessibilityIdentifier("health.empty")
                            } else if dashboard.capabilities != nil {
                                JarvisHealthRingsSection(
                                    data: dashboard,
                                    period: period,
                                    language: language
                                ) { periodMenu }
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
                            JarvisLoadingView(title: copy.text(.loading))
                                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.healthChartHeight)
                        }
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
                .padding(.top, JarvisDesignTokens.healthSectionSpacing)
                .padding(.bottom, JarvisDesignTokens.healthSectionSpacing)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                await loadDashboard(force: true)
                await loadLifts()
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: JarvisDesignTokens.healthSectionSpacing) {
                    segmentSwitcher
                        .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
                    HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                        searchBar
                        plusMenu
                    }
                    .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
                }
                .padding(.vertical, JarvisDesignTokens.healthSectionSpacing)
            }
        }
        .jarvisPageHeader { header }
        .animation(.easeInOut(duration: 0.25), value: dashboard?.preset)
        .jarvisAmbientBackground()
        .tint(JarvisDesignTokens.healthAccent)
        .environment(\.locale, language.locale)
        .task(id: "\(periodPreset.rawValue)-\(refreshVersion)") {
            await loadDashboard(force: refreshVersion > 0)
        }
        .task(id: "\(liftsAvailable)-\(refreshVersion)") {
            await loadLifts()
        }
        .sheet(isPresented: $newLiftPresented, onDismiss: { refreshVersion += 1 }) {
            if let gymModel {
                JarvisTodayGymSheet(model: gymModel, language: language, kind: .lift)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
        .sheet(isPresented: $newWorkoutPresented, onDismiss: { refreshVersion += 1 }) {
            if let gymModel {
                JarvisTodayGymSheet(model: gymModel, language: language, kind: .workout)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
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
        JarvisPageHeader(title: copy.text(.title), language: language)
    }

    /// The log menu sits beside the search field so the thumb reaches it.
    private var plusMenu: some View {
        JarvisMenuButton(
            title: copy.text(.log),
            systemImage: "plus",
            identifier: "health.plus"
        ) {
            Button {
                newLiftPresented = true
            } label: {
                Label(copy.text(.logLift), systemImage: "dumbbell")
            }
            .disabled(gymModel == nil)
            .accessibilityIdentifier("health.logLift")
            Button {
                newWorkoutPresented = true
            } label: {
                Label(copy.text(.logWorkout), systemImage: "figure.run")
            }
            .disabled(gymModel == nil)
            .accessibilityIdentifier("health.logWorkout")
        }
    }

    private var headline: JarvisPagePhrase? {
        guard let dashboard, let capabilities = dashboard.capabilities, !capabilities.availableSources.isEmpty else { return nil }
        let rings = JarvisHealthRingsSection(data: dashboard, period: period, language: language)
        return JarvisHealthPagePhrase.make(rings.phraseInput(isToday: periodPreset == .today), language: language)
    }

    private var segmentSwitcher: some View {
        JarvisSegmentedBar(
            title: copy.text(.title),
            identifierPrefix: "health.mode",
            items: [
                JarvisTabItem(tag: false, title: copy.text(.dashboard)),
                JarvisTabItem(tag: true, title: copy.text(.trackWorkout)),
            ],
            selection: $trackWorkout
        )
        .onChange(of: trackWorkout) { _, _ in searchText = "" }
    }

    private var periodMenu: some View {
        JarvisPeriodSelector(
            title: copy.text(.periodLabel),
            identifierPrefix: "health.period",
            items: JarvisHealthPeriodPreset.allCases.map {
                JarvisTabItem(tag: $0, title: copy.period($0), identifier: "health.period.\($0.rawValue)")
            },
            selection: $periodPreset
        )
    }

    private var searchBar: some View {
        JarvisSearchField(
            placeholder: copy.text(.search),
            text: $searchText,
            identifier: "health.search",
            clearTitle: copy.text(.clearSearch)
        )
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
            JarvisLabelledButton(title: copy.text(.retry), isDisabled: isLoading) {
                if client == nil {
                    onRetryConfiguration()
                } else {
                    refreshVersion += 1
                }
            }
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

    /// Reads through the repositories. A cache-only pass paints the cached dashboard at once (no request), then the
    /// normal pass refreshes only what is stale. `force` (pull to refresh, a saved workout, a sync event) refreshes
    /// everything.
    private func loadDashboard(force: Bool = false) async {
        isLoading = true
        defer { isLoading = false }
        if dashboard == nil {
            dashboard = JarvisHealthDashboardData(preset: periodPreset)
            if !force { await buildDashboard(mode: JarvisHealthLoadMode(cacheOnly: true)) }
        }
        await buildDashboard(mode: JarvisHealthLoadMode(force: force))
    }

    private func buildDashboard(mode: JarvisHealthLoadMode) async {
        let previous = dashboard?.preset == periodPreset ? dashboard : nil
        guard let client else {
            var failure = JarvisHealthDashboardData(preset: periodPreset)
            failure.failure = .unavailable
            failure.loading = false
            dashboard = failure
            return
        }

        var next = JarvisHealthDashboardData(preset: periodPreset)
        let selectedPeriod = period
        let capabilitiesRead: (value: JarvisHealthCapabilities?, failure: JarvisHealthFailure?) = await resolved(
            .health, scope: "capabilities", mode: mode
        ) { try await client.fetchCapabilities(validator: $0) }
        if Task.isCancelled { return }
        next.failure = capabilitiesRead.failure
        guard let capabilities = capabilitiesRead.value else {
            if mode.cacheOnly { return }
            if var stale = previous {
                stale.failure = next.failure ?? .failed
                stale.loading = false
                dashboard = stale
            } else {
                next.failure = next.failure ?? .failed
                next.loading = false
                dashboard = next
            }
            return
        }
        next.capabilities = capabilities

        let training: (value: JarvisHealthTargets?, failure: JarvisHealthFailure?) = await resolved(
            .health, scope: "training-targets", mode: mode
        ) { try await client.fetchTrainingTargets(validator: $0) }
        next.trainingTargets = training.value ?? previous?.trainingTargets
        next.trainingTargetFailure = training.failure
        let nutrition: (value: JarvisNutritionTargets?, failure: JarvisHealthFailure?) = await resolved(
            .health, scope: "nutrition-targets", mode: mode
        ) { try await client.fetchNutritionTargets(validator: $0) }
        next.nutritionTargets = nutrition.value ?? previous?.nutritionTargets
        next.nutritionTargetFailure = nutrition.failure
        if Task.isCancelled { return }

        next.workouts = await read(
            .workouts, period: selectedPeriod, limit: 200,
            capabilities: next.capabilities, previous: previous?.workouts, client: client, mode: mode
        )
        guard !Task.isCancelled else { return }
        next.steps = await read(
            .metrics, period: selectedPeriod, metric: "step_count", limit: 500,
            capabilities: next.capabilities, previous: previous?.steps, client: client, mode: mode
        )
        guard !Task.isCancelled else { return }
        next.nutritionDays = await read(
            .nutritionDays, period: selectedPeriod, limit: 400,
            capabilities: next.capabilities, previous: previous?.nutritionDays, client: client, mode: mode
        )
        guard !Task.isCancelled else { return }
        next.meals = await read(
            .meals, period: selectedPeriod, limit: 100,
            capabilities: next.capabilities, previous: previous?.meals, client: client, mode: mode
        )
        guard !Task.isCancelled else { return }
        next.sleep = await read(
            .sleep, period: sleepPeriod(selectedPeriod), limit: 500,
            capabilities: next.capabilities, previous: previous?.sleep, client: client, mode: mode
        )
        guard !Task.isCancelled else { return }
        next.metricCatalog = await read(
            .metricCatalog, period: selectedPeriod, limit: 500,
            capabilities: next.capabilities, previous: previous?.metricCatalog, client: client, mode: mode
        )
        guard !Task.isCancelled else { return }
        next.sync = await read(
            .sync, period: nil, limit: nil,
            capabilities: next.capabilities, previous: previous?.sync, client: client, mode: mode
        )
        guard !Task.isCancelled else { return }
        next.bodyMetrics = await loadBodyMetrics(
            catalog: next.metricCatalog,
            period: selectedPeriod,
            capabilities: next.capabilities,
            previous: previous?.bodyMetrics ?? [],
            client: client,
            mode: mode
        )
        next.loading = false
        guard !Task.isCancelled else { return }
        dashboard = next
    }

    /// One cached read: the value (cached or fresh) and, when the refresh failed, the failure beside it. A
    /// cache-only pass never reports a failure.
    private func resolved<Value: Codable & Sendable & Equatable>(
        _ kind: JarvisRepositoryKind,
        scope: String,
        mode: JarvisHealthLoadMode,
        fetch: @escaping JarvisRepository<Value>.Fetch
    ) async -> (value: Value?, failure: JarvisHealthFailure?) {
        let repository = await JarvisAppCache.repository(kind, scope: scope, fetch: fetch)
        let result = await repository.resolve(cacheOnly: mode.cacheOnly, force: mode.force)
        if let error = result.error, !(error is CancellationError) {
            return (result.value, JarvisHealthFailure(error))
        }
        return (result.value, nil)
    }

    private func read(
        _ source: JarvisHealthSource,
        period: JarvisHealthPeriod?,
        metric: String? = nil,
        limit: Int?,
        capabilities: JarvisHealthCapabilities?,
        previous: JarvisHealthRead?,
        client: JarvisHealthClient,
        mode: JarvisHealthLoadMode
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
            let scope = [
                "read", source.rawValue, period?.startDate ?? "-", period?.endDate ?? "-", metric ?? "-",
            ].joined(separator: ":")
            let repository: JarvisRepository<JarvisHealthStoredRead> = await JarvisAppCache.repository(
                .health, scope: scope
            ) { _ in try await client.fetchStoredRead(query) }
            let result = await repository.resolve(cacheOnly: mode.cacheOnly, force: mode.force)
            if Task.isCancelled { return previous ?? .loading }
            if let stored = result.value {
                var read = JarvisHealthRead(stored)
                if let error = result.error {
                    read.failure = JarvisHealthFailure(error)
                    read.isStale = true
                }
                return read
            }
            if mode.cacheOnly { return previous ?? .loading }
            return JarvisHealthRead(error: result.error ?? JarvisClientError.networkFailure, previous: previous)
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
        client: JarvisHealthClient,
        mode: JarvisHealthLoadMode
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
                capabilities: capabilities, previous: old, client: client, mode: mode
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
