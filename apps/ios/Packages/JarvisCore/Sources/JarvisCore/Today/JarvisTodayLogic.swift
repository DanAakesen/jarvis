import Foundation

public enum JarvisTimeOfDay: String, CaseIterable, Sendable {
    case morning, afternoon, evening

    /// 05:00 to 11:59 is morning, 12:00 to 17:59 afternoon, anything else evening.
    public init(hour: Int) {
        switch hour {
        case 5..<12: self = .morning
        case 12..<18: self = .afternoon
        default: self = .evening
        }
    }

    public init(date: Date, calendar: Calendar = .current) {
        self.init(hour: calendar.component(.hour, from: date))
    }
}

/// The two-sentence greeting: key words (set in the accent colour) are marked with braces in the localized text.
public struct JarvisTodayGreeting: Equatable, Sendable {
    public struct Segment: Equatable, Sendable {
        public let text: String
        public let isKey: Bool
    }

    public let segments: [Segment]

    public var plainText: String { segments.map(\.text).joined() }

    public static func make(
        timeOfDay: JarvisTimeOfDay,
        nextEvent: JarvisTodayCalendarEntry?,
        tasksDueToday: Int,
        stepsToday: Int? = nil,
        workoutsThisWeek: Int? = nil,
        language: JarvisAppLanguage,
        calendar: Calendar = .current
    ) -> JarvisTodayGreeting {
        let opening: JarvisTodayLocalizationKey
        switch timeOfDay {
        case .morning: opening = .greetingMorning
        case .afternoon: opening = .greetingAfternoon
        case .evening: opening = .greetingEvening
        }
        var sentences = [JarvisTodayLocalization.string(opening, language: language)]
        if let nextEvent {
            sentences.append(JarvisTodayLocalization.string(
                .greetingNextEvent,
                stripBraces(nextEvent.title),
                timeText(nextEvent.start, language: language, calendar: calendar),
                language: language
            ))
        }
        if tasksDueToday == 1 {
            sentences.append(JarvisTodayLocalization.string(.greetingTaskOne, language: language))
        } else if tasksDueToday > 1 {
            sentences.append(JarvisTodayLocalization.string(.greetingTasks, count: tasksDueToday, language: language))
        } else if nextEvent == nil {
            sentences.append(JarvisTodayLocalization.string(.greetingClear, language: language))
        }
        // Only values that were actually read: steps and logged workouts are left out until they are known.
        if let stepsToday, stepsToday > 0 {
            sentences.append(JarvisTodayLocalization.string(
                .greetingSteps, text: JarvisNumberFormat.compact(stepsToday, language: language), language: language
            ))
        }
        if workoutsThisWeek == 1 {
            sentences.append(JarvisTodayLocalization.string(.greetingWorkoutOne, language: language))
        } else if let workoutsThisWeek, workoutsThisWeek > 1 {
            sentences.append(JarvisTodayLocalization.string(.greetingWorkouts, count: workoutsThisWeek, language: language))
        }
        return JarvisTodayGreeting(segments: parse(sentences.joined(separator: " ")))
    }

    static func stripBraces(_ value: String) -> String {
        value.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
    }

    /// Splits "a {b} c" into plain and key segments. An unbalanced brace is kept as text.
    static func parse(_ text: String) -> [Segment] {
        var segments: [Segment] = []
        var buffer = ""
        var inKey = false
        func flush() {
            if !buffer.isEmpty { segments.append(Segment(text: buffer, isKey: inKey)) }
            buffer = ""
        }
        for character in text {
            if character == "{" && !inKey {
                flush()
                inKey = true
            } else if character == "}" && inKey {
                flush()
                inKey = false
            } else {
                buffer.append(character)
            }
        }
        if inKey { buffer = "{" + buffer; inKey = false }
        flush()
        return segments
    }

    public static func timeText(_ date: Date, language: JarvisAppLanguage, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}

public enum JarvisTodayRange: Int, CaseIterable, Identifiable, Sendable {
    case today = 1
    case week = 7
    case fortnight = 14
    case month = 30

    public var id: Int { rawValue }
    public var dayCount: Int { rawValue }
    /// Today shows hourly bars; the longer ranges show daily bars.
    public var isHourly: Bool { self == .today }

