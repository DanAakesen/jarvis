import Foundation

/// Every string the Gym, Factory, Notes and Home widgets draw, in Danish and English. Task titles and status lines inside the
/// snapshot are written already localised by the app.
public enum JarvisWidgetCopy: String, CaseIterable, Sendable {
    case steps, workouts, ofGoal, thisWeek, lift, run, kilometers, calories, average
    case factory, softwareFactory, running, awaiting, review, failed, done
    case approve, pause, resume, retry
    case loading, emptyGym, emptyFactory, emptyTasks, error, offline, updated, noTasks
    case displayNameGym, displayNameFactory
    case expiresAt, sessionEnded, checksRunning, checksPassed, checksFailed, pullRequest
    case displayNameNotes, displayNameHome, notes, tasks, approvals, health
    case taskTodayOne, taskTodayMany, noTasksTodayAccent, noTasksTodayRest, latestNote, latestNotes, edited, emptyNotes
    case approvalOne, approvalMany, runOne, runMany, allQuiet
    case workoutsOfTarget, goalReached, toGo

    public func text(language: JarvisAppLanguage) -> String {
        let pair = Self.table[self] ?? ("", "")
        return language == .da ? pair.da : pair.en
    }

    private static let table: [JarvisWidgetCopy: (da: String, en: String)] = [
        .steps: ("Skridt", "Steps"),
        .workouts: ("Træning", "Workouts"),
        .ofGoal: ("af %@", "of %@"),
        .thisWeek: ("denne uge", "this week"),
        .lift: ("Løft", "Lifts"),
        .run: ("Løb", "Runs"),
        .kilometers: ("Kilometer", "Kilometres"),
        .calories: ("Kalorier", "Calories"),
        .average: ("Gns.", "Avg."),
        .factory: ("Factory", "Factory"),
        .softwareFactory: ("Software Factory", "Software Factory"),
        .running: ("Kører", "Running"),
        .awaiting: ("Afventer Dan", "Awaiting Dan"),
        .review: ("Gennemgang", "In review"),
        .failed: ("Fejlet", "Failed"),
        .done: ("færdige", "done"),
        .approve: ("Godkend", "Approve"),
        .pause: ("Sæt på pause", "Pause"),
        .resume: ("Genoptag", "Resume"),
        .retry: ("Prøv igen", "Retry"),
        .loading: ("Henter…", "Loading…"),
        .emptyGym: ("Ingen træningsdata endnu", "No training data yet"),
        .emptyFactory: ("Ingen opgaver", "No tasks"),
        .emptyTasks: ("Ingen opgaver i dag", "No tasks today"),
        .error: ("Kunne ikke hente data", "Couldn't load data"),
        .offline: ("Offline", "Offline"),
        .updated: ("Opdateret %@", "Updated %@"),
        .noTasks: ("Ingen aktive opgaver", "No active tasks"),
        .displayNameGym: ("Gym", "Gym"),
        .displayNameFactory: ("Factory", "Factory"),
        .expiresAt: ("Udløber kl. %@", "Expires at %@"),
        .sessionEnded: ("Sessionen sluttede uventet", "Session ended unexpectedly"),
        .checksRunning: ("checks kører", "checks running"),
        .checksPassed: ("checks bestået", "checks passed"),
        .checksFailed: ("checks fejlede", "checks failed"),
        .pullRequest: ("PR %@", "PR %@"),
        .displayNameNotes: ("Noter", "Notes"),
        .displayNameHome: ("Hjem", "Home"),
        .notes: ("Noter", "Notes"),
        .tasks: ("Opgaver", "Tasks"),
        .approvals: ("Godkendelser", "Approvals"),
        .health: ("Sundhed", "Health"),
        .taskTodayOne: ("opgave i dag", "task today"),
        .taskTodayMany: ("opgaver i dag", "tasks today"),
        .noTasksTodayAccent: ("Ingen opgaver", "No tasks"),
        .noTasksTodayRest: ("i dag", "today"),
        .latestNote: ("Seneste note: %@", "Latest note: %@"),
        .latestNotes: ("Seneste noter", "Latest notes"),
        .edited: ("Redigeret %@", "Edited %@"),
        .emptyNotes: ("Ingen opgaver eller noter", "No tasks or notes"),
        .approvalOne: ("godkendelse kræves", "approval needed"),
        .approvalMany: ("godkendelser kræves", "approvals needed"),
        .runOne: ("kørsel i gang", "run in progress"),
        .runMany: ("kørsler i gang", "runs in progress"),
        .allQuiet: ("Alt roligt", "All quiet"),
        .workoutsOfTarget: ("Træning %@ af %@", "Workouts %@ of %@"),
        .goalReached: ("Mål nået", "Goal reached"),
        .toGo: ("%@ tilbage", "%@ to go"),
    ]

    public func formatted(_ argument: String, language: JarvisAppLanguage) -> String {
        String(format: text(language: language), argument)
    }

    public func formatted(_ first: String, _ second: String, language: JarvisAppLanguage) -> String {
        String(format: text(language: language), first, second)
    }
}

