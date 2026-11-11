import Foundation

/// Includes sessions saved by Jarvis in Home and Health even while the vault copy is pending.
/// Legacy app logs remain a separate compatibility source; this adapter performs no writes.
public struct JarvisManualWorkoutSource: JarvisGymLogStore {
    private let client: JarvisHealthClient

    public init(client: JarvisHealthClient) { self.client = client }

    public func save(_ entry: JarvisGymLogEntry) async throws {
        throw JarvisGymLogError.unavailable
    }

    public func entries(since: Date) async throws -> [JarvisGymLogEntry] {
        let entries = try await client.recentWorkouts(limit: 100)
        return try entries.compactMap { entry in
            guard let date = entry.startedAtDate else { throw JarvisHealthClientError.invalidResponse }
            guard date >= since else { return nil }
            let session: JarvisGymSessionType = switch entry.sessionType {
            case .chestTricepsCore: .chest
            case .backBicepsCore: .back
            case .armsShoulders: .arms
            case .legsCore: .legs
            case .cardio: .cardio
            case .other: .other
            }
            return JarvisGymLogEntry(performedAt: date, session: session,
                durationMinutes: Double(entry.durationMinutes ?? 0), manualWorkoutID: entry.id)
        }
    }
}

public struct JarvisSyncedWorkoutSource: JarvisGymLogStore {
    private let client: JarvisHealthClient

    public init(client: JarvisHealthClient) { self.client = client }

    public func save(_ entry: JarvisGymLogEntry) async throws { throw JarvisGymLogError.unavailable }

    public func entries(since: Date) async throws -> [JarvisGymLogEntry] {
        let start = JarvisHealthPeriod.make(.today, now: since).startDate
        let end = JarvisHealthPeriod.make(.today).endDate
        guard let period = JarvisHealthPeriod(startDate: start, endDate: end) else { return [] }
        let result = try await client.queryAll(.init(source: .workouts, period: period, limit: 500))
        guard result.status == "available" || result.status == "empty" else {
            throw JarvisHealthClientError.invalidResponse
        }
        let formatter = ISO8601DateFormatter()
        func text(_ value: JSONValue?) -> String? {
            guard case .string(let text) = value else { return nil }
            return text
        }
        func number(_ value: JSONValue?) -> Double? {
            guard case .number(let number) = value else { return nil }
            return number
        }
        return try result.items.compactMap { row in
            guard let stamp = text(row["start_at"]) else { throw JarvisHealthClientError.invalidResponse }
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var date = formatter.date(from: stamp)
            if date == nil {
                formatter.formatOptions = [.withInternetDateTime]
                date = formatter.date(from: stamp)
            }
            guard let date else { throw JarvisHealthClientError.invalidResponse }
            guard date >= since else { return nil }
            let raw = text(row["workout_type"])
            let session: JarvisGymSessionType
            switch JarvisHealthLogic.workoutKind(raw) {
            case .gym: session = .strength
            case .run: session = .cardio
            case .other: session = .other
            }
            return JarvisGymLogEntry(performedAt: date, session: session,
                durationMinutes: (number(row["duration_seconds"]) ?? 0) / 60,
                activeKilocalories: number(row["active_energy_value"]) ?? 0,
                healthKitID: text(row["id"]), healthActivity: raw)
        }
    }
}