    var titleKey: JarvisTodayLocalizationKey {
        switch self {
        case .today: .rangeToday
        case .week: .rangeWeek
        case .fortnight: .rangeFortnight
        case .month: .rangeMonth
        }
    }

    public func title(language: JarvisAppLanguage) -> String {
        JarvisTodayLocalization.string(titleKey, language: language)
    }
}

/// One bar of the steps chart.
public struct JarvisStepBar: Equatable, Identifiable, Sendable {
    public let id: Int
    /// Hourly bars hold the running total up to that hour; daily bars the day's total.
    public let value: Int
    /// Short label for the centre of the ring ("14:00" or "Mon").
    public let label: String
    /// Caption shown under the chart while selected ("14:00" or "Mon 2 Nov").
    public let caption: String
    /// Hours after the current one have no data yet and cannot be selected.
    public let isEnabled: Bool
    public let isCurrent: Bool
}

public enum JarvisTodayActivity {
    public static let stepGoal = 8_000
    public static let firstHour = 6
    public static let lastHour = 22

    public static func stepBars(
        range: JarvisTodayRange,
        steps: JarvisStepsSnapshot,
        now: Date,
        language: JarvisAppLanguage,
        calendar: Calendar = .current
    ) -> [JarvisStepBar] {
        if range.isHourly {
            let currentHour = calendar.component(.hour, from: now)
            var running = steps.hourly.prefix(firstHour).reduce(0, +)
            return (firstHour...lastHour).map { hour in
                let enabled = hour <= currentHour
                if enabled, steps.hourly.indices.contains(hour) { running += steps.hourly[hour] }
                let label = hourText(hour)
                return JarvisStepBar(
                    id: hour - firstHour,
                    value: enabled ? running : 0,
                    label: label,
                    caption: label,
                    isEnabled: enabled,
                    isCurrent: hour == currentHour
                )
            }
        }
        let today = calendar.startOfDay(for: now)
        return (0..<range.dayCount).reversed().enumerated().map { index, offset in
            let day = calendar.date(byAdding: .day, value: -offset, to: today) ?? today
            return JarvisStepBar(
                id: index,
                value: steps.daily[day] ?? 0,
                label: formatted(day, template: "EEE", language: language, calendar: calendar),
                caption: formatted(day, template: "EEE d MMM", language: language, calendar: calendar),
                isEnabled: true,
                isCurrent: offset == 0
            )
        }
    }

    /// Today's steps: the sum of the current day's hours, which is what the ring shows by default.
    public static func todaySteps(_ steps: JarvisStepsSnapshot, now: Date, calendar: Calendar = .current) -> Int {
        let currentHour = calendar.component(.hour, from: now)
        return steps.hourly.prefix(currentHour + 1).reduce(0, +)
    }

    /// Counts of workouts per session type for the days in the range, including today.
    public static func workoutCounts(
        _ entries: [JarvisGymLogEntry],
        range: JarvisTodayRange,
        now: Date,
        calendar: Calendar = .current
    ) -> [JarvisGymSessionType: Int] {
        var counts: [JarvisGymSessionType: Int] = [:]
        for entry in entriesInRange(entries, range: range, now: now, calendar: calendar) {
            counts[entry.session, default: 0] += 1
        }
        return counts
    }

    /// The workouts performed on the days in the range, including today.
    public static func entriesInRange(
        _ entries: [JarvisGymLogEntry],
        range: JarvisTodayRange,
        now: Date,
        calendar: Calendar = .current
    ) -> [JarvisGymLogEntry] {
        let today = calendar.startOfDay(for: now)
        guard let start = calendar.date(byAdding: .day, value: -(range.dayCount - 1), to: today),
              let end = calendar.date(byAdding: .day, value: 1, to: today) else { return [] }
        return entries.filter { $0.performedAt >= start && $0.performedAt < end }
    }

    /// "27 Oct to 2 Nov" for day ranges, "06:00 to 22:00" for today.
    public static func rangeCaption(
        range: JarvisTodayRange,
        now: Date,
        language: JarvisAppLanguage,
        calendar: Calendar = .current
    ) -> String {
        let joiner = " " + JarvisTodayLocalization.string(.dateTo, language: language) + " "
        guard !range.isHourly else { return hourText(firstHour) + joiner + hourText(lastHour) }
        let today = calendar.startOfDay(for: now)
        let start = calendar.date(byAdding: .day, value: -(range.dayCount - 1), to: today) ?? today
        return formatted(start, template: "d MMM", language: language, calendar: calendar)
            + joiner + formatted(today, template: "d MMM", language: language, calendar: calendar)
    }

