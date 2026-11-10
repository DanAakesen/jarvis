import Foundation

/// Display-only companion data. A missing section is unavailable, not an empty or zero result.
public struct WatchDashboardSnapshot: Codable, Equatable, Sendable {
    public var version = 1
    public var generatedAt: Date
    public var dayStart: Date
    public var timeZoneID: String
    public var agenda: [JarvisTodayCalendarEntry]?
    public var bodyFat: [WatchBodyFatPoint]?
    public var todayTasks: WatchTaskPreviewList?
    public var upcomingTasks: WatchTaskPreviewList?
    public var notes: [VaultNoteSummary]?
    public var nutrition: WatchNutritionSnapshot?
    public var brief: WatchBriefSummary?
    /// Actual source timestamps when provided; generatedAt only describes this companion read.
    public var sourceUpdatedAt: [String: Date] = [:]

    public init(now: Date = Date(), calendar: Calendar = .current) {
        generatedAt = now
        dayStart = calendar.startOfDay(for: now)
        timeZoneID = calendar.timeZone.identifier
    }

    public func expiresAt() -> Date {
        let ageLimit = generatedAt.addingTimeInterval(900)
        guard let timeZone = TimeZone(identifier: timeZoneID) else { return generatedAt }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return min(ageLimit, calendar.date(byAdding: .day, value: 1, to: dayStart) ?? ageLimit)
    }

    public func isCurrent(at now: Date) -> Bool {
        version == 1 && now >= generatedAt && now < expiresAt()
    }

    /// Reduce previews, never persisted task titles or note bodies, to fit the paired wire envelope.
    public func bounded() throws -> Self {
        var value = self
        value.agenda = agenda.map { Array($0.prefix(3)) }
        value.bodyFat = bodyFat.map { Array($0.suffix(100)) }
        value.todayTasks = todayTasks.map { .init(tasks: Array($0.tasks.prefix(3)), totalCount: $0.totalCount) }
        value.upcomingTasks = upcomingTasks.map { .init(tasks: Array($0.tasks.prefix(3)), totalCount: $0.totalCount) }
        value.notes = notes.map { Array($0.prefix(3)) }
        while try JSONEncoder().encode(value).count > WatchLimits.payloadBytes {
            if value.upcomingTasks?.tasks.isEmpty == false { value.upcomingTasks?.tasks.removeLast() }
            else if value.todayTasks?.tasks.isEmpty == false { value.todayTasks?.tasks.removeLast() }
            else if value.notes?.isEmpty == false { value.notes?.removeLast() }
            else if value.agenda?.isEmpty == false { value.agenda?.removeLast() }
            else if value.bodyFat?.isEmpty == false { value.bodyFat?.removeFirst() }
            else { throw WatchFailure.failed }
        }
        return value
    }
}

public struct WatchTaskPreviewList: Codable, Equatable, Sendable {
    public var tasks: [VaultTask]
    public var totalCount: Int
    public init(tasks: [VaultTask], totalCount: Int? = nil) {
        self.tasks = tasks
        self.totalCount = max(totalCount ?? tasks.count, tasks.count)
    }
}

public struct WatchBodyFatPoint: Codable, Equatable, Identifiable, Sendable {
    public let date: String
    public let percent: Double
    public let updatedAt: Date?
    public var id: String { date }
    public init(date: String, percent: Double, updatedAt: Date? = nil) {
        self.date = date; self.percent = percent; self.updatedAt = updatedAt
    }

    public static func latest(from items: [[String: JSONValue]], limit: Int = 20) -> [Self] {
        items.compactMap { row -> Self? in
            guard case .string("body_fat_percentage")? = row["metric_name"],
                  case .string(let rawDate)? = row["metric_date"],
                  let day = JarvisHealthLogic.day(rawDate),
                  case .string(let unit)? = row["unit"],
                  case .number(let rawValue)? = row["value"] else { return nil }
            let percent: Double
            switch unit.lowercased() {
            case "%", "percent": percent = rawValue
            case "fraction", "1": percent = rawValue * 100
            default: return nil
            }
            guard percent.isFinite, (0...100).contains(percent) else { return nil }
            let updatedAt: Date?
            if case .string(let stamp)? = row["updated_at"] { updatedAt = WatchDashboardDates.instant(stamp) }
            else { updatedAt = nil }
            return Self(date: day, percent: percent, updatedAt: updatedAt)
        }.sorted { $0.date < $1.date }.suffix(max(0, min(limit, 100))).map { $0 }
    }
}

