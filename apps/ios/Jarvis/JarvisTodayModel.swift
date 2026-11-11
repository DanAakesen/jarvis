import Foundation
import JarvisCore

enum JarvisTodayFailure: Equatable, Error {
    case unavailable
    case offline
    case failed
}

/// One block of Today: what was last loaded, whether a load is running and why the last one failed.
struct JarvisTodaySection<Value: Equatable>: Equatable {
    var value: Value?
    var isLoading = true
    var failure: JarvisTodayFailure?
}

struct JarvisTodayTaskData: Equatable {
    let tasks: [VaultTask]
    let today: String
    var lists: JarvisTodayTaskLists { JarvisTodayTaskLists(tasks: tasks, today: today) }
}

struct JarvisTodayDependencies {
    var calendar: any JarvisTodayCalendarSource = JarvisUnavailableCalendarSource()
    var steps: any JarvisTodayStepsSource = JarvisUnavailableStepsSource()
    var dailyActivity: any JarvisDailyActivitySource = JarvisUnavailableDailyActivitySource()
    var gym: any JarvisGymLogStore = JarvisUnavailableGymLogStore()
    var notes: JarvisNotesClient?
    var briefClient: JarvisHomeBriefClient?
    var healthClient: JarvisHealthClient?
    var now: () -> Date = { Date() }
    var fixture: JarvisTodayFixture?
}

@MainActor
final class JarvisTodayModel: ObservableObject {
    @Published private(set) var calendar = JarvisTodaySection<[JarvisTodayCalendarEntry]>()
    @Published private(set) var taskData = JarvisTodaySection<JarvisTodayTaskData>()
    @Published private(set) var notes = JarvisTodaySection<[VaultNoteSummary]>()
    @Published private(set) var steps = JarvisTodaySection<JarvisStepsSnapshot>()
    @Published private(set) var dailyActivity = JarvisTodaySection<JarvisDailyActivitySnapshot>()
    @Published private(set) var workouts = JarvisTodaySection<[JarvisGymLogEntry]>()
    @Published private(set) var brief = JarvisTodaySection<JarvisHomeBrief>()
    private var briefGeneration = 0
    @Published private(set) var now: Date
    @Published var activity = JarvisTodayActivityState()

    private let dependencies: JarvisTodayDependencies
    private let timeCalendar = JarvisHealthSyncWindow.calendar

    init(dependencies: JarvisTodayDependencies) {
        self.dependencies = dependencies
        now = dependencies.now()
    }

    var notesClient: JarvisNotesClient? { dependencies.notes }
    var isFixture: Bool { dependencies.fixture != nil }

    // MARK: Derived

    func greeting(language: JarvisAppLanguage) -> JarvisTodayGreeting {
        if let fixture = dependencies.fixture { return fixture.brief(language: language).greeting }
        if let value = brief.value, value.language == language.rawValue,
           JarvisHealthLogic.day(value.generatedAt) == JarvisHealthPeriod.make(.today, now: now).startDate {
            if brief.failure != nil, value.state == "generated" {
                return .brief(text: JarvisTodayLocalization.string(.briefStale, language: language) + value.text,
                    highlights: value.highlights ?? [])
            }
            return value.greeting
        }
        if brief.isLoading {
            return .brief(text: JarvisTodayLocalization.string(.briefLoading, language: language), highlights: [])
        }
        return .brief(text: JarvisTodayLocalization.string(.briefUnavailable, language: language), highlights: [])
    }

    var briefMaxVisibleLines: Int {
        if let fixture = dependencies.fixture { return fixture.maxBriefLines }
        return brief.value?.maxVisibleLines ?? 3
    }

    func refreshBrief(language: JarvisAppLanguage, force: Bool = false) async {
        if let fixture = dependencies.fixture {
            brief = JarvisTodaySection(value: fixture.brief(language: language), isLoading: false)
            return
        }
        guard let client = dependencies.briefClient else {
            brief = Self.merged(brief, .failure(.unavailable))
            return
        }
        briefGeneration += 1
        let generation = briefGeneration
        do {
            let value = try await client.fetch(language: language, refresh: force)
            guard !Task.isCancelled, generation == briefGeneration else { return }
            brief = JarvisTodaySection(value: value, isLoading: false,
                failure: value.state == "generated" ? nil : .unavailable)
        } catch {
            guard !Task.isCancelled, generation == briefGeneration else { return }
            brief = Self.merged(brief, .failure(Self.failure(for: error)))
        }
    }

    func display(language: JarvisAppLanguage) -> JarvisTodayActivityDisplay {
        JarvisTodayActivityDisplay(
            state: activity,
            workouts: workouts.value ?? [],
            steps: steps.value ?? .empty,
            dailyActivity: dailyActivity.value,
            activityIsStale: dailyActivity.failure != nil,
            now: now,
            language: language,
            calendar: timeCalendar
        )
    }

    func correlatedNotes(for entry: JarvisTodayCalendarEntry) -> [VaultNoteSummary] {
        JarvisTodayCorrelation.notes(for: entry, in: notes.value ?? [])
    }

