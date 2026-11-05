import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One HealthKit quantity reading, already converted to the unit named in `unit`.
public struct JarvisHealthSample: Equatable, Sendable {
    public let id: String
    public let metric: String
    public let unit: String
    public let start: Date
    public let end: Date
    public let value: Double
    public let source: String?

    public init(id: String, metric: String, unit: String, start: Date, end: Date, value: Double, source: String? = nil) {
        self.id = id
        self.metric = metric
        self.unit = unit
        self.start = start
        self.end = end
        self.value = value
        self.source = source
    }
}

/// One HealthKit sleep-analysis segment. `stage` is core, deep, rem, asleep, awake or in_bed.
public struct JarvisHealthSleepSegment: Equatable, Sendable {
    public let id: String
    public let stage: String
    public let start: Date
    public let end: Date
    public let source: String?

    public init(id: String, stage: String, start: Date, end: Date, source: String? = nil) {
        self.id = id
        self.stage = stage
        self.start = start
        self.end = end
        self.source = source
    }
}

public struct JarvisHealthWorkoutSample: Equatable, Sendable {
    public let id: String
    public let activity: String
    public let start: Date
    public let end: Date
    public let activeEnergyKcal: Double?
    public let distanceMetres: Double?

    public init(
        id: String, activity: String, start: Date, end: Date,
        activeEnergyKcal: Double? = nil, distanceMetres: Double? = nil
    ) {
        self.id = id
        self.activity = activity
        self.start = start
        self.end = end
        self.activeEnergyKcal = activeEnergyKcal
        self.distanceMetres = distanceMetres
    }
}

/// What was read for one sync. `deniedOrUnreadTypes` names every type the user did not permit or that failed to read,
/// so the app can say the sync is partial instead of showing it as complete.
public struct JarvisHealthSyncBatch: Equatable, Sendable {
    public let samples: [JarvisHealthSample]
    public let sleep: [JarvisHealthSleepSegment]
    public let workouts: [JarvisHealthWorkoutSample]
    public let readTypes: [String]
    public let deniedOrUnreadTypes: [String]
    public let windowStart: Date
    public let windowEnd: Date

    public init(
        samples: [JarvisHealthSample], sleep: [JarvisHealthSleepSegment], workouts: [JarvisHealthWorkoutSample],
        readTypes: [String], deniedOrUnreadTypes: [String], windowStart: Date, windowEnd: Date
    ) {
        self.samples = samples
        self.sleep = sleep
        self.workouts = workouts
        self.readTypes = readTypes
        self.deniedOrUnreadTypes = deniedOrUnreadTypes
        self.windowStart = windowStart
        self.windowEnd = windowEnd
    }

    public var isEmpty: Bool { samples.isEmpty && sleep.isEmpty && workouts.isEmpty }
}

public enum JarvisHealthSyncState: Equatable, Sendable {
    case neverSynced
    case complete(at: Date)
    case partial(at: Date, missingTypes: [String])
    case failed
}

/// The request body of `POST /health/sync`. Every sample carries its HealthKit UUID, so the backend can tell a
/// repeat from new data. Keys are sorted and rows ordered, so identical data always encodes to identical bytes.
public struct JarvisHealthSyncRequest: Equatable, Sendable {
    public let anchor: Date?
    public let samples: [JarvisHealthSample]
    public let sleep: [JarvisHealthSleepSegment]
    public let workouts: [JarvisHealthWorkoutSample]

    public init(
        anchor: Date?, samples: [JarvisHealthSample] = [], sleep: [JarvisHealthSleepSegment] = [],
        workouts: [JarvisHealthWorkoutSample] = []
    ) {
        self.anchor = anchor
        self.samples = samples
        self.sleep = sleep
        self.workouts = workouts
    }

    public static let maximumItems = 20_000

    /// A request contains a complete metric day (or sleep end-day), matching the server's replacement grain.
    /// A long backlog can exceed the request limit overall without truncating or splitting a cumulative day.
    public static func requests(for batch: JarvisHealthSyncBatch, anchor: Date?) -> [JarvisHealthSyncRequest] {
        let calendar = JarvisHealthSyncWindow.calendar
        let byMetric = Dictionary(grouping: batch.samples, by: \.metric)
        var requests: [JarvisHealthSyncRequest] = []
        for metric in byMetric.keys.sorted() {
            let days = Dictionary(grouping: byMetric[metric] ?? []) { calendar.startOfDay(for: $0.start) }
            for day in days.keys.sorted() {
                requests.append(JarvisHealthSyncRequest(anchor: anchor, samples: days[day] ?? []))
            }
        }
        let nights = Dictionary(grouping: batch.sleep) { calendar.startOfDay(for: $0.end) }
        for day in nights.keys.sorted() {
            requests.append(JarvisHealthSyncRequest(anchor: anchor, sleep: nights[day] ?? []))
        }
        let workouts = batch.workouts.sorted { $0.id < $1.id }
        for offset in stride(from: 0, to: workouts.count, by: maximumItems) {
            requests.append(JarvisHealthSyncRequest(anchor: anchor,
                workouts: Array(workouts[offset..<min(offset + maximumItems, workouts.count)])))
        }
        return requests
    }

