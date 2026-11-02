import Foundation

public enum JarvisTodayLocalizationKey: String, CaseIterable, Sendable {
    case greetingMorning = "today.greeting.morning"
    case greetingAfternoon = "today.greeting.afternoon"
    case greetingEvening = "today.greeting.evening"
    case greetingNextEvent = "today.greeting.nextEvent"
    case greetingTaskOne = "today.greeting.taskOne"
    case greetingTasks = "today.greeting.tasks"
    case greetingClear = "today.greeting.clear"
    case nextUp = "today.nextUp"
    case tomorrow = "today.tomorrow"
    case overdue = "today.overdue"
    case tabToday = "today.tab.today"
    case tabDue = "today.tab.due"
    case agendaAndTasks = "today.agendaAndTasks"
    case add = "today.add"
    case newTask = "today.newTask"
    case newNote = "today.newNote"
    case showLess = "today.showLess"
    case showMore = "today.showMore"
    case nothingPlanned = "today.nothingPlanned"
    case nothingToday = "today.nothingToday"
    case nothingDue = "today.nothingDue"
    case calendarUnavailable = "today.calendarUnavailable"
    case tasksUnavailable = "today.tasksUnavailable"
    case markDone = "today.markDone"
    case workouts = "today.workouts"
    case workoutsByType = "today.workoutsByType"
    case workoutsEmpty = "today.workoutsEmpty"
    case workoutsUnavailable = "today.workoutsUnavailable"
    case steps = "today.steps"
    case stepsToday = "today.stepsToday"
    case dailySteps = "today.dailySteps"
    case stepsUnavailable = "today.stepsUnavailable"
    case stepsSoFar = "today.stepsSoFar"
    case stepsSuffix = "today.stepsSuffix"
    case goal = "today.goal"
    case period = "today.period"
    case rangeToday = "today.range.today"
    case rangeWeek = "today.range.week"
    case rangeFortnight = "today.range.fortnight"
    case rangeMonth = "today.range.month"
    case dateTo = "today.dateTo"
    case sessionChest = "today.session.chest"
    case sessionBack = "today.session.back"
    case sessionArms = "today.session.arms"
    case sessionLegs = "today.session.legs"
    case sessionCardio = "today.session.cardio"
    case shortChest = "today.short.chest"
    case shortBack = "today.short.back"
    case shortArms = "today.short.arms"
    case shortLegs = "today.short.legs"
    case shortCardio = "today.short.cardio"
    case quickActions = "today.quickActions"
    case logWorkout = "today.logWorkout"
    case logLift = "today.logLift"
    case agoToday = "today.ago.today"
    case agoYesterday = "today.ago.yesterday"
    case agoDays = "today.ago.days"
    case noWorkoutYet = "today.noWorkoutYet"
    case sessionTypeGroup = "today.sessionType"
    case quickLift = "today.quickLift"
    case exercise = "today.exercise"
    case reps = "today.reps"
    case sets = "today.sets"
    case save = "today.save"
    case close = "today.close"
    case saving = "today.saving"
    case savedToVault = "today.savedToVault"
    case gymLog = "today.gymLog"
    case saveFailed = "today.saveFailed"
    case saveUnavailable = "today.saveUnavailable"
    case saveOutcomeUnknown = "today.saveOutcomeUnknown"
    case loading = "today.loading"
    case empty = "today.empty"
    case loadFailed = "today.loadFailed"
    case offline = "today.offline"
    case retry = "today.retry"
    case backToToday = "today.backToToday"
    case page = "today.page"
}

public enum JarvisTodayLocalization {
    public static func string(_ key: JarvisTodayLocalizationKey, language: JarvisAppLanguage = .default) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return key.rawValue
        }
        return bundle.localizedString(forKey: key.rawValue, value: key.rawValue, table: "JarvisToday")
    }

    /// For the keys whose value carries one integer placeholder (`%ld`).
    public static func string(
        _ key: JarvisTodayLocalizationKey,
        count: Int,
        language: JarvisAppLanguage = .default
    ) -> String {
        String(format: string(key, language: language), locale: language.locale, count)
    }

    /// For the keys whose value carries two string placeholders (`%@`).
    public static func string(
        _ key: JarvisTodayLocalizationKey,
        _ first: String,
        _ second: String,
        language: JarvisAppLanguage = .default
    ) -> String {
        var result = string(key, language: language)
        for value in [first, second] {
            guard let range = result.range(of: "%@") else { break }
            result.replaceSubrange(range, with: value)
        }
        return result
    }
}