    /// "Chest · 2 d ago", or nil while there is nothing true to say yet.
    func lastWorkoutText(language: JarvisAppLanguage) -> String? {
        guard let entries = workouts.value else { return nil }
        guard let last = entries.max(by: { $0.performedAt < $1.performedAt }) else {
            return JarvisTodayLocalization.string(.noWorkoutYet, language: language)
        }
        let days = timeCalendar.dateComponents(
            [.day],
            from: timeCalendar.startOfDay(for: last.performedAt),
            to: timeCalendar.startOfDay(for: now)
        ).day ?? 0
        let ago: String
        switch days {
        case ...0: ago = JarvisTodayLocalization.string(.agoToday, language: language)
        case 1: ago = JarvisTodayLocalization.string(.agoYesterday, language: language)
        default: ago = JarvisTodayLocalization.string(.agoDays, count: days, language: language)
        }
        let name = last.healthActivity.map { JarvisHealthLocalization.workoutName($0, language: language) }
            ?? last.session.shortTitle(language: language)
        return name + " · " + ago
    }

    /// "Bench press · 80 kg", or nil while there is nothing true to say yet.
    func lastLiftText(language: JarvisAppLanguage) -> String? {
        guard let entries = workouts.value else { return nil }
        let lifts = entries.compactMap { entry in entry.lift.map { (entry.performedAt, $0) } }
        guard let last = lifts.max(by: { $0.0 < $1.0 })?.1 else {
            return JarvisTodayLocalization.string(.noLiftYet, language: language)
        }
        let weight = last.weightKg.rounded() == last.weightKg ? String(Int(last.weightKg)) : String(last.weightKg)
        return last.exercise + " · " + weight + " kg"
    }

    /// True when a block failed because the phone is offline but still shows what it loaded earlier.
    var isShowingOfflineCopy: Bool {
        (calendar.failure == .offline && calendar.value != nil)
            || (taskData.failure == .offline && taskData.value != nil)
            || (steps.failure == .offline && steps.value != nil)
            || (workouts.failure == .offline && workouts.value != nil)
    }

    // MARK: Loading

    /// Reads through the repositories: cached cards show at once and only stale ones refresh. `force` (retry)
    /// refreshes every card.
    func refresh(force: Bool = false) async {
        now = dependencies.now()
        if let fixture = dependencies.fixture {
            apply(fixture)
            return
        }
        async let loadedCalendar: Void = loadCalendar(force: force)
        async let loadedTasks: Void = loadTasks(force: force)
        async let loadedSteps: Void = loadSteps()
        async let loadedWorkouts: Void = loadWorkouts()
        async let loadedActivity: Void = loadActivity()
        _ = await (loadedCalendar, loadedTasks, loadedSteps, loadedWorkouts, loadedActivity)
    }

    func refreshWorkouts() async {
        guard !isFixture else { return }
        now = dependencies.now()
        await loadWorkouts()
    }

    func refreshTasks() async {
        guard !isFixture else { return }
        await loadTasks(force: false)
    }

    func complete(_ task: VaultTask) async throws {
        if isFixture {
            guard let data = taskData.value else { throw JarvisTodayFailure.unavailable }
            taskData.value = JarvisTodayTaskData(tasks: data.tasks.filter { $0.id != task.id }, today: data.today)
            return
        }
        guard let client = dependencies.notes else { throw JarvisTodayFailure.unavailable }
        do {
            _ = try await client.setTaskDone(task, done: true)
        } catch {
            // A conflict or uncertain write needs fresh versions before another attempt.
            await JarvisAppCache.invalidateAll(.tasks)
            await loadTasks(force: true)
            throw error
        }
        if let data = taskData.value {
            taskData.value = JarvisTodayTaskData(tasks: data.tasks.filter { $0.id != task.id }, today: data.today)
        }
        await JarvisAppCache.invalidateAll(.tasks)
        await loadTasks(force: true)
    }

    /// Saves a gym log on `day`, at the current time of day, through the vault path.
    func saveGymLog(session: JarvisGymSessionType, lift: JarvisGymLift?, on day: Date) async throws {
        let calendar = Calendar.current
        let time = calendar.dateComponents([.hour, .minute], from: dependencies.now())
        var parts = calendar.dateComponents([.year, .month, .day], from: day)
        parts.hour = time.hour
        parts.minute = time.minute
        let entry = JarvisGymLogEntry(
            performedAt: calendar.date(from: parts) ?? day, session: session, lift: lift
        )
        try await dependencies.gym.save(entry)
        if isFixture {
            workouts.value = (workouts.value ?? []) + [entry]
        } else {
            await loadWorkouts()
        }
    }

    // MARK: Private

    private func apply(_ fixture: JarvisTodayFixture) {
        calendar = JarvisTodaySection(value: JarvisTodayAgenda.upcoming(fixture.entries, now: now), isLoading: false)
        taskData = JarvisTodaySection(value: fixture.tasks, isLoading: false)
        notes = JarvisTodaySection(value: fixture.notes, isLoading: false)
        steps = JarvisTodaySection(value: fixture.steps, isLoading: false)
        workouts = JarvisTodaySection(value: fixture.gymEntries, isLoading: false)
        dailyActivity = JarvisTodaySection(value: fixture.dailyActivity, isLoading: false)
    }

