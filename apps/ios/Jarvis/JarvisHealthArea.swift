import Charts
import Foundation
import JarvisCore
import SwiftUI

enum JarvisHealthFailure: Error, Equatable {
    case offline
    case denied
    case unavailable
    case failed

    init(_ error: Error) {
        if let failure = error as? JarvisHealthFailure {
            self = failure
        } else if let error = error as? JarvisClientError {
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
        if let previous, previous.state == .available || previous.state == .empty {
            state = previous.state
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
    var activeEnergy = JarvisHealthRead.loading
    var exerciseTime = JarvisHealthRead.loading
    var dailyActivity: JarvisDailyActivitySnapshot?
    var dailyActivityStale = false
    var activityNow = Date()
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
            [workouts, steps, activeEnergy, exerciseTime, nutritionDays, meals, sleep, metricCatalog, sync]
            .contains { $0.failure != nil } || bodyMetrics.contains { $0.read.failure != nil }
    }

    var isStale: Bool {
        failure != nil && capabilities != nil ||
            trainingTargetFailure != nil && trainingTargets != nil ||
            nutritionTargetFailure != nil && nutritionTargets != nil ||
            [workouts, steps, activeEnergy, exerciseTime, nutritionDays, meals, sleep, metricCatalog, sync]
                .contains { $0.isStale } || bodyMetrics.contains { $0.read.isStale }
    }

    var isPartial: Bool {
        [workouts, steps, activeEnergy, exerciseTime, nutritionDays, meals, sleep, metricCatalog, sync]
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
        case .fourteenDays: text(.fourteenDays)
        case .thirtyDays: text(.thirtyDays)
        }
    }
}

struct JarvisHealthArea: View {
    let client: JarvisHealthClient?
    let language: JarvisAppLanguage
    let observeRefreshEvents: Bool
    let onRetryConfiguration: () -> Void
    @State private var now: Date
    private let onSyncAppleHealth: (() async -> JarvisHealthSyncState?)?
    private let presentNewLiftAfterLoading: Bool
    /// The Home model, so the plus menu opens the very same log sheets as the Home tiles.
    private let gymModel: JarvisTodayModel?

