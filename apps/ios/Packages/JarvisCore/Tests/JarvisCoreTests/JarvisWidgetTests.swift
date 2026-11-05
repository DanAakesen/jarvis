import Foundation
import XCTest
@testable import JarvisCore

final class JarvisWidgetTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
        return calendar
    }

    private let now = Date(timeIntervalSince1970: 1_793_000_000)

    private func gym(at date: Date? = nil) -> JarvisGymWidgetData {
        JarvisWidgetBuilder.gym(
            now: date ?? now, calendar: calendar,
            dailySteps: [calendar.startOfDay(for: date ?? now): 6_400],
            workouts: [
                .init(date: (date ?? now).addingTimeInterval(-60), kind: .lift, calories: 300),
                .init(date: (date ?? now).addingTimeInterval(-120), kind: .run, kilometers: 5.2, calories: 400),
            ],
            stepGoal: 8_000, liftTarget: 4, runTarget: 2
        )
    }

    private func factory() -> JarvisFactoryWidgetData {
        JarvisFactoryWidgetData(
            generatedAt: now, lastDay: calendar.startOfDay(for: now), running: 2, awaiting: 1, review: 1, failed: 0,
            doneLast7Days: [1, 0, 2, 3, 0, 1, 4],
            tasks: (0..<8).map { .init(id: "t\($0)", title: "Task \($0)", detail: "d", status: .running, action: .pause) }
        )
    }

    private func snapshot(gymStatus: JarvisWidgetSnapshot.Section<JarvisGymWidgetData>.Status = .ok) -> JarvisWidgetSnapshot {
        JarvisWidgetSnapshot(
            language: .en,
            gym: .init(status: gymStatus, value: gym()),
            factory: .init(status: .ok, value: factory())
        )
    }

    // MARK: Snapshot encoding

    func testSnapshotRoundTripsThroughTheStore() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = JarvisWidgetSnapshotStore(directory: directory)
        XCTAssertEqual(store.load(), .missing)
        let written = snapshot()
        try store.save(written)
        guard case .snapshot(let read) = store.load() else { return XCTFail("snapshot expected") }
        XCTAssertEqual(read.version, JarvisWidgetSnapshot.currentVersion)
        XCTAssertEqual(read.gym.value?.stepsToday, 6_400)
        XCTAssertEqual(read.factory.value?.tasks.count, 5)
        XCTAssertEqual(read.appLanguage, .en)
    }

    func testStoreRejectsCorruptAndNewerVersions() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = JarvisWidgetSnapshotStore(directory: directory)
        let file = directory.appendingPathComponent(JarvisWidgetSnapshotStore.fileName)
        try Data("not json".utf8).write(to: file)
        XCTAssertEqual(store.load(), .unreadable)
        var newer = snapshot()
        newer.version = JarvisWidgetSnapshot.currentVersion + 1
        try store.save(newer)
        XCTAssertEqual(store.load(), .unreadable)
    }

    func testSnapshotCarriesNoCredentials() throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let text = String(decoding: try encoder.encode(snapshot()), as: UTF8.self).lowercased()
        for word in ["token", "secret", "authorization", "password"] { XCTAssertFalse(text.contains(word)) }
    }

    func testDataIsClampedToSevenDaysAndFiveTasks() {
        let data = JarvisGymWidgetData(
            generatedAt: now, lastDay: now, stepGoal: -1, dailySteps: [-5, 1, 2], liftsDone: -1, liftsTarget: 0,
            runsDone: 0, runsTarget: 0, trainedDays: [true], kilometers: .nan, calories: -2, weeks: []
        )
        XCTAssertEqual(data.dailySteps, [0, 0, 0, 0, 0, 1, 2].map { $0 })
        XCTAssertEqual(data.trainedDays.count, 7)
        XCTAssertEqual(data.stepGoal, 0)
        XCTAssertEqual(data.kilometers, 0)
        XCTAssertTrue(factory().tasks.count <= 5)
    }

    // MARK: Builders

    func testGymBuilderCountsTheCurrentWeek() {
        let data = gym()
        XCTAssertEqual(data.liftsDone, 1)
        XCTAssertEqual(data.runsDone, 1)
        XCTAssertEqual(data.kilometers, 5.2, accuracy: 0.001)
        XCTAssertEqual(data.calories, 700)
        XCTAssertEqual(data.weeks.count, 7)
        XCTAssertEqual(data.weeks.last?.lifts, 1)
        XCTAssertEqual(data.weeks.last?.runs, 1)
        XCTAssertEqual(data.trainedDays.last, true)
        XCTAssertEqual(data.dailySteps.last, 6_400)
    }

    func testFactoryBuilderMapsTasksAndConfirmations() throws {
        func task(_ id: String, _ state: String, extra: String = "") -> String {
            """
            {"id": "\(id)", "projectId": "p", "issueNumber": null, "originMessageId": null, "title": "T\(id)", "request": "r",
             "source": "board", "agent": "copilot", "modelOverride": null, "reasoningOverride": null, "state": "\(state)",
             "activity": "Skriver tests", "priority": 0, "attemptCount": 1, "nextAttemptAt": null, "branch": null,
             "pullRequest": null, "checks": null, "checkConclusion": null, "usageSummary": null,
             "latestSessionEndReason": null, "createdAt": "2026-10-31T08:00:00Z", "startedAt": null,
             "finishedAt": "\(ISO8601DateFormatter().string(from: now))"\(extra)}
            """
        }
        let json = "[\(task("1", "Running")), \(task("2", "Done")), \(task("3", "Paused"))]"
        let tasks = try JSONDecoder().decode([FactoryTaskRecord].self, from: Data(json.utf8))
        let confirmation = PendingConfirmation(id: "c1", actionKind: .merge, summary: "Merge", expiresAt: "2026-11-04T16:47:00Z")
        let data = JarvisWidgetBuilder.factory(now: now, calendar: calendar, language: .da, tasks: tasks, confirmations: [confirmation])
        XCTAssertEqual(data.running, 1)
        XCTAssertEqual(data.awaiting, 2)
        XCTAssertEqual(data.doneTotal, 1)
        XCTAssertEqual(data.tasks.first?.action, .approve)
        XCTAssertEqual(data.tasks.first?.detail, "Udløber kl. 17:47")
        XCTAssertEqual(data.tasks.first { $0.status == .running }?.detail, "Copilot · Skriver tests")
        XCTAssertEqual(data.tasks.first { $0.status == .running }?.action, .pause)
    }

    // MARK: Timeline provider

    func testMissingSnapshotIsLoadingAndUnreadableIsError() {
        XCTAssertEqual(JarvisWidgetTimeline.plan(for: .missing, topic: .gym, now: now).entries.first?.gym, .loading)
        XCTAssertEqual(JarvisWidgetTimeline.plan(for: .unreadable, topic: .factory, now: now).entries.first?.factory, .error)
    }

    func testPlanSchedulesAStaleEntryAndARefresh() {
        let fresh = JarvisWidgetSnapshot(language: .da, gym: .init(status: .ok, value: gym()), factory: .init())
        let plan = JarvisWidgetTimeline.plan(for: .snapshot(fresh), topic: .gym, now: now)
        XCTAssertEqual(plan.entries.count, 2)
        guard case .content(_, let freshStale) = plan.entries[0].gym,
              case .content(_, let laterStale) = plan.entries[1].gym else { return XCTFail("content expected") }
        XCTAssertFalse(freshStale)
        XCTAssertTrue(laterStale)
        XCTAssertEqual(plan.entries[1].date, now.addingTimeInterval(JarvisWidgetPolicy.staleAfter(.gym)))
        XCTAssertEqual(plan.reloadAfter, now.addingTimeInterval(JarvisWidgetPolicy.refreshInterval(.gym)))
    }

    func testAlreadyStaleSnapshotHasASingleStaleEntry() {
        let later = now.addingTimeInterval(3 * 3600)
        let plan = JarvisWidgetTimeline.plan(for: .snapshot(snapshot()), topic: .gym, now: later)
        XCTAssertEqual(plan.entries.count, 1)
        guard case .content(_, let stale) = plan.entries[0].gym else { return XCTFail("content expected") }
        XCTAssertTrue(stale)
    }

    func testSectionStates() {
        func state(_ section: JarvisWidgetSnapshot.Section<JarvisFactoryWidgetData>) -> JarvisWidgetViewState<JarvisFactoryWidgetData> {
            JarvisWidgetPolicy.resolve(section, topic: .factory, generatedAt: \.generatedAt, isEmpty: \.isEmpty, now: now)
        }
        XCTAssertEqual(state(.init(status: .loading)), .loading)
        XCTAssertEqual(state(.init(status: .error)), .error)
        XCTAssertEqual(state(.init(status: .offline)), .offline)
        let empty = JarvisFactoryWidgetData(
            generatedAt: now, lastDay: now, running: 0, awaiting: 0, review: 0, failed: 0, doneLast7Days: [], tasks: []
        )
        XCTAssertEqual(state(.init(status: .ok, value: empty)), .empty)
        // A failed refresh keeps the old numbers, marked stale.
        guard case .content(_, let stale) = state(.init(status: .offline, value: factory())) else { return XCTFail() }
        XCTAssertTrue(stale)
    }

    // MARK: Copy and formatting

    func testEveryStringExistsInBothLanguages() {
        for copy in JarvisWidgetCopy.allCases {
            XCTAssertFalse(copy.text(language: .da).isEmpty, "\(copy) da")
            XCTAssertFalse(copy.text(language: .en).isEmpty, "\(copy) en")
        }
    }

    func testThousandsUseK() {
        XCTAssertEqual(JarvisWidgetFormat.ofGoal(8_000, language: .da), "af 8,0k")
        XCTAssertEqual(JarvisWidgetFormat.ofGoal(8_000, language: .en), "of 8.0k")
        XCTAssertEqual(JarvisWidgetFormat.count(6_400, language: .da), "6,4k")
        XCTAssertEqual(JarvisWidgetFormat.count(6_400, language: .en), "6.4k")
        XCTAssertEqual(JarvisWidgetFormat.count(640, language: .da), "640")
    }

    func testDayLettersEndOnTheLastDay() {
        let monday = calendar.date(from: DateComponents(year: 2026, month: 11, day: 2))!
        XCTAssertEqual(JarvisWidgetFormat.dayLetters(endingOn: monday, language: .en, calendar: calendar).count, 7)
        XCTAssertEqual(JarvisWidgetFormat.dayLetters(endingOn: monday, language: .en, calendar: calendar).last, "M")
        XCTAssertEqual(JarvisWidgetFormat.dayLetters(endingOn: monday, language: .da, calendar: calendar).first, "T")
    }

    func testActionQueueKeepsOnlyFreshTapsAndEmptiesOnDrain() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = JarvisFactoryWidgetActionQueue(directory: directory)
        try queue.enqueue(.init(action: .approve, id: "old", requestedAt: now.addingTimeInterval(-3_600)))
        try queue.enqueue(.init(action: .retry, id: "new", requestedAt: now.addingTimeInterval(-30)))
        XCTAssertEqual(queue.drain(now: now).map(\.id), ["new"])
        XCTAssertEqual(queue.drain(now: now), [])
    }

    @MainActor
    func testActionsQueueWhenNoHandlerAndFailWithoutQueue() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            JarvisFactoryWidgetActions.queue = nil
            try? FileManager.default.removeItem(at: directory)
        }
        JarvisFactoryWidgetActions.handler = nil
        JarvisFactoryWidgetActions.queue = nil
        do {
            try await JarvisFactoryWidgetActions.perform(.pause, id: "t1")
            XCTFail("expected failure")
        } catch {
            XCTAssertEqual(error as? JarvisFactoryWidgetActions.Failure, .unavailable)
        }
        let queue = JarvisFactoryWidgetActionQueue(directory: directory)
        JarvisFactoryWidgetActions.queue = queue
        try await JarvisFactoryWidgetActions.perform(.pause, id: "t1")
        XCTAssertEqual(queue.drain().map(\.action), [.pause])
    }

    func testKilometersUseLocaleDecimals() {
        XCTAssertEqual(JarvisWidgetFormat.kilometers(5.24, language: .da), "5,2")
        XCTAssertEqual(JarvisWidgetFormat.kilometers(5.24, language: .en), "5.2")
    }

    // MARK: Notes and Home

    private func taskList(_ items: String) throws -> VaultTaskList {
        let json = """
        {"items": [\(items)], "readAt": "2026-11-05T08:00:00Z", "today": "2026-11-05", "total": 3, "truncated": false}
        """
        return try JSONDecoder().decode(VaultTaskList.self, from: Data(json.utf8))
    }

    private func vaultTask(_ id: String, _ text: String, due: String?, time: String? = nil, done: Bool = false) -> String {
        """
        {"id": "\(id)", "text": "\(text)", "done": \(done), "dueDate": \(due.map { "\"\($0)\"" } ?? "null"),
         "dueTime": \(time.map { "\"\($0)\"" } ?? "null"), "dueAt": null, "priority": "normal",
         "path": "Work/\(id).md", "line": 1, "heading": null, "version": "v"}
        """
    }

    private func vaultNotes() throws -> [VaultNoteSummary] {
        let json = """
        [{"path": "Work/a.md", "title": "Older", "folder": "Work", "directory": "Work", "updatedAt": "2026-11-01T08:00:00Z"},
         {"path": "Work/b.md", "title": "Newest", "folder": "Work", "directory": "Work", "updatedAt": "2026-11-05T07:30:00Z"}]
        """
        return try JSONDecoder().decode([VaultNoteSummary].self, from: Data(json.utf8))
    }

    func testNotesBuilderKeepsTodaysOpenTasksAndTheLatestNotesNewestFirst() throws {
        let list = try taskList([
            vaultTask("1", "Call", due: "2026-11-05", time: "14:00"),
            vaultTask("2", "Overdue", due: "2026-11-01"),
            vaultTask("3", "Done", due: "2026-11-05", done: true),
            vaultTask("4", "Plan", due: "2026-11-05"),
        ].joined(separator: ","))
        let data = JarvisWidgetBuilder.notes(now: now, calendar: calendar, tasks: list, notes: try vaultNotes())
        XCTAssertEqual(data.tasksToday, 2)
        XCTAssertEqual(data.tasks.map(\.title), ["Plan", "Call"])
        XCTAssertEqual(data.tasks.last?.time, "14:00")
        XCTAssertNotNil(data.tasks.first?.dueDate)
        XCTAssertEqual(data.notes.map(\.title), ["Newest", "Older"])
        XCTAssertFalse(data.isEmpty)
        XCTAssertTrue(JarvisWidgetBuilder.notes(now: now, calendar: calendar, tasks: try taskList(""), notes: []).isEmpty)
    }

    func testHomeBuilderUsesTheFactoryNumbers() {
        let home = JarvisWidgetBuilder.home(now: now, factory: factory())
        XCTAssertEqual(home.approvals, 1)
        XCTAssertEqual(home.running, 2)
    }

    func testPhrases() throws {
        let notes = JarvisNotesWidgetData(
            generatedAt: now, tasksToday: 3, tasks: [],
            notes: [.init(id: "n", title: "Ideas", editedAt: now)]
        )
        XCTAssertEqual(JarvisWidgetPhrase.notes(notes, language: .en), "3 tasks today. Latest note: Ideas.")
        XCTAssertEqual(JarvisWidgetPhrase.notes(notes, language: .da), "3 opgaver i dag. Seneste note: Ideas.")
        var one = notes
        one.tasksToday = 1
        one.notes = []
        XCTAssertEqual(JarvisWidgetPhrase.notes(one, language: .en), "1 task today.")
        one.tasksToday = 0
        XCTAssertEqual(JarvisWidgetPhrase.notes(one, language: .en), "No tasks today.")
        XCTAssertEqual(JarvisWidgetPhrase.noTasksToday(language: .da), "Ingen opgaver i dag")
        XCTAssertEqual(JarvisWidgetPhrase.now(.init(generatedAt: now, approvals: 2, running: 5), language: .en), "2 approvals needed")
        XCTAssertEqual(JarvisWidgetPhrase.now(.init(generatedAt: now, approvals: 0, running: 1), language: .en), "1 run in progress")
        XCTAssertEqual(JarvisWidgetPhrase.now(.init(generatedAt: now, approvals: 0, running: 0), language: .da), "Alt roligt")
        let gym = JarvisWidgetPhrase.gym(self.gym(), language: .en)
        XCTAssertEqual(gym.title, "Workouts 2 of 6")
        XCTAssertEqual(gym.detail, "4 to go")
    }

    func testTaskAndNoteTimes() {
        let timed = JarvisNotesWidgetData.Task(id: "1", title: "Call", time: "14:00")
        XCTAssertEqual(JarvisWidgetPhrase.when(timed, language: .en, calendar: calendar), "14:00")
        XCTAssertNil(JarvisWidgetPhrase.when(.init(id: "2", title: "x"), language: .en, calendar: calendar))
        XCTAssertEqual(JarvisWidgetPhrase.edited(now, now: now, language: .en, calendar: calendar).prefix(7), "Edited ")
    }

    func testSnapshotWithoutNotesAndHomeStillDecodes() throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(snapshot())
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "notes")
        object.removeValue(forKey: "home")
        let old = try JSONSerialization.data(withJSONObject: object)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(JarvisWidgetSnapshot.self, from: old)
        XCTAssertEqual(decoded.version, JarvisWidgetSnapshot.currentVersion)
        XCTAssertEqual(decoded.gym.value?.stepsToday, 6_400)
        XCTAssertEqual(decoded.notes.status, .loading)
        XCTAssertNil(decoded.home.value)
    }

    func testNotesAndHomeTimelines() {
        let notes = JarvisNotesWidgetData(generatedAt: now, tasksToday: 0, tasks: [], notes: [])
        let home = JarvisHomeWidgetData(generatedAt: now, approvals: 0, running: 0)
        let full = JarvisWidgetSnapshot(
            language: .en, gym: .init(status: .ok, value: gym()), factory: .init(status: .ok, value: factory()),
            notes: .init(status: .ok, value: notes), home: .init(status: .ok, value: home)
        )
        let notesPlan = JarvisWidgetTimeline.plan(for: .snapshot(full), topic: .notes, now: now)
        XCTAssertEqual(notesPlan.entries[0].notes, .empty)
        XCTAssertEqual(notesPlan.entries.count, 2)
        // "All quiet" is content, never the empty state.
        guard case .content(_, let stale) = notesPlan.entries[0].home else { return XCTFail("content expected") }
        XCTAssertFalse(stale)
        // Gym (30 min), the others (15 min): Home schedules both stale moments.
        let homePlan = JarvisWidgetTimeline.plan(for: .snapshot(full), topic: .home, now: now)
        XCTAssertEqual(homePlan.entries.count, 3)
        XCTAssertEqual(JarvisWidgetTimeline.plan(for: .missing, topic: .home, now: now).entries[0].notes, .loading)
        XCTAssertEqual(JarvisWidgetTimeline.plan(for: .unreadable, topic: .notes, now: now).entries[0].home, .error)
    }

    func testEveryWidgetKindMapsToATopic() {
        XCTAssertEqual(JarvisWidgetKind.allCases.count, 14)
        XCTAssertEqual(JarvisWidgetKind.notesLarge.topic, .notes)
        XCTAssertEqual(JarvisWidgetKind.homeSmall.topic, .home)
        XCTAssertEqual(Set(JarvisWidgetKind.allCases.map(\.rawValue)).count, 14)
    }

    func testWidgetLinksOpenTheMatchingPage() {
        XCTAssertEqual(JarvisWidgetLink.destination(for: JarvisWidgetLink.url(for: .notes)), .notes)
        XCTAssertEqual(JarvisWidgetLink.destination(for: JarvisWidgetLink.url(for: .home)), .today)
        XCTAssertNil(JarvisWidgetLink.destination(for: URL(string: "https://notes")!))
        XCTAssertNil(JarvisWidgetLink.destination(for: URL(string: "jarvis-widget://unknown")!))
    }
}
