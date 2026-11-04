import XCTest
@testable import JarvisCore

final class JarvisPagePhraseTests: XCTestCase {
    func testMarkupSplitsKeyWords() {
        let phrase = JarvisPagePhrase(markup: "Dan, {2 opgaver} er forfaldne.")
        XCTAssertEqual(phrase.plainText, "Dan, 2 opgaver er forfaldne.")
        XCTAssertEqual(phrase.segments.filter(\.isKey).map(\.text), ["2 opgaver"])
    }

    private func task(_ id: String, done: Bool = false, due: String?) -> VaultTask {
        VaultTask(
            id: id, text: id, done: done, dueDate: due, dueTime: nil, dueAt: nil, priority: .normal,
            path: "Work/a.md", line: 1, heading: nil, version: "v"
        )
    }

    private func list(_ items: [VaultTask]) -> VaultTaskList {
        VaultTaskList(items: items, readAt: "2026-11-02T08:00:00Z", today: "2026-11-02", total: items.count, truncated: false)
    }

    func testNotesPhraseCountsOverdueAndToday() {
        let tasks = list([
            task("a", due: "2026-11-01"), task("b", due: "2026-11-02"),
            task("c", done: true, due: "2026-10-01"), task("d", due: nil),
        ])
        XCTAssertEqual(JarvisNotesPagePhrase.TaskCounts(tasks).overdue, 1)
        XCTAssertEqual(
            JarvisNotesPagePhrase.tasks(tasks, language: .en).plainText,
            "Dan, 1 task is overdue, and 1 is due today."
        )
        XCTAssertEqual(
            JarvisNotesPagePhrase.tasks(tasks, language: .da).plainText,
            "Dan, 1 opgave er forfaldet, og 1 skal klares i dag."
        )
    }

    func testNotesPhraseWhenEverythingIsDone() {
        let tasks = list([task("a", done: true, due: nil)])
        XCTAssertEqual(JarvisNotesPagePhrase.tasks(tasks, language: .en).plainText, "Dan, all your tasks are done.")
    }

    func testHealthPhraseToday() {
        let open = JarvisHealthPagePhrase.Input(isToday: true, gymDone: 0, gymTarget: 1, steps: 4200, stepsTarget: 8000)
        XCTAssertEqual(
            JarvisHealthPagePhrase.make(open, language: .en).plainText,
            "Dan, you are at 4.2k of 8k steps, and today’s workout is still open."
        )
        let done = JarvisHealthPagePhrase.Input(isToday: true, gymDone: 1, gymTarget: 1, steps: 4200, stepsTarget: 8000)
        XCTAssertTrue(JarvisHealthPagePhrase.make(done, language: .en).plainText.hasPrefix("Today’s workout is done"))
    }

    func testHealthPhraseWithoutDataIsTheEmptyPhrase() {
        let none = JarvisHealthPagePhrase.Input(isToday: true, gymDone: 0, gymTarget: nil, steps: nil, stepsTarget: nil)
        XCTAssertTrue(JarvisHealthPagePhrase.make(none, language: .en).plainText.contains("no health data yet"))
    }

    func testWorkoutTypesMatchThePlanAndAreLocalized() {
        XCTAssertEqual(JarvisWorkoutSessionType.allCases.count, 6)
        for language in JarvisAppLanguage.allCases {
            for type in JarvisWorkoutSessionType.allCases {
                XCTAssertNotEqual(
                    JarvisHealthLocalization.string(type.localizationKey, language: language), type.localizationKey.rawValue
                )
            }
        }
        XCTAssertFalse(JarvisWorkoutDraft(idempotencyKey: UUID(), sessionType: .cardio, startedAt: Date(), durationMinutes: 0).isValid)
    }

    func testStatusPhraseLeadsWithFailures() {
        func entry(_ id: String, _ status: JarvisStatusValue) -> JarvisStatusEntry {
            JarvisStatusEntry(id: id, status: status, checkedAt: "2026-11-02T08:00:00Z")
        }
        let healthy = JarvisStatusSnapshot(checkedAt: "2026-11-02T08:00:00Z", entries: [entry("a", .ok), entry("b", .ok)])
        XCTAssertEqual(JarvisStatusPagePhrase.make(healthy, language: .en).plainText, "Dan, all 2 checks are healthy.")
        let down = JarvisStatusSnapshot(checkedAt: "2026-11-02T08:00:00Z", entries: [entry("a", .down), entry("b", .ok)])
        XCTAssertEqual(JarvisStatusPagePhrase.make(down, language: .en).plainText, "Dan, 1 check is down.")
    }

    func testProactivePhraseCountsOpenItems() {
        let status = JarvisProactiveStatus(
            paused: false, quietNow: false, nextSlotAt: nil, lastRun: nil,
            budget: JarvisProactiveBudget(month: "2026-11", monthlyLimitDkk: 50, estimatedSpendDkk: 1, state: .ok), sources: []
        )
        XCTAssertEqual(
            JarvisProactivePagePhrase.make(status: status, openItems: 2, language: .en).plainText,
            "Dan, Jarvis has 2 suggestions for you."
        )
    }

    func testNotificationsPhraseLeadsWithApprovals() {
        XCTAssertEqual(
            JarvisNotificationsPagePhrase.make(needsYou: 2, running: 1, updates: 3, language: .en).plainText,
            "Dan, 2 approvals are waiting for you."
        )
        XCTAssertEqual(
            JarvisNotificationsPagePhrase.make(needsYou: 0, running: 0, updates: 0, language: .da).plainText,
            "Dan, der er ingen nye notifikationer."
        )
    }
}
