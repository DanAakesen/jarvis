import Foundation

/// The small, versioned snapshot the app writes into the App Group for the Gym, Factory, Notes and Home widgets.
/// It holds display data only: no tokens, secrets or identifiers beyond the opaque task and confirmation ids a
/// widget button needs. Each section is written and aged on its own, so a failed Factory refresh never hides Gym.
public struct JarvisWidgetSnapshot: Codable, Equatable, Sendable {
    public static let currentVersion = 1
    public static let appGroupIdentifier = "group.com.danaakesen.jarvis"
    public static let days = 7

    public var version: Int
    public var language: String
    public var gym: Section<JarvisGymWidgetData>
    public var factory: Section<JarvisFactoryWidgetData>
    public var notes: Section<JarvisNotesWidgetData>
    public var home: Section<JarvisHomeWidgetData>

    public init(
        language: JarvisAppLanguage = .default,
        gym: Section<JarvisGymWidgetData> = .init(),
        factory: Section<JarvisFactoryWidgetData> = .init(),
        notes: Section<JarvisNotesWidgetData> = .init(),
        home: Section<JarvisHomeWidgetData> = .init()
    ) {
        version = Self.currentVersion
        self.language = language.rawValue
        self.gym = gym
        self.factory = factory
        self.notes = notes
        self.home = home
    }

    /// Snapshots written before the Notes and Home sections existed still decode: the missing sections read as loading.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        language = try container.decode(String.self, forKey: .language)
        gym = try container.decode(Section<JarvisGymWidgetData>.self, forKey: .gym)
        factory = try container.decode(Section<JarvisFactoryWidgetData>.self, forKey: .factory)
        notes = try container.decodeIfPresent(Section<JarvisNotesWidgetData>.self, forKey: .notes) ?? .init()
        home = try container.decodeIfPresent(Section<JarvisHomeWidgetData>.self, forKey: .home) ?? .init()
    }

    public var appLanguage: JarvisAppLanguage { JarvisAppLanguage(rawValue: language) ?? .default }

    /// What the app last knew about one widget topic. `value` is kept when a later refresh fails, so the widget
    /// shows the old numbers marked as stale instead of going blank.
    public struct Section<Value: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
        public enum Status: String, Codable, Sendable {
            case ok, loading, error, offline
        }

        public var status: Status
        public var value: Value?

        public init(status: Status = .loading, value: Value? = nil) {
            self.status = status
            self.value = value
        }
    }
}

public struct JarvisGymWidgetData: Codable, Equatable, Sendable {
    public struct Week: Codable, Equatable, Sendable {
        public var weekNumber: Int
        public var lifts: Int
        public var runs: Int

        public init(weekNumber: Int, lifts: Int, runs: Int) {
            self.weekNumber = weekNumber
            self.lifts = max(lifts, 0)
            self.runs = max(runs, 0)
        }
    }

    public var generatedAt: Date
    /// Start of the day of the last (today's) bar and dot.
    public var lastDay: Date
    public var stepGoal: Int
    /// Steps for the last seven days, oldest first; the last value is today.
    public var dailySteps: [Int]
    public var liftsDone: Int
    public var liftsTarget: Int
    public var runsDone: Int
    public var runsTarget: Int
    /// Whether a workout was logged on each of the last seven days, oldest first.
    public var trainedDays: [Bool]
    public var kilometers: Double
    public var calories: Int
    /// The last seven weeks, oldest first; the last is the current week.
    public var weeks: [Week]

    public init(
        generatedAt: Date,
        lastDay: Date,
        stepGoal: Int,
        dailySteps: [Int],
        liftsDone: Int,
        liftsTarget: Int,
        runsDone: Int,
        runsTarget: Int,
        trainedDays: [Bool],
        kilometers: Double,
        calories: Int,
        weeks: [Week]
    ) {
        let days = JarvisWidgetSnapshot.days
        self.generatedAt = generatedAt
        self.lastDay = lastDay
        self.stepGoal = max(stepGoal, 0)
        self.dailySteps = Self.fitted(dailySteps.map { max($0, 0) }, to: days, filler: 0)
        self.liftsDone = max(liftsDone, 0)
        self.liftsTarget = max(liftsTarget, 0)
        self.runsDone = max(runsDone, 0)
        self.runsTarget = max(runsTarget, 0)
        self.trainedDays = Self.fitted(trainedDays, to: days, filler: false)
        self.kilometers = kilometers.isFinite ? max(kilometers, 0) : 0
        self.calories = max(calories, 0)
        self.weeks = Array(weeks.suffix(days))
    }

    private static func fitted<Element>(_ values: [Element], to count: Int, filler: Element) -> [Element] {
        let tail = Array(values.suffix(count))
        return Array(repeating: filler, count: count - tail.count) + tail
    }

    public var stepsToday: Int { dailySteps.last ?? 0 }
    public var averageSteps: Int { dailySteps.isEmpty ? 0 : dailySteps.reduce(0, +) / dailySteps.count }
    public var workoutsDone: Int { liftsDone + runsDone }
    public var workoutsTarget: Int { liftsTarget + runsTarget }
    public var isEmpty: Bool {
        dailySteps.allSatisfy { $0 == 0 } && workoutsDone == 0 && weeks.allSatisfy { $0.lifts + $0.runs == 0 }
    }
}

