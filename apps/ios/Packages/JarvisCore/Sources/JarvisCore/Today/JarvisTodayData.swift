import Foundation

/// A calendar entry for the Next up list.
public struct JarvisTodayCalendarEntry: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let start: Date
    public let end: Date
    public let location: String?

    public init(id: String, title: String, start: Date, end: Date, location: String? = nil) {
        self.id = id
        self.title = title
        self.start = start
        self.end = end
        self.location = location
    }
}

public enum JarvisTodayDataError: Error, Equatable, Sendable {
    /// No source is wired for this data. Nothing is invented in its place.
    case unavailable
    case notAuthorized
    case offline
    case failed
}

/// Where Next up reads calendar entries from. Production uses `JarvisBackendCalendarSource`; the unavailable source
/// is for builds without a backend client, where Today shows a calendar-unavailable row.
public protocol JarvisTodayCalendarSource: Sendable {
    func entries(from: Date, to: Date) async throws -> [JarvisTodayCalendarEntry]
}

public struct JarvisUnavailableCalendarSource: JarvisTodayCalendarSource {
    public init() {}
    public func entries(from: Date, to: Date) async throws -> [JarvisTodayCalendarEntry] {
        throw JarvisTodayDataError.unavailable
    }
}

/// Steps for the Today card: 24 hourly counts for the current day and a total for each of the last days.
public struct JarvisStepsSnapshot: Equatable, Sendable {
    /// Steps taken in each hour of the current day, index 0...23.
    public let hourly: [Int]
    /// Total steps for the start of each day.
    public let daily: [Date: Int]

    public init(hourly: [Int], daily: [Date: Int]) {
        self.hourly = hourly.count == 24 ? hourly.map { max($0, 0) } : Array(repeating: 0, count: 24)
        self.daily = daily.mapValues { max($0, 0) }
    }

    public static let empty = JarvisStepsSnapshot(hourly: [], daily: [:])
}

/// Where steps come from. The app implements this with HealthKit, where the owner has authorised it.
public protocol JarvisTodayStepsSource: Sendable {
    func steps(now: Date, days: Int) async throws -> JarvisStepsSnapshot
}

public struct JarvisUnavailableStepsSource: JarvisTodayStepsSource {
    public init() {}
    public func steps(now: Date, days: Int) async throws -> JarvisStepsSnapshot {
        throw JarvisTodayDataError.unavailable
    }
}

public enum JarvisTodayCorrelation {
    /// Notes whose title names the calendar entry (or the entry names the note), ignoring case and accents.
    public static func notes(for entry: JarvisTodayCalendarEntry, in notes: [VaultNoteSummary]) -> [VaultNoteSummary] {
        let key = normalized(entry.title)
        guard key.count >= 3 else { return [] }
        return notes.filter {
            let title = normalized($0.title)
            return title.count >= 3 && (title.contains(key) || key.contains(title))
        }
    }

    static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Splits open vault tasks into the two Today lists: due today, and everything else with a date.
public struct JarvisTodayTaskLists: Equatable, Sendable {
    public let today: [VaultTask]
    public let due: [VaultTask]

    public init(tasks: [VaultTask], today: String) {
        let groups = JarvisNotesLogic.taskGroups(tasks, today: today)
        self.today = groups.today
        self.due = groups.overdue + groups.upcoming
    }
}

/// The next calendar entries: still running or not started, soonest first.
public enum JarvisTodayAgenda {
    public static func upcoming(_ entries: [JarvisTodayCalendarEntry], now: Date) -> [JarvisTodayCalendarEntry] {
        entries.filter { $0.end > now }.sorted { $0.start < $1.start }
    }

    public static func nextEntry(_ entries: [JarvisTodayCalendarEntry], now: Date, calendar: Calendar) -> JarvisTodayCalendarEntry? {
        upcoming(entries, now: now).first { calendar.isDate($0.start, inSameDayAs: now) }
    }
}

/// How many items a list shows before its Expand control, and what Expand reveals.
public struct JarvisTodayExpansion: Equatable, Sendable {
    public static let cap = 3
    public let visible: Int
    public let hidden: Int

    public init(total: Int, isExpanded: Bool) {
        hidden = max(total - Self.cap, 0)
        visible = isExpanded ? total : min(total, Self.cap)
    }
}
