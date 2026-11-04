import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// One HealthKit quantity reading, already converted to the unit named in `unit`.
public struct JarvisHealthSample: Equatable, Sendable {
    public let metric: String
    public let unit: String
    public let start: Date
    public let end: Date
    public let value: Double
    public let source: String?

    public init(metric: String, unit: String, start: Date, end: Date, value: Double, source: String? = nil) {
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
    public let stage: String
    public let start: Date
    public let end: Date
    public let source: String?

    public init(stage: String, start: Date, end: Date, source: String? = nil) {
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

/// Builds the Health Auto Export-shaped JSON the existing `/api/health/ingest` path already normalises,
/// so iPhone data lands in the same tables as the automations app. Output is canonical (sorted keys, stable order):
/// the same data always yields the same bytes, which is what makes retries idempotent.
public enum JarvisHealthPayloadBuilder {
    public static func payload(_ batch: JarvisHealthSyncBatch) throws -> Data {
        var metrics: [[String: Any]] = []
        let byMetric = Dictionary(grouping: batch.samples, by: { "\($0.metric)\u{0}\($0.unit)" })
        for key in byMetric.keys.sorted() {
            let group = (byMetric[key] ?? []).sorted { ($0.start, $0.value) < ($1.start, $1.value) }
            guard let first = group.first else { continue }
            metrics.append([
                "name": first.metric,
                "units": first.unit,
                "data": group.map { sample -> [String: Any] in
                    var row: [String: Any] = ["date": iso(sample.start), "qty": sample.value]
                    if let source = sample.source { row["source"] = source }
                    return row
                },
            ])
        }
        if !batch.sleep.isEmpty {
            let segments = batch.sleep.sorted { ($0.start, $0.stage) < ($1.start, $1.stage) }
            metrics.append([
                "name": "sleep_analysis",
                "units": "hr",
                "data": segments.map { segment -> [String: Any] in
                    var row: [String: Any] = [
                        "startDate": iso(segment.start), "endDate": iso(segment.end),
                        "date": iso(segment.end), "value": segment.stage,
                        "qty": max(0, segment.end.timeIntervalSince(segment.start)) / 3600,
                    ]
                    if let source = segment.source { row["source"] = source }
                    return row
                },
            ])
        }
        let workouts = batch.workouts.sorted { ($0.start, $0.id) < ($1.start, $1.id) }.map { workout -> [String: Any] in
            var row: [String: Any] = [
                "id": workout.id, "name": workout.activity,
                "start": iso(workout.start), "end": iso(workout.end),
                "duration": max(0, workout.end.timeIntervalSince(workout.start)),
            ]
            if let kcal = workout.activeEnergyKcal { row["activeEnergyBurned"] = ["qty": kcal, "units": "kcal"] }
            if let metres = workout.distanceMetres { row["distance"] = ["qty": metres / 1000, "units": "km"] }
            return row
        }
        let body: [String: Any] = ["data": ["metrics": metrics, "workouts": workouts]]
        return try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }

    /// Same bytes give the same id, so a retry of an accepted upload is acknowledged instead of stored twice,
    /// and changed data gets a new id.
    public static func sessionId(for payload: Data) -> String {
        "ios-" + digest(payload)
    }

    static func digest(_ data: Data) -> String {
        #if canImport(CryptoKit)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #else
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in data { hash = (hash ^ UInt64(byte)) &* 0x100_0000_01b3 }
        return String(format: "%016llx", hash)
        #endif
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

/// Sends one payload to the existing Health ingest path. The real sender uses the Health upload credential.
public protocol JarvisHealthIngestSender: Sendable {
    func send(payload: Data, automationId: String, sessionId: String) async throws
}

/// Reads and uploads one batch, then reports truthfully: `complete` only when every type was read and sent.
public struct JarvisHealthSyncRunner: Sendable {
    public static let automationId = "jarvis-ios"

    private let sender: JarvisHealthIngestSender
    private let now: @Sendable () -> Date

    public init(sender: JarvisHealthIngestSender, now: @escaping @Sendable () -> Date = { Date() }) {
        self.sender = sender
        self.now = now
    }

    public func sync(_ batch: JarvisHealthSyncBatch) async -> JarvisHealthSyncState {
        guard !batch.readTypes.isEmpty else { return .failed }
        do {
            if !batch.isEmpty {
                let payload = try JarvisHealthPayloadBuilder.payload(batch)
                try await sender.send(
                    payload: payload,
                    automationId: Self.automationId,
                    sessionId: JarvisHealthPayloadBuilder.sessionId(for: payload)
                )
            }
        } catch {
            return .failed
        }
        let missing = batch.deniedOrUnreadTypes.sorted()
        return missing.isEmpty ? .complete(at: now()) : .partial(at: now(), missingTypes: missing)
    }
}

/// Production sender: posts to `/api/health/ingest` with the Health upload credential and the idempotency headers.
public struct JarvisHealthURLSessionSender: JarvisHealthIngestSender {
    private let baseURL: URL
    private let token: @Sendable () async throws -> String
    private let session: URLSession

    public init(baseURL: URL, token: @escaping @Sendable () async throws -> String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    public func send(payload: Data, automationId: String, sessionId: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/health/ingest"))
        request.httpMethod = "POST"
        request.httpBody = payload
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let secret = try await token()
        request.setValue("Bearer " + secret, forHTTPHeaderField: "Authorization")
        request.setValue(automationId, forHTTPHeaderField: "Automation-Id")
        request.setValue(sessionId, forHTTPHeaderField: "Session-Id")
        request.setValue(JarvisHealthPayloadBuilder.digest(payload), forHTTPHeaderField: "X-Payload-Checksum")
        let (_, response) = try await session.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode else { throw JarvisHealthSyncError.unavailable }
        guard (200..<300).contains(status) else {
            throw status >= 500 || status == 429 ? JarvisHealthSyncError.unavailable : JarvisHealthSyncError.rejected
        }
    }
}