    public func encoded() throws -> Data {
        var body: [String: Any] = [
            "samples": samples.sorted { $0.id < $1.id }.map { sample -> [String: Any] in
                var row: [String: Any] = [
                    "id": sample.id, "metric": sample.metric, "unit": sample.unit,
                    "start": Self.iso(sample.start), "end": Self.iso(sample.end), "value": sample.value,
                ]
                if let source = sample.source { row["source"] = source }
                return row
            },
            "sleep": sleep.sorted { $0.id < $1.id }.map { segment -> [String: Any] in
                var row: [String: Any] = [
                    "id": segment.id, "stage": segment.stage,
                    "start": Self.iso(segment.start), "end": Self.iso(segment.end),
                ]
                if let source = segment.source { row["source"] = source }
                return row
            },
            "workouts": workouts.sorted { $0.id < $1.id }.map { workout -> [String: Any] in
                var row: [String: Any] = [
                    "id": workout.id, "activity": workout.activity,
                    "start": Self.iso(workout.start), "end": Self.iso(workout.end),
                ]
                if let kcal = workout.activeEnergyKcal { row["activeEnergyKcal"] = kcal }
                if let metres = workout.distanceMetres { row["distanceMetres"] = metres }
                return row
            },
        ]
        if let anchor { body["anchor"] = Self.iso(anchor) }
        return try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

public enum JarvisHealthSyncError: Error, Equatable, Sendable {
    case rejected
    case unavailable
}

public protocol JarvisHealthSyncSender: Sendable {
    func send(_ request: JarvisHealthSyncRequest) async throws
}

/// Where the sync remembers how far it got. The anchor is the end of the last window that was read completely.
public protocol JarvisHealthSyncAnchorStore: Sendable {
    var anchor: Date? { get }
    var lastSync: Date? { get }
    func save(anchor: Date, lastSync: Date)
}

public final class JarvisHealthUserDefaultsAnchorStore: JarvisHealthSyncAnchorStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let anchorKey = "jarvis.health.sync.anchor"
    private let lastSyncKey = "jarvis.health.sync.lastSync"

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var anchor: Date? { defaults.object(forKey: anchorKey) as? Date }
    public var lastSync: Date? { defaults.object(forKey: lastSyncKey) as? Date }

    public func save(anchor: Date, lastSync: Date) {
        defaults.set(anchor, forKey: anchorKey)
        defaults.set(lastSync, forKey: lastSyncKey)
    }
}

/// Incremental window: from the start of the day of the anchor, so a metric day is always re-sent whole.
/// Without an anchor (first sync) it reaches back `firstSyncDays`.
public enum JarvisHealthSyncWindow {
    public static let firstSyncDays = 7

    public static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
        return calendar
    }

    public static func recentStart(now: Date, days: Int = 30, calendar: Calendar = Self.calendar) -> Date {
        let today = calendar.startOfDay(for: now)
        return calendar.date(byAdding: .day, value: -(max(days, 1) - 1), to: today) ?? today
    }

    public static func start(anchor: Date?, now: Date, calendar: Calendar = Self.calendar) -> Date {
        guard let anchor else {
            return recentStart(now: now, days: firstSyncDays, calendar: calendar)
        }
        return calendar.startOfDay(for: min(anchor, now))
    }
}

/// Uploads one batch, then reports truthfully: `complete` only when every type was read and sent. Only a
/// complete sync moves the anchor, so a type that failed to read is read again next time.
public struct JarvisHealthSyncRunner: Sendable {
    private let sender: JarvisHealthSyncSender
    private let store: JarvisHealthSyncAnchorStore
    private let now: @Sendable () -> Date

    public init(
        sender: JarvisHealthSyncSender, store: JarvisHealthSyncAnchorStore,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.sender = sender
        self.store = store
        self.now = now
    }

    public func sync(_ batch: JarvisHealthSyncBatch) async -> JarvisHealthSyncState {
        guard !batch.readTypes.isEmpty else { return .failed }
        do {
            let requests = JarvisHealthSyncRequest.requests(for: batch, anchor: store.anchor)
            // Refuse a single oversized day before writing anything; never overwrite it with a truncated total.
            guard requests.allSatisfy({ $0.samples.count + $0.sleep.count + $0.workouts.count <= JarvisHealthSyncRequest.maximumItems }) else {
                return .failed
            }
            for request in requests {
                try Task.checkCancellation()
                try await sender.send(request)
            }
        } catch {
            return .failed
        }
        let finished = now()
        let missing = batch.deniedOrUnreadTypes.sorted()
        guard missing.isEmpty else { return .partial(at: finished, missingTypes: missing) }
        store.save(anchor: batch.windowEnd, lastSync: finished)
        return .complete(at: finished)
    }
}
