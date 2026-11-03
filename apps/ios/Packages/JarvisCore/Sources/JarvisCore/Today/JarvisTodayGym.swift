import Foundation

/// The five gym session types on the Today quick-log sheet and in the workouts donut.
public enum JarvisGymSessionType: String, CaseIterable, Identifiable, Sendable {
    case chest, back, arms, legs, cardio

    public var id: String { rawValue }

    var titleKey: JarvisTodayLocalizationKey {
        switch self {
        case .chest: .sessionChest
        case .back: .sessionBack
        case .arms: .sessionArms
        case .legs: .sessionLegs
        case .cardio: .sessionCardio
        }
    }

    var shortKey: JarvisTodayLocalizationKey {
        switch self {
        case .chest: .shortChest
        case .back: .shortBack
        case .arms: .shortArms
        case .legs: .shortLegs
        case .cardio: .shortCardio
        }
    }

    public func title(language: JarvisAppLanguage) -> String {
        JarvisTodayLocalization.string(titleKey, language: language)
    }

    public func shortTitle(language: JarvisAppLanguage) -> String {
        JarvisTodayLocalization.string(shortKey, language: language)
    }

    /// English title written into the vault note, so the note reads the same whatever the app language was.
    var vaultTitle: String {
        JarvisTodayLocalization.string(titleKey, language: .en)
    }
}

/// The lifts offered on the Home "Log lift" sheet. Each maps to the session it belongs to, so a lift is saved as a
/// normal gym log with that lift attached.
public enum JarvisGymLiftType: String, CaseIterable, Identifiable, Sendable {
    case benchPress, squat, deadlift, overheadPress, barbellRow, pullUp

    public var id: String { rawValue }

    public var session: JarvisGymSessionType {
        switch self {
        case .benchPress: .chest
        case .squat: .legs
        case .deadlift, .barbellRow, .pullUp: .back
        case .overheadPress: .arms
        }
    }

    var titleKey: JarvisTodayLocalizationKey {
        switch self {
        case .benchPress: .liftBenchPress
        case .squat: .liftSquat
        case .deadlift: .liftDeadlift
        case .overheadPress: .liftOverheadPress
        case .barbellRow: .liftBarbellRow
        case .pullUp: .liftPullUp
        }
    }

    public func title(language: JarvisAppLanguage) -> String {
        JarvisTodayLocalization.string(titleKey, language: language)
    }
}

/// One optional lift on a gym log.
public struct JarvisGymLift: Equatable, Sendable {
    public let exercise: String
    public let weightKg: Double
    public let reps: Int
    public let sets: Int

    public init(exercise: String, weightKg: Double, reps: Int, sets: Int) {
        self.exercise = exercise.trimmingCharacters(in: .whitespacesAndNewlines)
        self.weightKg = weightKg
        self.reps = reps
        self.sets = sets
    }

    public var isValid: Bool {
        !exercise.isEmpty && exercise.utf16.count <= 80
            && !exercise.unicodeScalars.contains { $0.value <= 0x1f || $0.value == 0x7f }
            && weightKg.isFinite && weightKg > 0 && weightKg <= 1000
            && (1...1000).contains(reps) && (1...100).contains(sets)
    }
}

/// A gym log as saved to the vault.
public struct JarvisGymLogEntry: Equatable, Sendable {
    public let performedAt: Date
    public let session: JarvisGymSessionType
    public let lift: JarvisGymLift?

    public init(performedAt: Date, session: JarvisGymSessionType, lift: JarvisGymLift? = nil) {
        self.performedAt = performedAt
        self.session = session
        self.lift = lift
    }
}

public enum JarvisGymLogError: Error, Equatable, Sendable {
    /// No backend path is wired for this store; nothing was written.
    case unavailable
    case invalidEntry
    /// The write may or may not have reached the vault.
    case outcomeUnknown
    case failed
}

/// Where a gym log is saved and read back. The production store writes through the existing vault notes path;
/// a store that cannot write must throw `.unavailable` instead of reporting success.
public protocol JarvisGymLogStore: Sendable {
    func save(_ entry: JarvisGymLogEntry) async throws
    /// Saved logs performed on or after `since`.
    func entries(since: Date) async throws -> [JarvisGymLogEntry]
}

/// Placeholder for builds with no vault connection. It never saves and never pretends to.
public struct JarvisUnavailableGymLogStore: JarvisGymLogStore {
    public init() {}
    public func save(_ entry: JarvisGymLogEntry) async throws { throw JarvisGymLogError.unavailable }
    public func entries(since: Date) async throws -> [JarvisGymLogEntry] { throw JarvisGymLogError.unavailable }
}

