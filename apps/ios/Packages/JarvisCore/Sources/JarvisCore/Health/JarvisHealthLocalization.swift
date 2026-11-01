import Foundation

public enum JarvisHealthLocalizationKey: String, CaseIterable, Sendable {
    case title = "health.title"
    case dashboard = "health.dashboard"
    case trackWorkout = "health.trackWorkout"
    case refresh = "health.refresh"
    case search = "health.search"
    case clearSearch = "health.clearSearch"
    case today = "health.period.today"
    case yesterday = "health.period.yesterday"
    case sevenDays = "health.period.sevenDays"
    case thirtyDays = "health.period.thirtyDays"
    case gym = "health.gym"
    case run = "health.run"
    case steps = "health.steps"
    case activity = "health.activity"
    case target = "health.target"
    case targetLabel = "health.targetLabel"
    case noTarget = "health.noTarget"
    case unavailable = "health.unavailable"
    case accessDenied = "health.accessDenied"
    case loading = "health.loading"
    case empty = "health.empty"
    case notRecorded = "health.notRecorded"
    case retry = "health.retry"
    case offline = "health.offline"
    case loadFailed = "health.loadFailed"
    case noResults = "health.noResults"
    case summary = "health.summary"
    case proteinLeft = "health.proteinLeft"
    case caloriesLeft = "health.caloriesLeft"
    case sleep = "health.sleep"
    case recentSessions = "health.recentSessions"
    case bodyTrend = "health.bodyTrend"
    case weight = "health.weight"
    case bodyFat = "health.bodyFat"
    case leanMass = "health.leanMass"
    case nutrition = "health.nutrition"
    case proteinChart = "health.proteinChart"
    case lastSync = "health.lastSync"
    case noSync = "health.noSync"
    case workout = "health.workout"
    case sleepNight = "health.sleepNight"
    case meals = "health.meals"
    case metricTrend = "health.metricTrend"
    case duration = "health.duration"
    case energy = "health.energy"
    case distance = "health.distance"
    case heartRate = "health.heartRate"
    case date = "health.date"
    case average = "health.average"
    case over = "health.over"
    case left = "health.left"
    case loadingTarget = "health.loadingTarget"
    case targetsUnavailable = "health.targetsUnavailable"
    case noMeals = "health.noMeals"
    case noSessions = "health.noSessions"
    case fresh = "health.fresh"
    case stale = "health.stale"
    case averagePerDay = "health.averagePerDay"
    case partial = "health.partial"
    case hourShort = "health.hourShort"
    case minuteShort = "health.minuteShort"
    case newLift = "health.newLift"
    case exercises = "health.exercises"
    case history = "health.history"
    case pastExercises = "health.pastExercises"
    case noLifts = "health.noLifts"
    case name = "health.name"
    case liftWeight = "health.liftWeight"
    case reps = "health.reps"
    case sets = "health.sets"
    case save = "health.save"
    case saving = "health.saving"
    case saveFailed = "health.saveFailed"
    case cancel = "health.cancel"
    case loadMore = "health.loadMore"
}

public enum JarvisHealthLocalization {
    public static func string(
        _ key: JarvisHealthLocalizationKey,
        language: JarvisAppLanguage = .default
    ) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return key.rawValue
        }
        return bundle.localizedString(forKey: key.rawValue, value: key.rawValue, table: "JarvisHealth")
    }

    public static func formattedDate(_ value: String, language: JarvisAppLanguage) -> String {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.calendar = Calendar(identifier: .gregorian)
        input.timeZone = TimeZone(secondsFromGMT: 0)
        input.dateFormat = "yyyy-MM-dd"
        guard let date = input.date(from: value) else { return value }

        let output = DateFormatter()
        output.locale = language.locale
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.dateStyle = .medium
        return output.string(from: date)
    }

    public static func formattedDateTime(_ value: String, language: JarvisAppLanguage) -> String {
        let input = ISO8601DateFormatter()
        input.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = input.date(from: value) ?? {
            input.formatOptions = [.withInternetDateTime]
            return input.date(from: value)
        }() else {
            return value
        }

        let output = DateFormatter()
        output.locale = language.locale
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(identifier: "Europe/Copenhagen")
        output.dateStyle = .medium
        output.timeStyle = .short
        return output.string(from: date)
    }
}
