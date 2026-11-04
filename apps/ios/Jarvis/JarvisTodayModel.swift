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
    var gym: any JarvisGymLogStore = JarvisUnavailableGymLogStore()
    var notes: JarvisNotesClient?
    var now: () -> Date = { Date() }
    var fixture: JarvisTodayFixture?
}

@MainActor
final class JarvisTodayModel: ObservableObject {
    @Published private(set) var calendar = JarvisTodaySection<[JarvisTodayCalendarEntry]>()
    @Published private(set) var taskData = JarvisTodaySection<JarvisTodayTaskData>()
    @Published private(set) var notes = JarvisTodaySection<[VaultNoteSummary]>()
    @Published private(set) var steps = JarvisTodaySection<JarvisStepsSnapshot>()
    @Published private(set) var workouts = JarvisTodaySection<[JarvisGymLogEntry]>()
    @Published private(set) var now: Date
    @Published var activity = JarvisTodayActivityState()

    private let dependencies: JarvisTodayDependencies
    private let timeCalendar = Calendar.current

    init(dependencies: JarvisTodayDependencies) {
        self.dependencies = dependencies
        now = dependencies.now()
    }

    var notesClient: JarvisNotesClient? { dependencies.notes }
    var isFixture: Bool { dependencies.fixture != nil }

    // MARK: Derived

    func greeting(language: JarvisAppLanguage) -> JarvisTodayGreeting {
        JarvisTodayGreeting.make(
            timeOfDay: JarvisTimeOfDay(date: now, calendar: timeCalendar),
            nextEvent: JarvisTodayAgenda.nextEntry(calendar.value ?? [], now: now, calendar: timeCalendar),
            tasksDueToday: taskData.value?.lists.today.count ?? 0,
            stepsToday: steps.value.map { JarvisTodayActivity.todaySteps($0, now: now, calendar: timeCalendar) },
            workoutsThisWeek: workoutsThisWeek,
            language: language,
            calendar: timeCalendar
        )
    }

    /// Logged workouts in the last seven days, or nil until the log has loaded.
    private var workoutsThisWeek: Int? {
        guard let entries = workouts.value else { return nil }
        let today = timeCalendar.startOfDay(for: now)
        guard let from = timeCalendar.date(byAdding: .day, value: -6, to: today) else { return nil }
        return entries.filter { $0.performedAt >= from }.count
    }

    func display(language: JarvisAppLanguage) -> JarvisTodayActivityDisplay {
        JarvisTodayActivityDisplay(
            state: activity,
            workouts: workouts.value ?? [],
            steps: steps.value ?? .empty,
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
        return last.session.shortTitle(language: language) + " · " + ago
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

    func refresh() async {
        now = dependencies.now()
        if let fixture = dependencies.fixture {
            apply(fixture)
            return
        }
        async let loadedCalendar: Void = loadCalendar()
        async let loadedTasks: Void = loadTasks()
        async let loadedSteps: Void = loadSteps()
        async let loadedWorkouts: Void = loadWorkouts()
        _ = await (loadedCalendar, loadedTasks, loadedSteps, loadedWorkouts)
    }

    func refreshWorkouts() async {
        guard !isFixture else { return }
        await loadWorkouts()
    }

    func refreshTasks() async {
        guard !isFixture else { return }
        await loadTasks()
    }

    func complete(_ task: VaultTask) async {
        if isFixture {
            guard let data = taskData.value else { return }
            taskData.value = JarvisTodayTaskData(tasks: data.tasks.filter { $0.id != task.id }, today: data.today)
            return
        }
        guard let client = dependencies.notes else { return }
        _ = try? await client.setTaskDone(task, done: true)
        await loadTasks()
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
    }

    private func loadCalendar() async {
        let start = timeCalendar.startOfDay(for: now)
        let end = timeCalendar.date(byAdding: .day, value: 2, to: start) ?? start
        let result = await fetch { try await self.dependencies.calendar.entries(from: start, to: end) }
        calendar = Self.merged(calendar, result.map { JarvisTodayAgenda.upcoming($0, now: self.now) })
        guard let client = dependencies.notes else { return }
        let found = await fetch { try await client.notes().notes }
        notes = Self.merged(notes, found)
    }

    private func loadTasks() async {
        guard let client = dependencies.notes else {
            taskData = Self.merged(taskData, .failure(.unavailable))
            return
        }
        let result = await fetch { () -> JarvisTodayTaskData in
            let list = try await client.tasks()
            return JarvisTodayTaskData(tasks: list.items, today: list.today)
        }
        taskData = Self.merged(taskData, result)
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