    @State private var healthSyncState: JarvisHealthSyncState?
    @State private var isRefreshingFromPull = false
    @State private var periodPreset: JarvisHealthPeriodPreset = .sevenDays
    @State private var goals = JarvisHealthGoals.load()
    @State private var searchText = ""
    @State private var refreshVersion = 0
    @State private var dashboard: JarvisHealthDashboardData?
    @State private var dashboardPeriod: JarvisHealthPeriod?
    @State private var dashboardLoadID: UUID?
    @State private var isLoading = false
    @State private var trackWorkout = false
    @State private var editedLift: JarvisEditableLift?
    @State private var deletingLiftID: String?
    @State private var liftWriteFailed = false
    @State private var newLiftPresented = false
    @State private var newWorkoutPresented = false
    @State private var lifts: [[String: JSONValue]] = []
    @State private var vaultLifts: [[String: JSONValue]] = []
    @State private var vaultLiftsLoading = false
    @State private var vaultLoadID: UUID?
    @State private var vaultLiftsLoaded = false
    @State private var vaultLiftsPartial = false
    @State private var vaultLiftsFailed = false
    @State private var deviceWorkouts: [JarvisGymLogEntry]?
    @State private var deviceWorkoutsFailed = false
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var deviceActivity: JarvisDailyActivitySnapshot?
    @State private var deviceActivityFailed = false
    @State private var deviceSteps: JarvisStepsSnapshot?
    @State private var pastExercises: [[String: JSONValue]] = []
    @State private var exercisesLoading = true
    @State private var exercisesLoaded = false
    @State private var exerciseFailure: JarvisHealthFailure?
    @State private var exercisesPartial = false
    @State private var liftCursor: JSONValue?
    @State private var liftsLoading = true
    @State private var liftsLoaded = false
    @State private var liftLoadID: UUID?
    @State private var exerciseLoadID: UUID?
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
        gymModel: JarvisTodayModel? = nil,
        onSyncAppleHealth: (() async -> JarvisHealthSyncState?)? = nil
    ) {
        self.client = client
        self.language = language
        self.observeRefreshEvents = observeRefreshEvents
        self.onRetryConfiguration = onRetryConfiguration
        _now = State(initialValue: now)
        self.onSyncAppleHealth = onSyncAppleHealth
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

    // Body measurements are intermittent: Today must not hide a valid recent weight.
    private var bodyPeriod: JarvisHealthPeriod { JarvisHealthPeriod.make(.thirtyDays, now: now) }

    private var currentDashboard: JarvisHealthDashboardData {
        guard dashboardPeriod == period, let dashboard else {
            return JarvisHealthDashboardData(preset: periodPreset)
        }
        return dashboard
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.healthSectionSpacing) {
                    JarvisHealthSyncIssue(state: healthSyncState, language: language)
                    if liftWriteFailed {
                        Text("The change could not be confirmed. Refresh lifts before trying again.")
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("health.lift.writeError")
                    }
                    if trackWorkout {
                        if let failure = liftFailure ?? exerciseFailure { failureRow(failure) }
                        else if vaultLiftsFailed { failureRow(.failed) }
                        JarvisHealthLiftLog(
                            lifts: combinedLiftRows,
                            exercises: combinedExerciseRows,
                            searchText: searchText,
                            loading: liftsLoading || vaultLiftsLoading,
                            exercisesLoading: exercisesLoading || vaultLiftsLoading,
                            historyLoaded: liftsLoaded && (vaultLiftsLoaded || gymModel?.notesClient == nil),
                            exercisesLoaded: exercisesLoaded && (vaultLiftsLoaded || gymModel?.notesClient == nil),
                            failed: liftFailure != nil || vaultLiftsFailed,
                            exercisesFailed: exerciseFailure != nil || vaultLiftsFailed,
                            hasMore: liftCursor != nil,
                            exercisesPartial: exercisesPartial || vaultLiftsPartial || vaultLiftsFailed,
                            language: language,
                            loadMore: { Task { await loadLifts(more: true) } },
                            deletingID: deletingLiftID,
                            onEdit: { editedLift = $0 },
                            onDelete: { lift in Task { await deleteLift(lift) } }
                        )
                    } else {
                        if let headline { JarvisPageHeadline(phrase: headline) }
                        if let liftFailure, liftFailure != .unavailable { failureRow(liftFailure) }
                        else if vaultLiftsFailed { failureRow(.failed) }
                        let dashboard = withDeviceWorkouts(currentDashboard)
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
                        }
                        JarvisHealthHeroCarousel(
                            data: dashboard,
                            period: period,
                            goals: goals,
                            client: client,
                            language: language
                        ) { periodMenu }
                        lastLiftsSection
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
                            period: bodyPeriod,
                            client: client,
                            language: language,
                            hasSearch: !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        )
                        if dashboard.isStale || dashboard.isPartial {
                            freshnessLine(dashboard)
                        }
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.healthHorizontalInset)
                .padding(.top, JarvisDesignTokens.healthSectionSpacing)
                .padding(.bottom, JarvisDesignTokens.healthSectionSpacing)
            }
            .scrollIndicators(.hidden)
            .scrollEdgeEffectHidden(true, for: .bottom)
            .refreshable {
                await refreshFromPull()
            }
            .jarvisPageFooter {
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
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: dashboard?.preset)
        .onAppear { goals = JarvisHealthGoals.load() }
        .jarvisAmbientBackground()
        .tint(JarvisDesignTokens.healthAccent)
        .environment(\.locale, language.locale)
        .task(id: "\(periodPreset.rawValue)-\(refreshVersion)") {
            await loadDashboard(force: refreshVersion > 0)
        }
        .task(id: "\(dashboard?.capabilities != nil || dashboard?.failure != nil)-\(liftsAvailable)-\(refreshVersion)") {
            await loadLifts()
        }
        .task(id: refreshVersion) { await loadVaultLifts() }
        .task(id: refreshVersion) { await loadDeviceWorkouts() }
        .task(id: refreshVersion) { await loadDeviceSteps() }
        .task(id: refreshVersion) { await loadDeviceActivity() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, observeRefreshEvents { refreshVersion += 1 }
        }
        .task {
            guard observeRefreshEvents else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                guard scenePhase == .active else { continue }
                let previous = JarvisHealthPeriod.make(.today, now: now).startDate
                now = Date()
                await loadDeviceActivity()
                if previous != JarvisHealthPeriod.make(.today, now: now).startDate { refreshVersion += 1 }
            }
        }
        .sheet(item: $editedLift, onDismiss: { refreshVersion += 1 }) { lift in
            JarvisLiftEditorSheet(lift: lift, language: language) { edit in
                try await saveLift(lift, edit: edit)
            }
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
                    guard !Task.isCancelled, !isLoading, !isRefreshingFromPull else { continue }
                    refreshVersion += 1
                }
            } catch is CancellationError {
            } catch {
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    @MainActor
    private func refreshFromPull() async {
        guard !isRefreshingFromPull else { return }
        isRefreshingFromPull = true
        defer { isRefreshingFromPull = false }
        if observeRefreshEvents { now = Date() }
        healthSyncState = await onSyncAppleHealth?()
        guard !Task.isCancelled else { return }
        // Read all affected sources after the upload, not just the previously cached dashboard.
        async let dashboard: Void = loadDashboard(force: true)
        async let lifts: Void = loadLifts()
        async let vault: Void = loadVaultLifts()
        async let workouts: Void = loadDeviceWorkouts()
        async let steps: Void = loadDeviceSteps()
        async let activity: Void = loadDeviceActivity()
        _ = await (dashboard, lifts, vault, workouts, steps, activity)
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
            .accessibilityHint(copy.text(gymModel == nil ? .unavailable : .logLift))
            .accessibilityIdentifier("health.logLift")
            Button {
                newWorkoutPresented = true
            } label: {
                Label(copy.text(.logWorkout), systemImage: "figure.run")
            }
            .disabled(gymModel == nil)
            .accessibilityHint(copy.text(gymModel == nil ? .unavailable : .logWorkout))
            .accessibilityIdentifier("health.logWorkout")
        }
    }

    private var headline: JarvisPagePhrase? {
        let dashboard = currentDashboard
        guard let capabilities = dashboard.capabilities, !capabilities.availableSources.isEmpty else { return nil }
        let visible = withDeviceWorkouts(dashboard)
        guard visible.workouts.state == .available || visible.workouts.state == .empty else { return nil }
        let rings = JarvisHealthRingsSection(data: visible, period: period, language: language)
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

    private var lastLiftsSection: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            JarvisSectionHeadline(copy.text(.lastLifts)) {
                JarvisTextButton(title: copy.text(.log), identifier: "health.lifts.log") {
                    newLiftPresented = true
                }
                .disabled(gymModel == nil)
                .accessibilityHint(copy.text(gymModel == nil ? .unavailable : .logLift))
            }
            JarvisRowGroup {
                if ((liftsLoading && !liftsLoaded) || (vaultLiftsLoading && !vaultLiftsLoaded)) && combinedLiftRows.isEmpty {
                    JarvisHealthStateLine(state: .loading, language: language).jarvisListRow(separator: false)
                } else if let liftFailure, combinedLiftRows.isEmpty, vaultLiftsFailed || gymModel?.notesClient == nil {
                    Text(liftFailure.title(language: language)).foregroundStyle(.secondary)
                        .jarvisListRow(separator: false)
                } else if combinedLiftRows.isEmpty {
                    Text(copy.text(vaultLiftsPartial || vaultLiftsFailed ? .partial : .noLifts)).foregroundStyle(.secondary).jarvisListRow(separator: false)
                } else {
                    let recent = Array(combinedLiftRows.sorted {
                        ($0["performedAt"]?.stringValue ?? "") > ($1["performedAt"]?.stringValue ?? "")
                    }.prefix(3))
                    if vaultLiftsPartial || vaultLiftsFailed || (liftFailure != nil && liftFailure != .unavailable) {
                        Text(copy.text(.partial)).font(.caption).foregroundStyle(.secondary)
                            .jarvisListRow(separator: false)
                    }
                    ForEach(recent.indices, id: \.self) { index in
                        let lift = recent[index]
                        if let editable = JarvisEditableLift(row: lift) {
                            JarvisEditableSwipeRow(
                                identifier: "health.lift." + editable.id,
                                editTitle: "Edit",
                                deleteTitle: "Delete",
                                isBusy: deletingLiftID == editable.id,
                                onEdit: { editedLift = editable },
                                onDelete: { Task { await deleteLift(editable) } }
                            ) { lastLiftContent(lift) }
                            .id(editable.id)
                            .jarvisListRow(separator: index < recent.count - 1)
                        } else {
                            lastLiftContent(lift)
                                .jarvisListRow(separator: index < recent.count - 1)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("health.lastLifts")
    }

    private func lastLiftContent(_ lift: [String: JSONValue]) -> some View {
            HStack(spacing: JarvisDesignTokens.healthRowSpacing) {
                Image(systemName: "dumbbell").foregroundStyle(JarvisDesignTokens.healthAccent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    Text(lift["exerciseName"]?.stringValue ?? copy.text(.workout)).font(.body)
                    Text("\(lift["weightKg"]?.numberValue.map { $0.formatted(.number.locale(language.locale).grouping(.never)) } ?? "—") kg × \(lift["reps"]?.numberValue.map { formatNumber($0, language: language) } ?? "—")")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if let date = lift["performedAt"]?.stringValue {
                    Text(JarvisHealthLocalization.formattedDateTime(date, language: language))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
    }

    @MainActor
    private func saveLift(_ lift: JarvisEditableLift, edit: JarvisLiftEdit) async throws {
        do {
            switch lift.source {
            case .health(let id):
                guard let client else { throw JarvisClientError.invalidRequest }
                try await client.updateLift(id: id, edit: edit)
            case .vault(let path, let sha, _):
                guard let notes = gymModel?.notesClient else { throw JarvisClientError.invalidRequest }
                _ = try await notes.saveNote(path: path, content: lift.replacingLift(with: edit), sha: sha)
            }
            liftWriteFailed = false
            await JarvisAppCache.invalidateAll(.notes)
            await JarvisAppCache.invalidateAll(.health)
            await gymModel?.refreshWorkouts()
            refreshVersion += 1
        } catch {
            liftWriteFailed = true
            throw error
        }
    }

    @MainActor
    private func deleteLift(_ lift: JarvisEditableLift) async {
        guard deletingLiftID == nil else { return }
        deletingLiftID = lift.id
        defer { deletingLiftID = nil }
        do {
            switch lift.source {
            case .health(let id):
                guard let client else { throw JarvisClientError.invalidRequest }
                try await client.deleteLift(id: id)
            case .vault(let path, let sha, _):
                guard let notes = gymModel?.notesClient else { throw JarvisClientError.invalidRequest }
                try await notes.deleteGymLift(path: path, sha: sha)
            }
            lifts.removeAll { JarvisEditableLift(row: $0)?.id == lift.id }
            vaultLifts.removeAll { JarvisEditableLift(row: $0)?.id == lift.id }
            pastExercises.removeAll { JarvisEditableLift(row: $0)?.id == lift.id }
            liftWriteFailed = false
            await JarvisAppCache.invalidateAll(.notes)
            await JarvisAppCache.invalidateAll(.health)
            await gymModel?.refreshWorkouts()
        } catch { liftWriteFailed = true }
        refreshVersion += 1
    }

    private var periodMenu: some View {
        JarvisPeriodSelector(
            title: copy.text(.periodLabel),
            identifierPrefix: "health.period",
            items: JarvisHealthPeriodPreset.dashboardPresets.map {
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
    private func loadDeviceWorkouts() async {
        guard observeRefreshEvents, let gymModel else { return }
        await gymModel.refreshWorkouts()
        guard !Task.isCancelled else { return }
        deviceWorkouts = gymModel.workouts.value
        deviceWorkoutsFailed = gymModel.workouts.failure != nil
    }

    @MainActor
    private func loadDeviceSteps() async {
        guard observeRefreshEvents else { return }
        do {
            let snapshot = try await JarvisHealthKitStepsSource(calendar: JarvisHealthSyncWindow.calendar)
                .steps(now: now, days: 30)
            try Task.checkCancellation()
            if !snapshot.daily.isEmpty { deviceSteps = snapshot }
        } catch {
            // Retained server data and its freshness remain visible if the phone cannot provide a reading.
        }
    }

    @MainActor
    private func loadDeviceActivity() async {
        guard observeRefreshEvents else { return }
        if let gymModel {
            await gymModel.refreshActivity()
            guard !Task.isCancelled else { return }
            deviceActivity = gymModel.dailyActivity.value
            deviceActivityFailed = gymModel.dailyActivity.failure != nil
        } else {
            do {
                let activity = try await JarvisHealthKitActivitySource().activity(now: now, days: 30)
                try Task.checkCancellation()
                deviceActivity = activity
                deviceActivityFailed = false
            } catch is CancellationError {
            } catch { deviceActivityFailed = true }
        }
    }

    private func withDeviceWorkouts(_ original: JarvisHealthDashboardData) -> JarvisHealthDashboardData {
        var data = original
        data.activityNow = now
        if let deviceActivity {
            // Home and Health use the same root-owned snapshot, including retained/missing states.
            data.dailyActivity = deviceActivity
            data.dailyActivityStale = deviceActivityFailed
        }
        let formatter = ISO8601DateFormatter()
        if let deviceSteps, !deviceSteps.daily.isEmpty {
            let hadRetainedDays = !data.steps.items.isEmpty
            data.steps.items = JarvisHealthStepDays.merging(retained: data.steps.items, local: deviceSteps.daily)
            data.steps.state = .available
            // Retained days keep their source freshness; a partial phone snapshot cannot refresh the whole series.
            if !hadRetainedDays {
                data.steps.failure = nil
                data.steps.isStale = false
                data.steps.updatedAt = formatter.string(from: now)
            }
        }
        if deviceWorkoutsFailed {
            data.workouts.failure = .failed
            if data.workouts.items.isEmpty { data.workouts.state = .failed }
        }
        guard let deviceWorkouts else { return data }
        func instant(_ raw: String?) -> Date? {
            guard let raw else { return nil }
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let value = formatter.date(from: raw) { return value }
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: raw)
        }
        var identities = data.workouts.items.compactMap { row -> JarvisHealthWorkoutIdentity? in
            guard let start = instant(row["start_at"]?.stringValue) else { return nil }
            return JarvisHealthWorkoutIdentity(id: row["id"]?.stringValue, start: start,
                kind: JarvisHealthLogic.workoutKind(row["workout_type"]?.stringValue))
        }
        for entry in deviceWorkouts {
            let raw = entry.healthActivity ?? ([JarvisGymSessionType.chest, .back, .arms, .legs, .strength].contains(entry.session) ? "gym" : "other")
            let identity = JarvisHealthWorkoutIdentity(id: entry.healthKitID ?? entry.manualWorkoutID, start: entry.performedAt,
                kind: JarvisHealthLogic.workoutKind(raw), source: entry.manualWorkoutID == nil ? .healthKit : .manual)
            guard !identities.contains(where: { $0.matches(identity) }) else { continue }
            formatter.formatOptions = [.withInternetDateTime]
            let stamp = formatter.string(from: entry.performedAt)
            var row: [String: JSONValue] = ["workout_type": .string(raw), "start_at": .string(stamp),
                "workout_date": .string(JarvisHealthLogic.day(stamp)!), "device_only": .bool(true)]
            if let id = entry.healthKitID ?? entry.manualWorkoutID { row["id"] = .string(id) }
            if entry.durationMinutes > 0 { row["duration_seconds"] = .number(entry.durationMinutes * 60) }
            data.workouts.items.append(row)
            identities.append(identity)
        }
        data.workouts.state = data.workouts.items.isEmpty ? (deviceWorkoutsFailed ? .failed : .empty) : .available
        if deviceWorkoutsFailed { data.workouts.isStale = true }
        return data
    }

    private var combinedLiftRows: [[String: JSONValue]] {
        var seen: Set<String> = []
        return (lifts + vaultLifts).sorted {
            ($0["performedAt"]?.stringValue ?? "") > ($1["performedAt"]?.stringValue ?? "")
        }.filter { row in
            let key = ["performedAt", "exerciseName", "weightKg", "reps", "sets"]
                .map { String(describing: row[$0]) }.joined(separator: "|")
            return seen.insert(key).inserted
        }
    }

    private var combinedExerciseRows: [[String: JSONValue]] {
        var seen: Set<String> = []
        return (pastExercises + vaultLifts).sorted {
            ($0["performedAt"]?.stringValue ?? "") > ($1["performedAt"]?.stringValue ?? "")
        }.filter { seen.insert(($0["exerciseName"]?.stringValue ?? "").lowercased()).inserted }
    }

    @MainActor
    private func loadVaultLifts() async {
        guard observeRefreshEvents, let notes = gymModel?.notesClient else { return }
        let loadID = UUID()
        vaultLoadID = loadID
        vaultLiftsLoading = true
        defer { if vaultLoadID == loadID { vaultLiftsLoading = false } }
        do {
            let history = try await JarvisVaultGymLogStore(client: notes).recentLifts(
                since: JarvisHealthSyncWindow.recentStart(now: now)
            )
            try Task.checkCancellation()
            guard vaultLoadID == loadID else { return }
            let formatter = ISO8601DateFormatter()
            vaultLifts = history.entries.compactMap { entry in
                guard let lift = entry.lift else { return nil }
                var row: [String: JSONValue] = ["exerciseName": .string(lift.exercise), "weightKg": .number(lift.weightKg),
                        "reps": .number(Double(lift.reps)), "sets": .number(Double(lift.sets)),
                        "performedAt": .string(formatter.string(from: entry.performedAt))]
                if let note = entry.vaultNote {
                    row["notePath"] = .string(note.path)
                    row["noteSha"] = .string(note.sha)
                    row["noteContent"] = .string(note.content)
                }
                return row
            }
            vaultLiftsPartial = history.partial
            vaultLiftsFailed = false
            vaultLiftsLoaded = true
        } catch is CancellationError {
        } catch {
            if vaultLoadID == loadID { vaultLiftsFailed = true }
        }
    }

    @MainActor
    private func loadLifts(more: Bool = false) async {
        guard !more || !liftsLoading else { return }
        guard dashboard?.capabilities != nil || dashboard?.failure != nil else { return }
        let loadID = UUID()
        liftLoadID = loadID
        guard let client, liftsAvailable else {
            liftsLoading = false
            exercisesLoading = false
            exerciseLoadID = nil
            liftFailure = .unavailable
            return
        }
        liftsLoading = true
        if more {
            await loadLiftHistory(client, more: true, loadID: loadID)
        } else {
            exerciseLoadID = loadID
            exercisesLoading = true
            async let history: Void = loadLiftHistory(client, more: false, loadID: loadID)
            async let exercises: Void = loadPastExercises(client, loadID: loadID)
            _ = await (history, exercises)
            if liftLoadID == loadID, !Task.isCancelled, exerciseFailure == nil,
               presentNewLiftAfterLoading, !previewSheetPresented {
                previewSheetPresented = true
                newLiftPresented = true
            }
        }
    }

    @MainActor
    private func loadLiftHistory(_ client: JarvisHealthClient, more: Bool, loadID: UUID) async {
        defer { if liftLoadID == loadID { liftsLoading = false } }
        do {
            let history = try await client.query(JarvisHealthQuery(
                source: .lifts, limit: 100, cursor: more ? liftCursor : nil
            ))
            try Task.checkCancellation()
            guard liftLoadID == loadID else { return }
            lifts = more ? lifts + history.items : history.items
            liftsLoaded = true
            liftCursor = history.coverage.next
            liftFailure = nil
        } catch is CancellationError {
        } catch {
            if liftLoadID == loadID { liftFailure = JarvisHealthFailure(error) }
        }
    }

    @MainActor
    private func loadPastExercises(_ client: JarvisHealthClient, loadID: UUID) async {
        defer { if exerciseLoadID == loadID { exercisesLoading = false } }
        do {
            let latest = try await client.queryAll(JarvisHealthQuery(source: .lifts, limit: 100, lastPerExercise: true))
            try Task.checkCancellation()
            guard exerciseLoadID == loadID else { return }
            pastExercises = latest.items
            exercisesLoaded = true
            exercisesPartial = latest.coverage.hasMore
            exerciseFailure = nil
        } catch is CancellationError {
        } catch {
            if exerciseLoadID == loadID { exerciseFailure = JarvisHealthFailure(error) }
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
        .accessibilityIdentifier("health.failure")
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
        return ""
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
            [data.workouts, data.steps, data.activeEnergy, data.exerciseTime, data.nutritionDays,
             data.meals, data.sleep, data.metricCatalog, data.sync]
            .compactMap(\.failure).first ?? data.bodyMetrics.compactMap(\.read.failure).first ?? .failed
    }

    /// Reads through the repositories. A cache-only pass paints the cached dashboard at once (no request), then the
    /// normal pass refreshes only what is stale. `force` (pull to refresh, a saved workout, a sync event) refreshes
    /// everything.
    @MainActor
    private func loadDashboard(force: Bool = false) async {
        if observeRefreshEvents { now = Date() }
        let selectedPeriod = period
        let loadID = UUID()
        dashboardLoadID = loadID
        isLoading = true
        defer {
            if dashboardLoadID == loadID { isLoading = false }
        }
        if dashboardPeriod != selectedPeriod || dashboard == nil {
            dashboardPeriod = selectedPeriod
            dashboard = JarvisHealthDashboardData(preset: periodPreset)
            if !force {
                await buildDashboard(mode: JarvisHealthLoadMode(cacheOnly: true), period: selectedPeriod, loadID: loadID)
            }
        }
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        await buildDashboard(mode: JarvisHealthLoadMode(force: force), period: selectedPeriod, loadID: loadID)
    }

    private func ownsDashboardLoad(_ loadID: UUID, period selectedPeriod: JarvisHealthPeriod) -> Bool {
        !Task.isCancelled && dashboardLoadID == loadID && period == selectedPeriod
    }

    @MainActor
    private func buildDashboard(mode: JarvisHealthLoadMode, period selectedPeriod: JarvisHealthPeriod, loadID: UUID) async {
        guard let client else {
            dashboard?.failure = .unavailable
            finishUnavailableReads(.unavailable)
            dashboard?.loading = false
            return
        }

        async let training: Void = loadTrainingTargets(client: client, mode: mode, period: selectedPeriod, loadID: loadID)
        async let nutrition: Void = loadNutritionTargets(client: client, mode: mode, period: selectedPeriod, loadID: loadID)
        await loadDashboardReads(client: client, mode: mode, period: selectedPeriod, loadID: loadID)
        _ = await (training, nutrition)
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        dashboard?.loading = false
    }

    @MainActor
    private func loadDashboardReads(
        client: JarvisHealthClient, mode: JarvisHealthLoadMode, period selectedPeriod: JarvisHealthPeriod, loadID: UUID
    ) async {
        let capabilitiesRead: (value: JarvisHealthCapabilities?, failure: JarvisHealthFailure?) = await resolved(
            .health, scope: "capabilities", mode: mode
        ) { try await client.fetchCapabilities(validator: $0) }
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        dashboard?.failure = capabilitiesRead.failure
        guard let capabilities = capabilitiesRead.value ?? dashboard?.capabilities else {
            if mode.cacheOnly { return }
            dashboard?.failure = capabilitiesRead.failure ?? .failed
            finishUnavailableReads(capabilitiesRead.failure ?? .failed)
            return
        }
        dashboard?.capabilities = capabilities

        async let workouts: Void = publishRead(
            \.workouts, source: .workouts, queryPeriod: selectedPeriod, limit: 200,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let steps: Void = publishRead(
            \.steps, source: .metrics, queryPeriod: chartPeriod(selectedPeriod), metric: "step_count", limit: 500,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let energy: Void = publishRead(
            \.activeEnergy, source: .metrics, queryPeriod: selectedPeriod, metric: "active_energy_burned", limit: 100,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let exercise: Void = publishRead(
            \.exerciseTime, source: .metrics, queryPeriod: selectedPeriod, metric: "apple_exercise_time", limit: 100,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let nutrition: Void = publishRead(
            \.nutritionDays, source: .nutritionDays, queryPeriod: chartPeriod(selectedPeriod), limit: 400,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let meals: Void = publishRead(
            \.meals, source: .meals, queryPeriod: selectedPeriod, limit: 100,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let sleep: Void = publishRead(
            \.sleep, source: .sleep, queryPeriod: chartPeriod(sleepPeriod(selectedPeriod)), limit: 500,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let catalog: Void = publishRead(
            \.metricCatalog, source: .metricCatalog, queryPeriod: bodyPeriod, limit: 500,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        async let sync: Void = publishRead(
            \.sync, source: .sync, queryPeriod: nil, limit: nil,
            client: client, mode: mode, period: selectedPeriod, loadID: loadID
        )
        _ = await (workouts, steps, energy, exercise, nutrition, meals, sleep, catalog, sync)
    }

    @MainActor
    private func loadTrainingTargets(
        client: JarvisHealthClient, mode: JarvisHealthLoadMode, period selectedPeriod: JarvisHealthPeriod, loadID: UUID
    ) async {
        let result: (value: JarvisHealthTargets?, failure: JarvisHealthFailure?) = await resolved(
            .health, scope: "training-targets", mode: mode
        ) { try await client.fetchTrainingTargets(validator: $0) }
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        dashboard?.trainingTargets = result.value ?? dashboard?.trainingTargets
        dashboard?.trainingTargetFailure = result.failure
    }

    @MainActor
    private func loadNutritionTargets(
        client: JarvisHealthClient, mode: JarvisHealthLoadMode, period selectedPeriod: JarvisHealthPeriod, loadID: UUID
    ) async {
        let result: (value: JarvisNutritionTargets?, failure: JarvisHealthFailure?) = await resolved(
            .health, scope: "nutrition-targets", mode: mode
        ) { try await client.fetchNutritionTargets(validator: $0) }
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        dashboard?.nutritionTargets = result.value ?? dashboard?.nutritionTargets
        dashboard?.nutritionTargetFailure = result.failure
    }

    @MainActor
    private func publishRead(
        _ keyPath: WritableKeyPath<JarvisHealthDashboardData, JarvisHealthRead>,
        source: JarvisHealthSource, queryPeriod: JarvisHealthPeriod?, metric: String? = nil, limit: Int?,
        client: JarvisHealthClient, mode: JarvisHealthLoadMode, period selectedPeriod: JarvisHealthPeriod, loadID: UUID
    ) async {
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        let result = await read(
            source, period: queryPeriod, metric: metric, limit: limit,
            capabilities: dashboard?.capabilities, previous: dashboard?[keyPath: keyPath], client: client, mode: mode
        )
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        dashboard?[keyPath: keyPath] = result
        if source == .metrics, metric == "active_energy_burned" || metric == "apple_exercise_time",
           var data = dashboard {
            data.activityNow = now
            data.dailyActivity = .server(rows: data.activeEnergy.items + data.exerciseTime.items, fetchedAt: now)
            data.dailyActivityStale = data.activeEnergy.isStale || data.exerciseTime.isStale
                || data.activeEnergy.failure != nil || data.exerciseTime.failure != nil
            dashboard = data
        }
        if source == .metricCatalog {
            await loadBodyMetrics(
                catalog: result, period: bodyPeriod, capabilities: dashboard?.capabilities,
                client: client, mode: mode, selectedPeriod: selectedPeriod, loadID: loadID
            )
        }
    }

    private func finishUnavailableReads(_ failure: JarvisHealthFailure) {
        let keyPaths: [WritableKeyPath<JarvisHealthDashboardData, JarvisHealthRead>] = [
            \.workouts, \.steps, \.activeEnergy, \.exerciseTime, \.nutritionDays, \.meals, \.sleep, \.metricCatalog, \.sync,
        ]
        for keyPath in keyPaths where dashboard?[keyPath: keyPath].state == .loading {
            dashboard?[keyPath: keyPath] = JarvisHealthRead(error: failure, previous: nil)
        }
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

    @MainActor
    private func loadBodyMetrics(
        catalog: JarvisHealthRead,
        period: JarvisHealthPeriod,
        capabilities: JarvisHealthCapabilities?,
        client: JarvisHealthClient,
        mode: JarvisHealthLoadMode,
        selectedPeriod: JarvisHealthPeriod,
        loadID: UUID
    ) async {
        let definitions: [(JarvisHealthLogic.BodyMetric, JarvisHealthLocalizationKey)] = [
            (.weight, .weight), (.fatPercent, .bodyFat), (.leanMass, .leanMass),
        ]
        var metrics: [JarvisHealthMetricSeries] = []
        for (kind, title) in definitions {
            guard let metricName = catalog.items.compactMap({ $0["metric_name"]?.stringValue })
                .first(where: { JarvisHealthLogic.bodyMetricName($0, matching: kind) }) else {
                continue
            }
            let old = dashboard?.bodyMetrics.first { $0.metricName == metricName }?.read
            metrics.append(JarvisHealthMetricSeries(metricName: metricName, title: title, read: old ?? .loading))
        }
        guard ownsDashboardLoad(loadID, period: selectedPeriod) else { return }
        if catalog.state == .loading || (catalog.failure != nil && catalog.items.isEmpty) { return }
        dashboard?.bodyMetrics = metrics
        await withTaskGroup(of: Void.self) { group in
            for metric in metrics {
                let name = metric.metricName
                group.addTask { @MainActor [self] in
                    let result = await read(
                        .metrics, period: period, metric: name, limit: 500,
                        capabilities: capabilities,
                        previous: dashboard?.bodyMetrics.first { $0.metricName == name }?.read,
                        client: client, mode: mode
                    )
                    guard ownsDashboardLoad(loadID, period: selectedPeriod),
                          let index = dashboard?.bodyMetrics.firstIndex(where: { $0.metricName == name }) else { return }
                    dashboard?.bodyMetrics[index] = JarvisHealthMetricSeries(metricName: name, title: metric.title, read: result)
                }
            }
        }
    }

    /// The hero charts always show the last seven days, so reads reach back that far whatever the period.
    private func chartPeriod(_ period: JarvisHealthPeriod) -> JarvisHealthPeriod {
        let anchor = periodPreset == .yesterday ? now.addingTimeInterval(-86_400) : now
        let week = JarvisHealthPeriod.make(.sevenDays, now: anchor)
        guard period.endDate == week.endDate, week.startDate < period.startDate else { return period }
        return JarvisHealthPeriod(startDate: week.startDate, endDate: period.endDate) ?? period
    }

    private func sleepPeriod(_ period: JarvisHealthPeriod) -> JarvisHealthPeriod {
        guard periodPreset == .today else { return period }
        let yesterday = JarvisHealthPeriod.make(.yesterday, now: now).startDate
        return JarvisHealthPeriod(startDate: yesterday, endDate: period.endDate) ?? period
    }



}