    private func loadCalendar(force: Bool) async {
        let start = timeCalendar.startOfDay(for: now)
        let end = timeCalendar.date(byAdding: .day, value: 2, to: start) ?? start
        let source = dependencies.calendar
        let currentNow = now
        await load(
            .calendar, scope: String(Int(start.timeIntervalSince1970)), force: force, into: \.calendar,
            fetch: { _ in .modified(try await source.entries(from: start, to: end), validator: nil) },
            map: { JarvisTodayAgenda.upcoming($0, now: currentNow) }
        )
        guard let client = dependencies.notes else { return }
        await load(
            .notes, scope: "home", force: force, into: \.notes,
            fetch: { try await client.fetchNotes(validator: $0) },
            map: { (page: VaultNotePage) in page.notes }
        )
    }

    private func loadTasks(force: Bool) async {
        guard let client = dependencies.notes else {
            taskData = Self.merged(taskData, .failure(.unavailable))
            return
        }
        await load(
            .tasks, scope: "open", force: force, into: \.taskData,
            fetch: { try await client.fetchOpenTasks(validator: $0) },
            map: { (list: VaultTaskList) in
                JarvisTodayTaskData(tasks: list.items, today: JarvisTodayTaskLists.dayKey(self.dependencies.now()))
            }
        )
    }

    /// Cached value first, then a quiet refresh when it is stale; a failed refresh keeps the value on the card.
    private func load<Value: Codable & Sendable & Equatable, Output: Equatable>(
        _ kind: JarvisRepositoryKind,
        scope: String,
        force: Bool,
        into section: ReferenceWritableKeyPath<JarvisTodayModel, JarvisTodaySection<Output>>,
        fetch: @escaping JarvisRepository<Value>.Fetch,
        map: (Value) -> Output
    ) async {
        let repository = await JarvisAppCache.repository(kind, scope: scope, fetch: fetch)
        for await update in repository.updates(force: force) {
            if Task.isCancelled { return }
            switch update {
            case .cached(let value, _), .fresh(let value):
                self[keyPath: section] = Self.merged(self[keyPath: section], .success(map(value)))
            case .refreshing:
                break
            case .failed(let error, _):
                self[keyPath: section] = Self.merged(self[keyPath: section], .failure(Self.failure(for: error)))
            }
        }
    }

    func refreshActivity() async {
        guard !isFixture else { return }
        now = dependencies.now()
        await loadActivity()
    }

    private func loadActivity() async {
        let now = self.now
        let localSource = dependencies.dailyActivity
        let serverClient = dependencies.healthClient
        let result = await fetch {
            async let localRead = try? localSource.activity(now: now, days: 30)
            async let serverRead = try? serverClient?.dailyActivity(now: now, days: 30)
            let (local, retained) = await (localRead, serverRead)
            if let retained, let local { return retained.merging(local: local) }
            if let local { return local }
            if let retained {
                return retained.merging(local: JarvisDailyActivitySnapshot(days: [:], fetchedAt: now))
            }
            throw JarvisTodayDataError.unavailable
        }
        dailyActivity = Self.merged(dailyActivity, result)
    }

    private func loadSteps() async {
        let now = self.now
        let result = await fetch { try await self.dependencies.steps.steps(now: now, days: 30) }
        steps = Self.merged(steps, result)
    }

    private func loadWorkouts() async {
        let today = timeCalendar.startOfDay(for: now)
        let since = timeCalendar.date(byAdding: .day, value: -29, to: today) ?? today
        let result = await fetch { try await self.dependencies.gym.entries(since: since) }
        workouts = Self.merged(workouts, result)
    }

    private func fetch<Value>(_ operation: () async throws -> Value) async -> Result<Value, JarvisTodayFailure> {
        do {
            return .success(try await operation())
        } catch {
            return .failure(Self.failure(for: error))
        }
    }

    private static func merged<Value: Equatable>(
        _ section: JarvisTodaySection<Value>,
        _ result: Result<Value, JarvisTodayFailure>
    ) -> JarvisTodaySection<Value> {
        switch result {
        case .success(let value):
            return JarvisTodaySection(value: value, isLoading: false, failure: nil)
        case .failure(let failure):
            return JarvisTodaySection(value: section.value, isLoading: false, failure: failure)
        }
    }

    private static func failure(for error: Error) -> JarvisTodayFailure {
        if let error = error as? JarvisTodayDataError {
            switch error {
            case .unavailable, .notAuthorized: return .unavailable
            case .offline: return .offline
            case .failed: return .failed
            }
        }
        if let error = error as? JarvisGymLogError, error == .unavailable { return .unavailable }
        if let error = error as? JarvisClientError, error == .networkFailure || error == .timedOut {
            return .offline
        }
        if let error = error as? URLError,
           [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed].contains(error.code) {
            return .offline
        }
        return .failed
    }
}