public struct WatchNutritionSnapshot: Codable, Equatable, Sendable {
    public var date: String
    public var updatedAt: Date?
    public var carbsGrams: Double?
    public var fatGrams: Double?
    public var proteinGrams: Double?
    public var carbsGoalGrams: Double?
    public var fatGoalGrams: Double?
    public var proteinGoalGrams: Double?
    public var energyKcal: Double?
    public var partialNutrients: [String]

    public init(date: String, carbsGrams: Double? = nil, fatGrams: Double? = nil,
                proteinGrams: Double? = nil, carbsGoalGrams: Double? = nil,
                fatGoalGrams: Double? = nil, proteinGoalGrams: Double? = nil,
                partialNutrients: [String] = [], updatedAt: Date? = nil, energyKcal: Double? = nil) {
        self.date = date; self.updatedAt = updatedAt
        self.carbsGrams = Self.quantity(carbsGrams); self.fatGrams = Self.quantity(fatGrams)
        self.proteinGrams = Self.quantity(proteinGrams)
        self.carbsGoalGrams = Self.goal(carbsGoalGrams); self.fatGoalGrams = Self.goal(fatGoalGrams)
        self.proteinGoalGrams = Self.goal(proteinGoalGrams); self.partialNutrients = partialNutrients
        self.energyKcal = Self.quantity(energyKcal)
    }

    public init(date: String, items: [[String: JSONValue]], carbsGoalGrams: Double? = nil,
                fatGoalGrams: Double? = nil, proteinGoalGrams: Double? = nil) {
        let row = items.first { row in
            guard case .string(let day)? = row["meal_date"],
                  case .number(let meals)? = row["meal_count"] else { return false }
            return JarvisHealthLogic.day(day) == date && meals > 0
        }
        func number(_ key: String) -> Double? {
            guard case .number(let value)? = row?[key] else { return nil }
            return value
        }
        let partial: [String]
        if case .array(let names)? = row?["partial_nutrients"] {
            partial = names.compactMap { if case .string(let name) = $0 { return name }; return nil }
        } else { partial = [] }
        let updatedAt: Date?
        if case .string(let stamp)? = row?["latest_updated_at"] { updatedAt = WatchDashboardDates.instant(stamp) }
        else { updatedAt = nil }
        self.init(date: date, carbsGrams: number("carbohydrates_grams"), fatGrams: number("fat_grams"),
                  proteinGrams: number("protein_grams"), carbsGoalGrams: carbsGoalGrams,
                  fatGoalGrams: fatGoalGrams, proteinGoalGrams: proteinGoalGrams,
                  partialNutrients: partial, updatedAt: updatedAt, energyKcal: number("energy_kcal"))
    }
    private static func quantity(_ value: Double?) -> Double? {
        value.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
    }
    private static func goal(_ value: Double?) -> Double? {
        value.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
    }
}

public struct WatchBriefSummary: Codable, Equatable, Sendable {
    public let text: String
    public let highlights: [String]
    public let fullText: String?
    public let fullHighlights: [String]?
    public let generatedAt: Date
    public let state: String

    public init(text: String, highlights: [String], generatedAt: Date, state: String = "generated",
                fullText: String? = nil, fullHighlights: [String]? = nil) {
        self.text = text; self.highlights = highlights
        self.fullText = fullText; self.fullHighlights = fullHighlights
        self.generatedAt = generatedAt; self.state = state
    }

    public init?(brief: JarvisHomeBrief, maximumCharacters: Int = 360) {
        guard let generatedAt = WatchDashboardDates.instant(brief.generatedAt), brief.isValid else { return nil }
        let original = brief.text.trimmingCharacters(in: .whitespacesAndNewlines)
        var boundaries: [String.Index] = []
        var index = original.startIndex
        while index < original.endIndex {
            let next = original.index(after: index)
            if ".!?。！？".contains(original[index]),
               next == original.endIndex || original[next].isWhitespace {
                boundaries.append(next)
            }
            index = next
        }
        let preferred = boundaries.last { original.distance(from: original.startIndex, to: $0) <= maximumCharacters }
        let end = original.count <= maximumCharacters ? original.endIndex : preferred ?? boundaries.first ?? original.endIndex
        let text = String(original[..<end])
        self.init(text: text, highlights: (brief.highlights ?? []).filter { text.contains($0) },
                  generatedAt: generatedAt, state: brief.state,
                  fullText: original, fullHighlights: brief.highlights ?? [])
    }

