import Foundation
import JarvisCore

/// Fixed Today data for UI tests and screenshots. Used only in the simulator fixture run (`--ui-test-today`),
/// never in a normal launch.
struct JarvisTodayFixture {
    let now: Date
    let entries: [JarvisTodayCalendarEntry]
    let tasks: JarvisTodayTaskData
    let notes: [VaultNoteSummary]
    let steps: JarvisStepsSnapshot
    let gymEntries: [JarvisGymLogEntry]
    var dailyActivity: JarvisDailyActivitySnapshot {
        let calendar = JarvisHealthSyncWindow.calendar
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        var days: [String: JarvisDailyActivityDay] = [:]
        for offset in 0..<30 {
            guard let date = calendar.date(byAdding: .day, value: -offset, to: now) else { continue }
            days[formatter.string(from: date)] = JarvisDailyActivityDay(
                activeKilocalories: offset == 0 ? 420 : 360,
                exerciseMinutes: offset == 0 ? 24 : 30,
                observedAt: now
            )
        }
        return JarvisDailyActivitySnapshot(days: days, fetchedAt: now)
    }

    var maxBriefLines: Int {
        let value = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--home-brief-lines=") }
            .flatMap { Int($0.dropFirst("--home-brief-lines=".count)) } ?? 3
        return min(6, max(1, value))
    }
    func brief(language: JarvisAppLanguage) -> JarvisHomeBrief {
        let long = ProcessInfo.processInfo.arguments.contains("--home-brief-long")
        let text = language == .da
            ? "Design review begynder kl. 15. Du har to opgaver med frist i dag."
            : "Design review starts at 15:00. You have two tasks due today."
        return JarvisHomeBrief(text: long ? Array(repeating: text, count: 8).joined(separator: " ") : text,
            maxVisibleLines: maxBriefLines, language: language.rawValue,
            generatedAt: "2026-11-02T13:30:00Z", highlights: ["Design review"])
    }

    /// Monday 2 November 2026, 14:30 in the device time zone.
    static func make() -> JarvisTodayFixture {
        let calendar = Calendar.current
        func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute)) ?? Date()
        }
        let now = date(2, 14, 30)
        let entries = [
            JarvisTodayCalendarEntry(id: "e1", title: "Design review", start: date(2, 15), end: date(2, 16)),
            JarvisTodayCalendarEntry(id: "e2", title: "Dentist", start: date(2, 16, 30), end: date(2, 17)),
            JarvisTodayCalendarEntry(id: "e3", title: "Plan the week", start: date(2, 18), end: date(2, 18, 30)),
            JarvisTodayCalendarEntry(id: "e4", title: "Run club", start: date(2, 19), end: date(2, 20)),
        ]
        let taskJSON = """
        {"items":[
          {"id":"t1","text":"Send the invoice","done":false,"dueDate":"2026-11-02","dueTime":null,"dueAt":null,"priority":"normal","path":"Personal/Tasks.md","line":1,"heading":null,"version":"v1"},
          {"id":"t2","text":"Book the flights","done":false,"dueDate":"2026-11-02","dueTime":null,"dueAt":null,"priority":"normal","path":"Personal/Tasks.md","line":2,"heading":null,"version":"v1"},
          {"id":"t3","text":"Renew the passport","done":false,"dueDate":"2026-11-05","dueTime":null,"dueAt":null,"priority":"normal","path":"Personal/Tasks.md","line":3,"heading":null,"version":"v1"}
        ],"readAt":"2026-11-02T14:30:00.000Z","today":"2026-11-02","total":3,"truncated":false}
        """
        let list = try? JSONDecoder().decode(VaultTaskList.self, from: Data(taskJSON.utf8))
        let noteJSON = """
        [{"path":"Work/Design review notes.md","title":"Design review notes","folder":"Work","directory":"Work","updatedAt":"2026-11-01T09:00:00.000Z"}]
        """
        let notes = (try? JSONDecoder().decode([VaultNoteSummary].self, from: Data(noteJSON.utf8))) ?? []
        var hourly = [Int](repeating: 0, count: 24)
        for hour in 6...14 { hourly[hour] = 500 + hour * 20 }
        var daily: [Date: Int] = [:]
        let today = calendar.startOfDay(for: now)
        for offset in 1..<30 {
            if let day = calendar.date(byAdding: .day, value: -offset, to: today) {
                daily[day] = 4_000 + (offset * 337) % 6_000
            }
        }
        daily[today] = hourly.reduce(0, +)
        let gym = [
            JarvisGymLogEntry(
                performedAt: date(2, 7),
                session: .chest,
                lift: JarvisGymLift(exercise: "Bench press", weightKg: 80, reps: 5, sets: 3)
            ),
            JarvisGymLogEntry(performedAt: date(1, 18), session: .back),
            JarvisGymLogEntry(
                performedAt: calendar.date(byAdding: .day, value: -3, to: date(2, 18)) ?? now,
                session: .legs
            ),
        ]
        return JarvisTodayFixture(
            now: now,
            entries: entries,
            tasks: JarvisTodayTaskData(tasks: list?.items ?? [], today: list?.today ?? "2026-11-02"),
            notes: notes,
            steps: JarvisStepsSnapshot(hourly: hourly, daily: daily),
            gymEntries: gym
        )
    }
}

/// Stands in for the vault in the fixture run so the gym sheet can show its saved state.
struct JarvisFixtureGymLogStore: JarvisGymLogStore {
    func save(_ entry: JarvisGymLogEntry) async throws {}
    func entries(since: Date) async throws -> [JarvisGymLogEntry] { [] }
}