public enum JarvisWidgetFormat {
    /// "af 8,0k" / "of 8.0k".
    public static func ofGoal(_ goal: Int, language: JarvisAppLanguage) -> String {
        JarvisWidgetCopy.ofGoal.formatted(JarvisNumberFormat.compactOneDecimal(goal, language: language), language: language)
    }

    /// Steps in full below 1,000 and with k above: "6,4k" / "6.4k".
    public static func count(_ value: Int, language: JarvisAppLanguage) -> String {
        JarvisNumberFormat.compactOneDecimal(value, language: language)
    }

    /// One letter per day, oldest first, ending on `lastDay`: "M T O T F L S" in Danish, "M T W T F S S" in English.
    public static func dayLetters(endingOn lastDay: Date, language: JarvisAppLanguage, calendar: Calendar = .current) -> [String] {
        var calendar = calendar
        calendar.locale = language.locale
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        return (0..<JarvisWidgetSnapshot.days).reversed().map { offset in
            let day = calendar.date(byAdding: .day, value: -offset, to: lastDay) ?? lastDay
            return symbols[calendar.component(.weekday, from: day) - 1]
        }
    }

    public static func updated(_ date: Date, language: JarvisAppLanguage, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "HH:mm"
        return JarvisWidgetCopy.updated.formatted(formatter.string(from: date), language: language)
    }
}

extension JarvisWidgetFormat {
    /// Kilometres with at most one decimal: "5,2" / "5.2".
    public static func kilometers(_ value: Double, language: JarvisAppLanguage) -> String {
        let formatter = NumberFormatter()
        formatter.locale = language.locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? "0"
    }
}

/// The one-line phrases of the Notes and Home widgets. Pure, so the package tests cover every wording.
public enum JarvisWidgetPhrase {
    /// "1 task today" / "3 tasks today".
    public static func tasksToday(_ count: Int, language: JarvisAppLanguage) -> String {
        "\(count) \(label(count, one: .taskTodayOne, many: .taskTodayMany, language: language))"
    }

    /// The label under the count, without the number.
    public static func label(_ count: Int, one: JarvisWidgetCopy, many: JarvisWidgetCopy, language: JarvisAppLanguage) -> String {
        (count == 1 ? one : many).text(language: language)
    }

    /// "3 tasks today. Latest note: TITLE." With no tasks the count reads "No tasks today"; with no notes the second
    /// sentence is left out.
    public static func notes(_ data: JarvisNotesWidgetData, language: JarvisAppLanguage) -> String {
        let first = data.tasksToday == 0
            ? noTasksToday(language: language)
            : tasksToday(data.tasksToday, language: language)
        guard let note = data.notes.first else { return first + "." }
        return "\(first). \(JarvisWidgetCopy.latestNote.formatted(note.title, language: language))."
    }

    public static func noTasksToday(language: JarvisAppLanguage) -> String {
        "\(JarvisWidgetCopy.noTasksTodayAccent.text(language: language)) \(JarvisWidgetCopy.noTasksTodayRest.text(language: language))"
    }

    /// The Home "Now" phrase: approvals first, then runs in progress, otherwise "All quiet".
    public static func now(_ data: JarvisHomeWidgetData, language: JarvisAppLanguage) -> String {
        if data.approvals > 0 {
            return "\(data.approvals) \(label(data.approvals, one: .approvalOne, many: .approvalMany, language: language))"
        }
        if data.running > 0 {
            return "\(data.running) \(label(data.running, one: .runOne, many: .runMany, language: language))"
        }
        return JarvisWidgetCopy.allQuiet.text(language: language)
    }

    /// "Workouts 2 of 4" with a short phrase: "Goal reached" or "2 to go". Without a target it is just the count.
    public static func gym(_ data: JarvisGymWidgetData, language: JarvisAppLanguage) -> (title: String, detail: String?) {
        let done = data.workoutsDone, target = data.workoutsTarget
        guard target > 0 else {
            return ("\(JarvisWidgetCopy.workouts.text(language: language)) \(done)", nil)
        }
        let detail = done >= target
            ? JarvisWidgetCopy.goalReached.text(language: language)
            : JarvisWidgetCopy.toGo.formatted(String(target - done), language: language)
        return (JarvisWidgetCopy.workoutsOfTarget.formatted(String(done), String(target), language: language), detail)
    }

    /// A task's time of day, or its date when it has none.
    public static func when(_ task: JarvisNotesWidgetData.Task, language: JarvisAppLanguage, calendar: Calendar = .current) -> String? {
        if let time = task.time { return time }
        guard let date = task.dueDate else { return nil }
        return shortDate(date, language: language, calendar: calendar)
    }

    /// When a note was last edited: the time today, the date otherwise.
    public static func edited(_ date: Date, now: Date, language: JarvisAppLanguage, calendar: Calendar = .current) -> String {
        let text = calendar.isDate(date, inSameDayAs: now)
            ? clock(date, language: language, calendar: calendar)
            : shortDate(date, language: language, calendar: calendar)
        return JarvisWidgetCopy.edited.formatted(text, language: language)
    }

    private static func clock(_ date: Date, language: JarvisAppLanguage, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private static func shortDate(_ date: Date, language: JarvisAppLanguage, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("dMMM")
        return formatter.string(from: date)
    }
}