    static func hourText(_ hour: Int) -> String {
        String(format: "%02d:00", hour)
    }

    static func formatted(_ date: Date, template: String, language: JarvisAppLanguage, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
            .replacingOccurrences(of: ".", with: "")
            .replacingOccurrences(of: ",", with: "")
    }
}

/// The range toggle, the tapped bar and the tapped donut segment of the workouts and steps card.
/// Changing the range, tapping the selected item again, or tapping outside resets to the whole period.
public struct JarvisTodayActivityState: Equatable, Sendable {
    public private(set) var range: JarvisTodayRange
    public private(set) var selectedBar: Int?
    public private(set) var selectedSegment: JarvisGymSessionType?

    public init(range: JarvisTodayRange = .today) {
        self.range = range
    }

    public mutating func setRange(_ newRange: JarvisTodayRange) {
        guard newRange != range else { return }
        range = newRange
        selectedBar = nil
        selectedSegment = nil
    }

    public mutating func toggleBar(_ index: Int) {
        selectedBar = selectedBar == index ? nil : index
    }

    public mutating func toggleSegment(_ session: JarvisGymSessionType) {
        selectedSegment = selectedSegment == session ? nil : session
    }

    public mutating func clearSelection() {
        selectedBar = nil
        selectedSegment = nil
    }
}

/// What the card shows for a state: ring value, donut centre, bars and caption.
public struct JarvisTodayActivityDisplay: Equatable, Sendable {
    public struct Segment: Equatable, Identifiable, Sendable {
        public let session: JarvisGymSessionType
        public let count: Int
        /// Share of all workouts in the range, 0...1.
        public let fraction: Double
        public var id: String { session.rawValue }
    }

    public let segments: [Segment]
    public let totalWorkouts: Int
    /// Summed workout minutes and active kilocalories for the range, rounded.
    public let activeMinutes: Int
    public let activeKilocalories: Int
    public let centerCount: Int
    public let centerSession: JarvisGymSessionType?
    public let bars: [JarvisStepBar]
    public let ringSteps: Int
    public let ringLabel: String?
    public let ringFraction: Double
    public let caption: String

    public init(
        state: JarvisTodayActivityState,
        workouts: [JarvisGymLogEntry],
        steps: JarvisStepsSnapshot,
        now: Date,
        language: JarvisAppLanguage,
        calendar: Calendar = .current
    ) {
        let counts = JarvisTodayActivity.workoutCounts(workouts, range: state.range, now: now, calendar: calendar)
        let total = counts.values.reduce(0, +)
        segments = JarvisGymSessionType.allCases.map {
            let count = counts[$0] ?? 0
            return Segment(session: $0, count: count, fraction: total > 0 ? Double(count) / Double(total) : 0)
        }
        totalWorkouts = total
        let inRange = JarvisTodayActivity.entriesInRange(workouts, range: state.range, now: now, calendar: calendar)
        activeMinutes = Int(inRange.reduce(0) { $0 + $1.durationMinutes }.rounded())
        activeKilocalories = Int(inRange.reduce(0) { $0 + $1.activeKilocalories }.rounded())
        centerSession = state.selectedSegment
        centerCount = state.selectedSegment.map { counts[$0] ?? 0 } ?? total

        let allBars = JarvisTodayActivity.stepBars(
            range: state.range, steps: steps, now: now, language: language, calendar: calendar
        )
        bars = allBars
        let selected = state.selectedBar.flatMap { index in allBars.first { $0.id == index && $0.isEnabled } }
        ringSteps = selected?.value ?? JarvisTodayActivity.todaySteps(steps, now: now, calendar: calendar)
        ringLabel = selected?.label
        ringFraction = min(1, Double(ringSteps) / Double(JarvisTodayActivity.stepGoal))
        caption = selected?.caption
            ?? JarvisTodayActivity.rangeCaption(range: state.range, now: now, language: language, calendar: calendar)
    }
}
