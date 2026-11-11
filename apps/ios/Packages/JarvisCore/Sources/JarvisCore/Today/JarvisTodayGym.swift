import Foundation

/// The five gym session types on the Today quick-log sheet and in the workouts donut.
public enum JarvisGymSessionType: String, CaseIterable, Identifiable, Sendable {
    case chest, back, arms, legs, cardio
    /// Apple Health strength workouts carry no muscle group, so they get their own type. Never offered for manual logging.
    case strength
    /// Any other Apple Health workout (yoga, tennis, ...). Never offered for manual logging.
    case other

    public var id: String { rawValue }

    /// The sessions a person can pick when logging a gym session by hand.
    public static let loggable: [JarvisGymSessionType] = [.chest, .back, .arms, .legs, .cardio]

    var titleKey: JarvisTodayLocalizationKey {
        switch self {
        case .chest: .sessionChest
        case .back: .sessionBack
        case .arms: .sessionArms
        case .legs: .sessionLegs
        case .cardio: .sessionCardio
        case .strength: .sessionStrength
        case .other: .sessionOther
        }
    }

    var shortKey: JarvisTodayLocalizationKey {
        switch self {
        case .chest: .shortChest
        case .back: .shortBack
        case .arms: .shortArms
        case .legs: .shortLegs
        case .cardio: .shortCardio
        case .strength: .shortStrength
        case .other: .shortOther
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
    public let vaultNote: VaultNote?
    public let performedAt: Date
    public let session: JarvisGymSessionType
    public let lift: JarvisGymLift?
    /// Workout length in minutes and active energy in kilocalories; zero when the source does not know them.
    public let durationMinutes: Double
    public let activeKilocalories: Double
    public let manualWorkoutID: String?
    public let healthKitID: String?
    public let healthActivity: String?

    public init(
        performedAt: Date,
        session: JarvisGymSessionType,
        lift: JarvisGymLift? = nil,
        durationMinutes: Double = 0,
        activeKilocalories: Double = 0,
        manualWorkoutID: String? = nil,
        healthKitID: String? = nil,
        healthActivity: String? = nil,
        vaultNote: VaultNote? = nil
    ) {
        self.performedAt = performedAt
        self.session = session
        self.lift = lift
        self.durationMinutes = durationMinutes
        self.activeKilocalories = activeKilocalories
        self.manualWorkoutID = manualWorkoutID
        self.healthKitID = healthKitID
        self.healthActivity = healthActivity
        self.vaultNote = vaultNote
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
    // Notes list in path order (oldest first), so reaching this month's logs can take many pages.
    private let maximumPages = 20

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

/// Reads gym logs from the vault and from other sources (Health workouts) and writes only to the vault. One source
/// failing does not hide the others; an error is thrown only when every source fails. Matching sessions within
/// two hours count once, retaining the primary log and filling missing metrics/identities from the other source.
public struct JarvisCombinedGymLogStore: JarvisGymLogStore {
    private let primary: any JarvisGymLogStore
    private let others: [any JarvisGymLogStore]

    public init(primary: any JarvisGymLogStore, others: [any JarvisGymLogStore]) {
        self.primary = primary
        self.others = others
    }

    public func save(_ entry: JarvisGymLogEntry) async throws {
        try await primary.save(entry)
    }

    /// A Health workout matches a vault log of the same session. A Health strength workout has no muscle group, so it
    /// matches any vault log that is not cardio.
    static func sameWorkout(_ vault: JarvisGymSessionType, _ health: JarvisGymSessionType) -> Bool {
        if vault == health { return true }
        return health == .strength && vault != .cardio && vault != .other
    }

    public func entries(since: Date) async throws -> [JarvisGymLogEntry] {
        var firstError: Error?
        var primaryEntries: [JarvisGymLogEntry] = []
        var succeeded = false
        do {
            primaryEntries = try await primary.entries(since: since)
            succeeded = true
        } catch {
            firstError = error
        }
        var merged = primaryEntries
        for store in others {
            do {
                let extra = try await store.entries(since: since)
                succeeded = true
                var matched = Set<Int>()
                for candidate in extra {
                    // One source row can enrich only one primary row. Pick the nearest log,
                    // so several nearby lifts cannot each receive the same workout's totals.
                    let index = primaryEntries.indices.filter {
                        guard !matched.contains($0) else { return false }
                        if let existingID = primaryEntries[$0].healthKitID, let candidateID = candidate.healthKitID {
                            return existingID.lowercased() == candidateID.lowercased()
                        }
                        return Self.sameWorkout(primaryEntries[$0].session, candidate.session)
                            && abs(primaryEntries[$0].performedAt.timeIntervalSince(candidate.performedAt)) < 7200
                    }.min {
                        abs(primaryEntries[$0].performedAt.timeIntervalSince(candidate.performedAt))
                            < abs(primaryEntries[$1].performedAt.timeIntervalSince(candidate.performedAt))
                    }
                    guard let index else {
                        merged.append(candidate)
                        continue
                    }
                    matched.insert(index)
                    let existing = merged[index]
                    merged[index] = JarvisGymLogEntry(
                        performedAt: existing.performedAt, session: existing.session,
                        lift: existing.lift ?? candidate.lift,
                        durationMinutes: existing.durationMinutes > 0 ? existing.durationMinutes : candidate.durationMinutes,
                        activeKilocalories: existing.activeKilocalories > 0
                            ? existing.activeKilocalories : candidate.activeKilocalories,
                        manualWorkoutID: existing.manualWorkoutID ?? candidate.manualWorkoutID,
                        healthKitID: existing.healthKitID ?? candidate.healthKitID,
                        healthActivity: existing.healthActivity ?? candidate.healthActivity,
                        vaultNote: existing.vaultNote ?? candidate.vaultNote
                    )
                }
            } catch {
                firstError = firstError ?? error
            }
        }
        if !succeeded, let firstError { throw firstError }
        return merged.sorted { $0.performedAt > $1.performedAt }
    }
}

/// A bounded read of the existing Home log notes. Partial means older notes may contain more lifts.
public struct JarvisGymLiftHistory: Sendable {
    public let entries: [JarvisGymLogEntry]
    public let partial: Bool
}

extension JarvisGymLogNote {
    public static func lift(from content: String) -> JarvisGymLift? {
        let pattern = #"^- Lift: (.+) · ([0-9]+(?:\.[0-9]+)?) kg × ([0-9]+) × ([0-9]+)$"#
        guard let expression = try? NSRegularExpression(pattern: pattern, options: .anchorsMatchLines),
              let match = expression.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)) else { return nil }
        func field(_ index: Int) -> String? {
            Range(match.range(at: index), in: content).map { String(content[$0]) }
        }
        guard let exercise = field(1), let weight = field(2).flatMap(Double.init),
              let reps = field(3).flatMap(Int.init), let sets = field(4).flatMap(Int.init) else { return nil }
        let lift = JarvisGymLift(exercise: exercise, weightKg: weight, reps: reps, sets: sets)
        return lift.isValid ? lift : nil
    }
}

extension JarvisVaultGymLogStore {
    /// Reads existing notes without migrating or rewriting the owner's log. All reads are bounded and cancellable.
    public func recentLifts(since: Date, maximumNoteReads: Int = 30) async throws -> JarvisGymLiftHistory {
        let deadline = ContinuousClock.now + .seconds(25)
        var candidates: [(path: String, date: Date, session: JarvisGymSessionType)] = []
        var offset = 0
        var partial = false
        for pageIndex in 0..<maximumPages {
            try Task.checkCancellation()
            guard ContinuousClock.now < deadline else { partial = true; break }
            let page = try await client.notes(directory: JarvisGymLogNote.folder, offset: offset)
            for note in page.notes {
                if let parsed = JarvisGymLogNote.parse(path: note.path, timeZone: timeZone), parsed.performedAt >= since {
                    candidates.append((note.path, parsed.performedAt, parsed.session))
                }
            }
            if !page.hasMore { break }
            if pageIndex == maximumPages - 1 { partial = true }
            offset += page.limit
        }
        let limit = min(max(maximumNoteReads, 1), 100)
        partial = partial || candidates.count > limit
        var entries: [JarvisGymLogEntry] = []
        for candidate in candidates.sorted(by: { $0.date > $1.date }).prefix(limit) {
            try Task.checkCancellation()
            guard ContinuousClock.now < deadline else { partial = true; break }
            let note = try await client.readNote(path: candidate.path)
            if let lift = JarvisGymLogNote.lift(from: note.content) {
                entries.append(JarvisGymLogEntry(performedAt: candidate.date, session: candidate.session, lift: lift, vaultNote: note))
            } else if note.content.contains("- Lift:") {
                partial = true
            }
        }
        return JarvisGymLiftHistory(entries: entries, partial: partial)
    }
}