/// How a gym log maps to a vault note: `Personal/Gym log/<yyyy-MM-dd>-<HHmm>-<session>.md`.
/// The date and session are read back from the file name, so listing needs no note reads.
public enum JarvisGymLogNote {
    public static let folder = "Personal/Gym log"

    static func formatter(_ format: String, timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = format
        return formatter
    }

    public static func path(for entry: JarvisGymLogEntry, timeZone: TimeZone = .current) -> String {
        let stamp = formatter("yyyy-MM-dd-HHmm", timeZone: timeZone).string(from: entry.performedAt)
        return "\(folder)/\(stamp)-\(entry.session.rawValue).md"
    }

    public static func content(for entry: JarvisGymLogEntry, timeZone: TimeZone = .current) -> String {
        let day = formatter("yyyy-MM-dd", timeZone: timeZone).string(from: entry.performedAt)
        let time = formatter("HH:mm", timeZone: timeZone).string(from: entry.performedAt)
        var lines = [
            "---",
            "type: gym-log",
            "session: \(entry.session.rawValue)",
            "date: \(day)",
            "time: \(time)",
            "---",
            "",
            "# Gym log: \(entry.session.vaultTitle)",
            "",
            "- Date: \(day) \(time)",
            "- Session: \(entry.session.vaultTitle)",
        ]
        if let lift = entry.lift {
            let weight = lift.weightKg.rounded() == lift.weightKg
                ? String(Int(lift.weightKg)) : String(lift.weightKg)
            lines.append("- Lift: \(lift.exercise.replacingOccurrences(of: "\n", with: " ")) · \(weight) kg × \(lift.reps) × \(lift.sets)")
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// The date and session a note path encodes, or nil when the path is not a gym log.
    public static func parse(path: String, timeZone: TimeZone = .current) -> (performedAt: Date, session: JarvisGymSessionType)? {
        let prefix = folder + "/"
        guard path.hasPrefix(prefix), path.hasSuffix(".md") else { return nil }
        let name = String(path.dropFirst(prefix.count).dropLast(3))
        let parts = name.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 5, let session = JarvisGymSessionType(rawValue: parts[4]),
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2, parts[3].count == 4,
              let date = formatter("yyyy-MM-dd-HHmm", timeZone: timeZone)
                .date(from: parts[0...3].joined(separator: "-")) else { return nil }
        return (date, session)
    }
}

/// Saves gym logs as vault notes through the existing notes routes (`POST /notes`, `GET /notes`).
public struct JarvisVaultGymLogStore: JarvisGymLogStore {
    private let client: JarvisNotesClient
    private let timeZone: TimeZone
    private let maximumPages = 4

    public init(client: JarvisNotesClient, timeZone: TimeZone = .current) {
        self.client = client
        self.timeZone = timeZone
    }

    public func save(_ entry: JarvisGymLogEntry) async throws {
        if let lift = entry.lift, !lift.isValid { throw JarvisGymLogError.invalidEntry }
        let path = JarvisGymLogNote.path(for: entry, timeZone: timeZone)
        guard JarvisNotesLogic.validNotePath(path) else { throw JarvisGymLogError.invalidEntry }
        do {
            _ = try await client.createNote(path: path, content: JarvisGymLogNote.content(for: entry, timeZone: timeZone))
        } catch let error as JarvisNotesClientError {
            if case .writeOutcomeUnknown = error { throw JarvisGymLogError.outcomeUnknown }
            throw JarvisGymLogError.failed
        } catch let error as JarvisClientError {
            switch error {
            case .networkFailure, .timedOut, .serviceUnavailable, .responseDecodingFailure:
                throw JarvisGymLogError.outcomeUnknown
            default:
                throw JarvisGymLogError.failed
            }
        } catch {
            throw JarvisGymLogError.failed
        }
    }

    public func entries(since: Date) async throws -> [JarvisGymLogEntry] {
        var result: [JarvisGymLogEntry] = []
        var offset = 0
        for _ in 0..<maximumPages {
            let page = try await client.notes(directory: JarvisGymLogNote.folder, offset: offset)
            for note in page.notes {
                guard let parsed = JarvisGymLogNote.parse(path: note.path, timeZone: timeZone),
                      parsed.performedAt >= since else { continue }
                result.append(JarvisGymLogEntry(performedAt: parsed.performedAt, session: parsed.session))
            }
            guard page.hasMore else { break }
            offset += page.limit
        }
        return result.sorted { $0.performedAt > $1.performedAt }
    }
}
