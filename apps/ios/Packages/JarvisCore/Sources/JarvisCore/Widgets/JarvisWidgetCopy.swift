import Foundation

/// Every string the Gym and Factory widgets draw, in Danish and English. Task titles and status lines inside the
/// snapshot are written already localised by the app.
public enum JarvisWidgetCopy: String, CaseIterable, Sendable {
    case steps, workouts, ofGoal, thisWeek, lift, run, kilometers, calories, average
    case factory, softwareFactory, running, awaiting, review, failed, done
    case approve, pause, resume, retry
    case loading, emptyGym, emptyFactory, error, offline, updated, noTasks
    case displayNameGym, displayNameFactory
    case expiresAt, sessionEnded, checksRunning, checksPassed, checksFailed, pullRequest

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
    ]

    public func formatted(_ argument: String, language: JarvisAppLanguage) -> String {
        String(format: text(language: language), argument)
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
