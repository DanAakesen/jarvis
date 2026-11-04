import Foundation
import XCTest
@testable import JarvisCore

final class JarvisTodayTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
        return calendar
    }()

    /// Monday 2 November 2026, 14:30 local.
    private var now: Date { date(2026, 11, 2, 14, 30) }

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func snapshot(perHour: Int = 100, daily: [Int: Int] = [:]) -> JarvisStepsSnapshot {
        var days: [Date: Int] = [:]
        let today = calendar.startOfDay(for: now)
        for (offset, steps) in daily {
            days[calendar.date(byAdding: .day, value: -offset, to: today)!] = steps
        }
        return JarvisStepsSnapshot(hourly: Array(repeating: perHour, count: 24), daily: days)
    }

    // MARK: Time of day and greeting

    func testTimeOfDayBoundaries() {
        XCTAssertEqual(JarvisTimeOfDay(hour: 4), .evening)
        XCTAssertEqual(JarvisTimeOfDay(hour: 5), .morning)
        XCTAssertEqual(JarvisTimeOfDay(hour: 11), .morning)
        XCTAssertEqual(JarvisTimeOfDay(hour: 12), .afternoon)
        XCTAssertEqual(JarvisTimeOfDay(hour: 17), .afternoon)
        XCTAssertEqual(JarvisTimeOfDay(hour: 18), .evening)
        XCTAssertEqual(JarvisTimeOfDay(hour: 0), .evening)
        XCTAssertEqual(JarvisTimeOfDay(date: now, calendar: calendar), .afternoon)
    }

    func testGreetingIsTwoSentencesWithKeyWordsInBothLanguages() {
        let entry = JarvisTodayCalendarEntry(
            id: "1", title: "Design review", start: date(2026, 11, 2, 15), end: date(2026, 11, 2, 16)
        )
        let english = JarvisTodayGreeting.make(
            timeOfDay: .afternoon, nextEvent: entry, tasksDueToday: 2, language: .en, calendar: calendar
        )
        XCTAssertEqual(english.plainText, "Afternoon Dan. Next is Design review at 15:00. You have 2 tasks due today.")
        XCTAssertEqual(english.segments.filter(\.isKey).map(\.text), ["Design review", "15:00", "2 tasks"])

        let danish = JarvisTodayGreeting.make(
            timeOfDay: .morning, nextEvent: nil, tasksDueToday: 3, language: .da, calendar: calendar
        )
        XCTAssertEqual(danish.plainText, "Godmorgen Dan. Du har 3 opgaver i dag.")
        XCTAssertEqual(danish.segments.filter(\.isKey).map(\.text), ["3 opgaver"])
    }

    func testGreetingAddsStepsAndWorkoutsOnlyWhenKnown() {
        let known = JarvisTodayGreeting.make(
            timeOfDay: .morning, nextEvent: nil, tasksDueToday: 0, stepsToday: 4200, workoutsThisWeek: 3,
            language: .en
        )
        XCTAssertEqual(
            known.plainText,
            "Morning Dan. Your day is clear. You have taken 4.2k steps today. You logged 3 workouts this week."
        )
        let unknown = JarvisTodayGreeting.make(
            timeOfDay: .morning, nextEvent: nil, tasksDueToday: 0, stepsToday: 0, workoutsThisWeek: 0,
            language: .en
        )
        XCTAssertEqual(unknown.plainText, "Morning Dan. Your day is clear.")
    }

    func testGreetingFallsBackToAnHonestClearDayAndNeverInventsValues() {
        let one = JarvisTodayGreeting.make(timeOfDay: .morning, nextEvent: nil, tasksDueToday: 1, language: .en)
        XCTAssertEqual(one.plainText, "Morning Dan. You have 1 task due today.")
        let clear = JarvisTodayGreeting.make(timeOfDay: .evening, nextEvent: nil, tasksDueToday: 0, language: .en)
        XCTAssertEqual(clear.plainText, "Evening Sir. Your day is clear.")
        XCTAssertEqual(clear.segments.filter(\.isKey).map(\.text), ["day is clear"])
    }

    func testGreetingSegmentsHandleBracesInTitlesAndUnbalancedText() {
        let entry = JarvisTodayCalendarEntry(id: "1", title: "A {b} c", start: now, end: now.addingTimeInterval(60))
        let greeting = JarvisTodayGreeting.make(
            timeOfDay: .morning, nextEvent: entry, tasksDueToday: 0, language: .en, calendar: calendar
        )
        XCTAssertTrue(greeting.plainText.contains("A b c"))
        XCTAssertEqual(JarvisTodayGreeting.parse("a {b").map(\.text).joined(), "a {b")
    }

    func testEveryTodayStringHasDanishAndEnglishText() {
        for key in JarvisTodayLocalizationKey.allCases {
            XCTAssertNotEqual(JarvisTodayLocalization.string(key, language: .da), key.rawValue, key.rawValue)
            XCTAssertNotEqual(JarvisTodayLocalization.string(key, language: .en), key.rawValue, key.rawValue)
        }
        XCTAssertEqual(JarvisTodayLocalization.string(.showMore, count: 2, language: .da), "Vis 2 mere")
        XCTAssertEqual(JarvisTodayLocalization.string(.agoDays, count: 5, language: .en), "5 d ago")
    }

    // MARK: Lists

    func testExpansionCapsAtThreeAndExpandRevealsTheRest() {
        XCTAssertEqual(JarvisTodayExpansion(total: 2, isExpanded: false), JarvisTodayExpansion(total: 2, isExpanded: true))
        let collapsed = JarvisTodayExpansion(total: 5, isExpanded: false)
        XCTAssertEqual(collapsed.visible, 3)
        XCTAssertEqual(collapsed.hidden, 2)
        XCTAssertEqual(JarvisTodayExpansion(total: 5, isExpanded: true).visible, 5)
        XCTAssertEqual(JarvisTodayExpansion(total: 0, isExpanded: false).hidden, 0)
    }

    func testAgendaKeepsUnfinishedEntriesInOrder() {
        let past = JarvisTodayCalendarEntry(id: "p", title: "Past", start: date(2026, 11, 2, 9), end: date(2026, 11, 2, 10))
        let running = JarvisTodayCalendarEntry(id: "r", title: "Running", start: date(2026, 11, 2, 14), end: date(2026, 11, 2, 15))
        let later = JarvisTodayCalendarEntry(id: "l", title: "Later", start: date(2026, 11, 2, 17), end: date(2026, 11, 2, 18))
        let tomorrow = JarvisTodayCalendarEntry(id: "t", title: "Tomorrow", start: date(2026, 11, 3, 9), end: date(2026, 11, 3, 10))
        let upcoming = JarvisTodayAgenda.upcoming([tomorrow, later, past, running], now: now)
        XCTAssertEqual(upcoming.map(\.id), ["r", "l", "t"])
        XCTAssertEqual(JarvisTodayAgenda.nextEntry([tomorrow], now: now, calendar: calendar)?.id, nil)
        XCTAssertEqual(JarvisTodayAgenda.nextEntry([tomorrow, later], now: now, calendar: calendar)?.id, "l")
    }

    func testNotesAreCorrelatedWithCalendarEntriesByTitle() {
        let entry = JarvisTodayCalendarEntry(id: "1", title: "Design review", start: now, end: now.addingTimeInterval(3600))
        func note(_ title: String) -> VaultNoteSummary {
            let json = """
            {"path":"Work/x.md","title":"\(title)","folder":"Work","directory":"Work","updatedAt":"2026-11-01T10:00:00Z"}
            """
            return try! JSONDecoder().decode(VaultNoteSummary.self, from: Data(json.utf8))
        }
        let matches = JarvisTodayCorrelation.notes(
            for: entry, in: [note("Design Review notes"), note("Groceries"), note("Review")]
        )
        XCTAssertEqual(matches.map(\.title), ["Design Review notes", "Review"])
        let short = JarvisTodayCalendarEntry(id: "2", title: "Go", start: now, end: now)
        XCTAssertTrue(JarvisTodayCorrelation.notes(for: short, in: [note("Go home")]).isEmpty)
    }

    // MARK: Steps and workouts

    func testHourlyBarsAreARunningTotalAndFutureHoursAreDisabled() {
        let bars = JarvisTodayActivity.stepBars(
            range: .today, steps: snapshot(perHour: 100), now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(bars.count, 17)
        XCTAssertEqual(bars.first?.label, "06:00")
        XCTAssertEqual(bars.last?.label, "22:00")
        // Hours 0...6 add up to 700 by the first bar; the current hour is 14.
        XCTAssertEqual(bars.first?.value, 700)
        let current = bars.first { $0.isCurrent }
        XCTAssertEqual(current?.label, "14:00")
        XCTAssertEqual(current?.value, 1_500)
        XCTAssertTrue(bars.filter { $0.id <= 8 }.allSatisfy(\.isEnabled))
        XCTAssertTrue(bars.filter { $0.id > 8 }.allSatisfy { !$0.isEnabled && $0.value == 0 })
    }

    func testDailyBarsCoverTheRangeEndingToday() {
        for range in [JarvisTodayRange.week, .fortnight, .month] {
            let bars = JarvisTodayActivity.stepBars(
                range: range, steps: snapshot(daily: [0: 5_000, 1: 9_000]), now: now, language: .en, calendar: calendar
            )
            XCTAssertEqual(bars.count, range.dayCount)
            XCTAssertEqual(bars.last?.value, 5_000)
            XCTAssertTrue(bars.last?.isCurrent == true)
            XCTAssertEqual(bars[bars.count - 2].value, 9_000)
            XCTAssertEqual(bars.first?.value, 0)
            XCTAssertTrue(bars.allSatisfy(\.isEnabled))
        }
        let week = JarvisTodayActivity.stepBars(range: .week, steps: .empty, now: now, language: .en, calendar: calendar)
        XCTAssertEqual(week.last?.label, "Mon")
        XCTAssertEqual(week.last?.caption, "Mon 2 Nov")
    }

    func testRangeCaptionNamesTheDatesOrHours() {
        XCTAssertEqual(
            JarvisTodayActivity.rangeCaption(range: .week, now: now, language: .en, calendar: calendar),
            "27 Oct to 2 Nov"
        )
        XCTAssertEqual(
            JarvisTodayActivity.rangeCaption(range: .week, now: now, language: .da, calendar: calendar),
            "27 okt til 2 nov"
        )
        XCTAssertEqual(
            JarvisTodayActivity.rangeCaption(range: .today, now: now, language: .en, calendar: calendar),
            "06:00 to 22:00"
        )
    }

    private func log(_ session: JarvisGymSessionType, daysAgo: Int) -> JarvisGymLogEntry {
        let day = calendar.date(byAdding: .day, value: -daysAgo, to: calendar.startOfDay(for: now))!
        return JarvisGymLogEntry(performedAt: day.addingTimeInterval(18 * 3600), session: session)
    }

    func testWorkoutCountsIncludeOnlyDaysInTheRange() {
        let entries = [
            log(.chest, daysAgo: 0), log(.back, daysAgo: 2), log(.back, daysAgo: 6),
            log(.legs, daysAgo: 7), log(.cardio, daysAgo: 20), log(.arms, daysAgo: 40),
        ]
        func counts(_ range: JarvisTodayRange) -> [JarvisGymSessionType: Int] {
            JarvisTodayActivity.workoutCounts(entries, range: range, now: now, calendar: calendar)
        }
        XCTAssertEqual(counts(.today), [.chest: 1])
        XCTAssertEqual(counts(.week), [.chest: 1, .back: 2])
        XCTAssertEqual(counts(.fortnight), [.chest: 1, .back: 2, .legs: 1])
        XCTAssertEqual(counts(.month), [.chest: 1, .back: 2, .legs: 1, .cardio: 1])
    }

    func testEntriesLaterThanNowAreNotCounted() {
        let future = JarvisGymLogEntry(performedAt: now.addingTimeInterval(2 * 86_400), session: .legs)
        XCTAssertTrue(JarvisTodayActivity.workoutCounts([future], range: .month, now: now, calendar: calendar).isEmpty)
    }

    // MARK: Selection and reset

    func testSelectingAndReselectingABarResets() {
        var state = JarvisTodayActivityState()
        state.toggleBar(3)
        XCTAssertEqual(state.selectedBar, 3)
        state.toggleBar(5)
        XCTAssertEqual(state.selectedBar, 5)
        state.toggleBar(5)
        XCTAssertNil(state.selectedBar)
    }

    func testChangingRangeAndTappingOutsideResetSelection() {
        var state = JarvisTodayActivityState()
        state.toggleBar(2)
        state.toggleSegment(.legs)
        state.clearSelection()
        XCTAssertNil(state.selectedBar)
        XCTAssertNil(state.selectedSegment)

        state.toggleBar(2)
        state.toggleSegment(.legs)
        state.setRange(.week)
        XCTAssertEqual(state.range, .week)
        XCTAssertNil(state.selectedBar)
        XCTAssertNil(state.selectedSegment)

        state.toggleBar(1)
        state.setRange(.week)
        XCTAssertEqual(state.selectedBar, 1, "Choosing the current range again keeps the selection")
    }

    func testSegmentSelectionShowsItsCountAndResetShowsTheTotal() {
        let entries = [log(.chest, daysAgo: 1), log(.chest, daysAgo: 3), log(.back, daysAgo: 2)]
        var state = JarvisTodayActivityState(range: .week)
        var display = JarvisTodayActivityDisplay(
            state: state, workouts: entries, steps: .empty, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.centerCount, 3)
        XCTAssertNil(display.centerSession)
        XCTAssertEqual(display.segments.first { $0.session == .chest }?.fraction ?? 0, 2.0 / 3.0, accuracy: 0.0001)

        state.toggleSegment(.chest)
        display = JarvisTodayActivityDisplay(
            state: state, workouts: entries, steps: .empty, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.centerCount, 2)
        XCTAssertEqual(display.centerSession, .chest)

        state.toggleSegment(.chest)
        display = JarvisTodayActivityDisplay(
            state: state, workouts: entries, steps: .empty, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.centerCount, 3)
    }

    func testBarSelectionSetsRingAndCaptionAndResetRestoresTodaysSteps() {
        let steps = snapshot(perHour: 100, daily: [0: 1_500, 2: 7_000])
        var state = JarvisTodayActivityState(range: .week)
        var display = JarvisTodayActivityDisplay(
            state: state, workouts: [], steps: steps, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.ringSteps, 1_500, "The ring defaults to today's steps")
        XCTAssertNil(display.ringLabel)
        XCTAssertEqual(display.caption, "27 Oct to 2 Nov")

        state.toggleBar(4)
        display = JarvisTodayActivityDisplay(
            state: state, workouts: [], steps: steps, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.ringSteps, 7_000)
        XCTAssertEqual(display.ringLabel, "Sat")
        XCTAssertEqual(display.caption, "Sat 31 Oct")
        XCTAssertEqual(display.ringFraction, 7_000.0 / 8_000.0, accuracy: 0.0001)

        state.toggleBar(4)
        display = JarvisTodayActivityDisplay(
            state: state, workouts: [], steps: steps, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.ringSteps, 1_500)
    }

    func testSelectingADisabledFutureHourIsIgnored() {
        var state = JarvisTodayActivityState()
        state.toggleBar(15)
        let display = JarvisTodayActivityDisplay(
            state: state, workouts: [], steps: snapshot(), now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.ringSteps, JarvisTodayActivity.todaySteps(snapshot(), now: now, calendar: calendar))
        XCTAssertNil(display.ringLabel)
    }

    func testRingFractionIsCappedAtTheGoal() {
        let steps = snapshot(perHour: 2_000)
        let display = JarvisTodayActivityDisplay(
            state: JarvisTodayActivityState(), workouts: [], steps: steps, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(display.ringFraction, 1)
        XCTAssertEqual(JarvisTodayActivity.stepGoal, 8_000)
    }

    func testStepsSnapshotRejectsMalformedHourlyData() {
        XCTAssertEqual(JarvisStepsSnapshot(hourly: [1, 2], daily: [:]).hourly, Array(repeating: 0, count: 24))
        XCTAssertEqual(JarvisStepsSnapshot(hourly: Array(repeating: -5, count: 24), daily: [:]).hourly.max(), 0)
    }

    func testTaskListsSplitTodayFromOverdueAndUpcoming() throws {
        func task(_ id: String, due: String?) throws -> VaultTask {
            let dueJSON = due.map { "\"\($0)\"" } ?? "null"
            let json = """
            {"id":"\(id)","text":"Task \(id)","done":false,"dueDate":\(dueJSON),"dueTime":null,"dueAt":null,
            "priority":"normal","path":"Personal/t.md","line":1,"heading":null,"version":"v"}
            """
            return try JSONDecoder().decode(VaultTask.self, from: Data(json.utf8))
        }
        let lists = JarvisTodayTaskLists(
            tasks: [try task("a", due: "2026-11-02"), try task("b", due: "2026-11-01"),
                    try task("c", due: "2026-11-05"), try task("d", due: nil)],
            today: "2026-11-02"
        )
        XCTAssertEqual(lists.today.map(\.id), ["a"])
        XCTAssertEqual(lists.due.map(\.id), ["b", "c"])
    }
}
