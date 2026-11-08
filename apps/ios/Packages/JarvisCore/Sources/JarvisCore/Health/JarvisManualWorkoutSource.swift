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