public struct JarvisFactoryWidgetData: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable {
        case running, awaiting, review, failed
    }

    /// An immediate action a widget button may perform. Anything needing details or a dialog is not listed here.
    public enum Action: String, Codable, Sendable {
        case approve, pause, resume, retry
    }

    public struct Task: Codable, Equatable, Identifiable, Sendable {
        public var id: String
        public var title: String
        public var detail: String
        public var status: Status
        public var action: Action?

        public init(id: String, title: String, detail: String, status: Status, action: Action? = nil) {
            self.id = id
            self.title = title
            self.detail = detail
            self.status = status
            self.action = action
        }
    }

    public var generatedAt: Date
    /// Start of the day of the last bar of `doneLast7Days`.
    public var lastDay: Date
    public var running: Int
    public var awaiting: Int
    public var review: Int
    public var failed: Int
    /// Tasks finished on each of the last seven days, oldest first.
    public var doneLast7Days: [Int]
    public var tasks: [Task]

    public init(
        generatedAt: Date,
        lastDay: Date,
        running: Int,
        awaiting: Int,
        review: Int,
        failed: Int,
        doneLast7Days: [Int],
        tasks: [Task]
    ) {
        let days = JarvisWidgetSnapshot.days
        self.generatedAt = generatedAt
        self.lastDay = lastDay
        self.running = max(running, 0)
        self.awaiting = max(awaiting, 0)
        self.review = max(review, 0)
        self.failed = max(failed, 0)
        let tail = Array(doneLast7Days.map { max($0, 0) }.suffix(days))
        self.doneLast7Days = Array(repeating: 0, count: days - tail.count) + tail
        self.tasks = Array(tasks.prefix(5))
    }

    public var doneTotal: Int { doneLast7Days.reduce(0, +) }
    public var isEmpty: Bool { running + awaiting + review + failed == 0 && doneTotal == 0 && tasks.isEmpty }

    public func count(_ status: Status) -> Int {
        switch status {
        case .running: running
        case .awaiting: awaiting
        case .review: review
        case .failed: failed
        }
    }
}

/// What the Notes widgets show: today's open tasks and the latest notes, as display text and dates only.
public struct JarvisNotesWidgetData: Codable, Equatable, Sendable {
    public struct Task: Codable, Equatable, Identifiable, Sendable {
        public var id: String
        public var title: String
        /// "HH:mm" when the task has a time of day.
        public var time: String?
        public var dueDate: Date?

        public init(id: String, title: String, time: String? = nil, dueDate: Date? = nil) {
            self.id = id
            self.title = title
            self.time = time
            self.dueDate = dueDate
        }
    }

    public struct Note: Codable, Equatable, Identifiable, Sendable {
        public var id: String
        public var title: String
        public var editedAt: Date

        public init(id: String, title: String, editedAt: Date) {
            self.id = id
            self.title = title
            self.editedAt = editedAt
        }
    }

    public static let maxTasks = 5
    public static let maxNotes = 3

    public var generatedAt: Date
    /// How many tasks are due today; `tasks` holds the first few.
    public var tasksToday: Int
    public var tasks: [Task]
    public var notes: [Note]

    public init(generatedAt: Date, tasksToday: Int, tasks: [Task], notes: [Note]) {
        self.generatedAt = generatedAt
        self.tasksToday = max(tasksToday, tasks.count, 0)
        self.tasks = Array(tasks.prefix(Self.maxTasks))
        self.notes = Array(notes.prefix(Self.maxNotes))
    }

    public var isEmpty: Bool { tasksToday == 0 && notes.isEmpty }
}

/// What the Home widgets add to the Gym, Factory and Notes data they also show: what needs Dan, and what is running.
public struct JarvisHomeWidgetData: Codable, Equatable, Sendable {
    public var generatedAt: Date
    public var approvals: Int
    public var running: Int

    public init(generatedAt: Date, approvals: Int, running: Int) {
        self.generatedAt = generatedAt
        self.approvals = max(approvals, 0)
        self.running = max(running, 0)
    }
}

/// Reads and writes the snapshot as one JSON file in a shared directory (the App Group container in production).
/// A missing, unreadable, corrupt or newer-version file is reported, never guessed at.
public struct JarvisWidgetSnapshotStore: Sendable {
    public static let fileName = "widget-snapshot.json"

    public enum LoadResult: Equatable, Sendable {
        case missing
        case unreadable
        case snapshot(JarvisWidgetSnapshot)
    }

    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    #if canImport(Darwin)
    public static func appGroup() -> JarvisWidgetSnapshotStore? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: JarvisWidgetSnapshot.appGroupIdentifier)
            .map(JarvisWidgetSnapshotStore.init(directory:))
    }
    #endif

    private var fileURL: URL { directory.appendingPathComponent(Self.fileName) }

    public func load() -> LoadResult {
        guard let data = try? Data(contentsOf: fileURL) else {
            return FileManager.default.fileExists(atPath: fileURL.path) ? .unreadable : .missing
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let snapshot = try? decoder.decode(JarvisWidgetSnapshot.self, from: data),
              snapshot.version == JarvisWidgetSnapshot.currentVersion else {
            return .unreadable
        }
        return .snapshot(snapshot)
    }

    public func save(_ snapshot: JarvisWidgetSnapshot) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(snapshot).write(to: fileURL, options: .atomic)
    }
}