    public func isCurrent(at now: Date) -> Bool {
        now >= generatedAt && now.timeIntervalSince(generatedAt) < 900
    }
}

public enum WatchDashboardDates {
    public static func instant(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

public struct WatchPageRequest: Codable, Equatable, Sendable {
    public let offset: Int
    public let revision: String?
    public init(offset: Int = 0, revision: String? = nil) { self.offset = offset; self.revision = revision }
    public var isValid: Bool { (0...JarvisNotesLogic.maximumNoteBytes).contains(offset) && (revision?.utf8.count ?? 0) <= 64 }
}

public struct WatchAgendaPage: Codable, Equatable, Sendable {
    public let entries: [JarvisTodayCalendarEntry]
    public let offset: Int
    public let nextOffset: Int?
    public init(entries: [JarvisTodayCalendarEntry], offset: Int, nextOffset: Int?) {
        self.entries = entries; self.offset = offset; self.nextOffset = nextOffset
    }
}

public struct WatchNotesPage: Codable, Equatable, Sendable {
    public let notes: [VaultNoteSummary]
    public let offset: Int
    public let nextOffset: Int?
    public init(notes: [VaultNoteSummary], offset: Int, nextOffset: Int?) {
        self.notes = notes; self.offset = offset; self.nextOffset = nextOffset
    }
}

public struct WatchTaskPage: Codable, Equatable, Sendable {
    public let tasks: [VaultTask]
    public let totalCount: Int
    public let offset: Int
    public let nextOffset: Int?
    public let dayStart: Date
    public let timeZoneID: String
    public init(tasks: [VaultTask], totalCount: Int, offset: Int, nextOffset: Int?,
                dayStart: Date, timeZoneID: String) {
        self.tasks = tasks; self.totalCount = totalCount; self.offset = offset; self.nextOffset = nextOffset
        self.dayStart = dayStart; self.timeZoneID = timeZoneID
    }
}

/// Byte-offset pages preserve the complete note without sending its external URL to the Watch.
public struct WatchNoteDetail: Codable, Equatable, Sendable {
    public let path: String
    public let content: String
    public let revision: String
    public let offset: Int
    public let nextOffset: Int?

    public init(path: String, content: String, revision: String, offset: Int, nextOffset: Int?) {
        self.path = path; self.content = content; self.revision = revision
        self.offset = offset; self.nextOffset = nextOffset
    }
    public init(note: VaultNote, page: WatchPageRequest) throws {
        let bytes = Array(note.content.utf8)
        guard page.isValid, page.offset <= bytes.count,
              page.revision.map({ $0 == note.sha }) ?? (page.offset == 0),
              String(bytes: bytes.prefix(page.offset), encoding: .utf8) != nil else { throw WatchFailure.invalidRequest }
        var end = min(page.offset + 12_000, bytes.count)
        while end > page.offset, String(bytes: bytes[page.offset..<end], encoding: .utf8) == nil { end -= 1 }
        self.init(path: note.path, content: String(bytes: bytes[page.offset..<end], encoding: .utf8) ?? "",
                  revision: note.sha, offset: page.offset, nextOffset: end < bytes.count ? end : nil)
    }
}

/// Reuses the phone's authenticated readers; no Watch credential or new source permission exists.
public struct WatchDashboardReader: Sendable {
    private let client: JarvisClient
    public init(client: JarvisClient) { self.client = client }

    public func dashboard(now: Date = Date(), calendar: Calendar = .current,
                          carbsGoalGrams: Double? = nil, fatGoalGrams: Double? = nil,
                          proteinGoalGrams: Double? = nil) async throws -> WatchDashboardSnapshot {
        var snapshot = WatchDashboardSnapshot(now: now, calendar: calendar)
        // A fixed five independent sections share an 18-second deadline. Brief generation is a separate read.
        try await withThrowingTaskGroup(of: Part.self) { group in
            group.addTask { try await self.part { .agenda(try await self.agenda(now: now, calendar: calendar).entries) } }
            group.addTask { try await self.part { .bodyFat(try await self.bodyFat(now: now, calendar: calendar)) } }
            group.addTask {
                try await self.part {
                    let list = try await self.taskLists(now: now, calendar: calendar)
                    return .tasks(list)
                }
            }
            group.addTask { try await self.part { .notes(try await self.notes().notes) } }
            group.addTask {
                try await self.part {
                    .nutrition(try await self.nutrition(now: now, calendar: calendar, carbsGoalGrams: carbsGoalGrams,
                                                      fatGoalGrams: fatGoalGrams, proteinGoalGrams: proteinGoalGrams))
                }
            }
            for try await part in group {
                switch part {
                case .agenda(let entries):
                    let end = calendar.date(byAdding: .day, value: 1, to: snapshot.dayStart) ?? now
                    snapshot.agenda = entries.filter { $0.start < end }
                case .bodyFat(let points):
                    snapshot.bodyFat = points
                    snapshot.sourceUpdatedAt["bodyFat"] = points.compactMap(\.updatedAt).max()
                case .tasks(let lists):
                    snapshot.todayTasks = .init(tasks: lists.today)
                    snapshot.upcomingTasks = .init(tasks: lists.upcoming)
                case .notes(let notes):
                    snapshot.notes = notes
                    snapshot.sourceUpdatedAt["notes"] = notes.compactMap { WatchDashboardDates.instant($0.updatedAt) }.max()
                case .nutrition(let value):
                    snapshot.nutrition = value
                    snapshot.sourceUpdatedAt["nutrition"] = value.updatedAt
                case .unavailable: break
                }
            }
        }
        guard snapshot.agenda != nil || snapshot.bodyFat != nil || snapshot.todayTasks != nil ||
                snapshot.notes != nil || snapshot.nutrition != nil else { throw WatchFailure.failed }
        return try snapshot.bounded()
    }

    public func taskLists(now: Date = Date(), calendar: Calendar = .current) async throws -> JarvisTodayTaskLists {
        guard case .modified(let list, _) = try await JarvisNotesClient(client: client).fetchOpenTasks(validator: nil),
              !list.truncated else { throw WatchFailure.failed }
        return JarvisTodayTaskLists(tasks: list.items, now: now, calendar: calendar)
    }

    public func taskPage(now: Date = Date(), calendar: Calendar = .current, offset: Int = 0) async throws -> WatchTaskPage {
        guard (0...500).contains(offset) else { throw WatchFailure.invalidRequest }
        guard case .modified(let list, _) = try await JarvisNotesClient(client: client).fetchOpenTasks(validator: nil),
              !list.truncated else { throw WatchFailure.failed }
        let all = list.items.filter { !$0.done }
        guard offset <= all.count else { throw WatchFailure.invalidRequest }
        var tasks = Array(all.dropFirst(offset).prefix(20))
        while true {
            let next = offset + tasks.count
            let page = WatchTaskPage(tasks: tasks, totalCount: all.count, offset: offset,
                                     nextOffset: next < all.count ? next : nil,
                                     dayStart: calendar.startOfDay(for: now), timeZoneID: calendar.timeZone.identifier)
            if try JSONEncoder().encode(page).count <= WatchLimits.payloadBytes { return page }
            guard !tasks.isEmpty else { throw WatchFailure.failed }
            tasks.removeLast()
            if tasks.isEmpty, offset < all.count { throw WatchFailure.failed }
        }
    }

    public func task(id: String) async throws -> VaultTask? {
        guard WatchTaskValidation.fingerprint(id) else { throw WatchFailure.invalidRequest }
        guard case .modified(let list, _) = try await JarvisNotesClient(client: client).fetchOpenTasks(validator: nil) else {
            throw WatchFailure.failed
        }
        if let task = list.items.first(where: { $0.id == id && !$0.done }) { return task }
        guard !list.truncated else { throw WatchFailure.failed }
        return nil
    }

    public func agenda(now: Date = Date(), calendar: Calendar = .current, offset: Int = 0) async throws -> WatchAgendaPage {
        guard (0...200).contains(offset),
              let end = calendar.date(byAdding: .day, value: 7, to: calendar.startOfDay(for: now)) else {
            throw WatchFailure.invalidRequest
        }
        let all = JarvisTodayAgenda.upcoming(
            try await JarvisBackendCalendarSource(client: client).entries(from: calendar.startOfDay(for: now), to: end),
            now: now
        )
        guard offset <= all.count else { throw WatchFailure.invalidRequest }
        var entries = Array(all.dropFirst(offset).prefix(20))
        while true {
            let next = offset + entries.count
            let page = WatchAgendaPage(entries: entries, offset: offset, nextOffset: next < all.count ? next : nil)
            if try JSONEncoder().encode(page).count <= WatchLimits.payloadBytes { return page }
            guard !entries.isEmpty else { throw WatchFailure.failed }
            entries.removeLast()
            if entries.isEmpty, offset < all.count { throw WatchFailure.failed }
        }
    }

    /// Three calendar months of actual daily measurements, without filling unrecorded days.
    public func bodyFat(now: Date = Date(), calendar: Calendar = .current) async throws -> [WatchBodyFatPoint] {
        let day = calendar.startOfDay(for: now)
        guard let start = calendar.date(byAdding: .month, value: -3, to: day),
              let period = JarvisHealthPeriod(startDate: JarvisTodayTaskLists.dayKey(start, calendar: calendar),
                                             endDate: JarvisTodayTaskLists.dayKey(day, calendar: calendar)) else {
            throw WatchFailure.invalidRequest
        }
        let result = try await JarvisHealthClient(client: client).query(
            .init(source: .metrics, period: period, metric: "body_fat_percentage", limit: 500)
        )
        guard !result.coverage.hasMore else { throw WatchFailure.failed }
        return WatchBodyFatPoint.latest(from: try WatchHealthHistory.items(from: result), limit: 100)
            .filter { $0.date >= period.startDate && $0.date <= period.endDate }
    }

    public func notes(offset: Int = 0) async throws -> WatchNotesPage {
        guard (0...10_000).contains(offset) else { throw WatchFailure.invalidRequest }
        let result = try await JarvisNotesClient(client: client).notes(offset: offset)
        var notes = result.notes
        while true {
            let next = offset + (notes.count == result.notes.count ? result.limit : notes.count)
            let page = WatchNotesPage(notes: notes, offset: offset,
                                     nextOffset: result.hasMore || notes.count < result.notes.count ? next : nil)
            if try JSONEncoder().encode(page).count <= WatchLimits.payloadBytes { return page }
            guard !notes.isEmpty else { throw WatchFailure.failed }
            notes.removeLast()
            if notes.isEmpty, !result.notes.isEmpty { throw WatchFailure.failed }
        }
    }

    public func note(path: String, page: WatchPageRequest = .init()) async throws -> WatchNoteDetail {
        try WatchNoteDetail(note: await JarvisNotesClient(client: client).readNote(path: path), page: page)
    }

    public func nutrition(now: Date = Date(), calendar: Calendar = .current,
                          carbsGoalGrams: Double? = nil, fatGoalGrams: Double? = nil,
                          proteinGoalGrams: Double? = nil) async throws -> WatchNutritionSnapshot {
        let date = JarvisTodayTaskLists.dayKey(now, calendar: calendar)
        guard let period = JarvisHealthPeriod(startDate: date, endDate: date) else { throw WatchFailure.invalidRequest }
        let health = JarvisHealthClient(client: client)
        async let read = health.query(.init(source: .nutritionDays, period: period, limit: 1))
        async let target = try? health.nutritionTargets().targets.proteinGrams
        let items = try await WatchHealthHistory.items(from: read)
        let protein = await target
        return WatchNutritionSnapshot(date: date, items: items, carbsGoalGrams: carbsGoalGrams,
                                      fatGoalGrams: fatGoalGrams, proteinGoalGrams: proteinGoalGrams ?? protein)
    }

    public func brief(language: JarvisAppLanguage) async throws -> WatchBriefSummary {
        guard let summary = WatchBriefSummary(brief: try await JarvisHomeBriefClient(client: client).fetch(language: language)) else {
            throw WatchFailure.failed
        }
        return summary
    }

    /// URLSession and JarvisClient propagate cancellation, including their bounded retry waits.
    public static func boundedRead<T: Sendable>(timeout: Duration = .seconds(18),
                                               _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask(operation: operation)
            group.addTask { try await Task.sleep(for: timeout); throw WatchFailure.unavailable }
            defer { group.cancelAll() }
            guard let value = try await group.next() else { throw WatchFailure.failed }
            return value
        }
    }

    private enum Part: Sendable {
        case agenda([JarvisTodayCalendarEntry]), bodyFat([WatchBodyFatPoint]), tasks(JarvisTodayTaskLists)
        case notes([VaultNoteSummary]), nutrition(WatchNutritionSnapshot), unavailable
    }
    private func part(_ operation: @escaping @Sendable () async throws -> Part) async throws -> Part {
        do { return try await Self.boundedRead(operation) }
        catch JarvisClientError.signInRequired { throw WatchFailure.signInRequired }
        catch { return .unavailable }
    }
}
