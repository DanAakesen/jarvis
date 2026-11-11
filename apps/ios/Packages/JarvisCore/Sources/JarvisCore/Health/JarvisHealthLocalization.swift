import Foundation

public enum JarvisHealthLocalizationKey: String, CaseIterable, Sendable {
    case title = "health.title"
    case dashboard = "health.dashboard"
    case trackWorkout = "health.trackWorkout"
    case refresh = "health.refresh"
    case sync = "health.sync"
    case syncing = "health.syncing"
    case syncNever = "health.syncNever"
    case syncComplete = "health.syncComplete"
    case syncPartial = "health.syncPartial"
    case syncFailed = "health.syncFailed"
    case syncPullFailed = "health.syncPullFailed"
    case syncPullPartial = "health.syncPullPartial"
    case syncRetry = "health.syncRetry"
    case periodLabel = "health.periodLabel"
    case search = "health.search"
    case clearSearch = "health.clearSearch"
    case today = "health.period.today"
    case yesterday = "health.period.yesterday"
    case sevenDays = "health.period.sevenDays"
    case fourteenDays = "health.period.fourteenDays"
    case activeKcal = "health.activeKcal"
    case activityUnavailable = "health.activityUnavailable"
    case activityPartial = "health.activityPartial"
    case activityStale = "health.activityStale"
    case thirtyDays = "health.period.thirtyDays"
    case gym = "health.gym"
    case run = "health.run"
    case steps = "health.steps"
    case activity = "health.activity"
    case training = "health.training"
    case activeTime = "health.activeTime"
    case lastLifts = "health.lastLifts"
    case totalTarget = "health.totalTarget"
    case target = "health.target"
    case targetLabel = "health.targetLabel"
    case noTarget = "health.noTarget"
    case unavailable = "health.unavailable"
    case accessDenied = "health.accessDenied"
    case loading = "health.loading"
    case empty = "health.empty"
    case notAuthorised = "health.notAuthorised"
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
    case measurements = "health.measurements"
    case oneMeasurement = "health.oneMeasurement"
    case measurementCount = "health.measurementCount"
    case weight = "health.weight"
    case bodyFat = "health.bodyFat"
    case leanMass = "health.leanMass"
    case nutrition = "health.nutrition"
    case proteinChart = "health.proteinChart"
    case lastSync = "health.lastSync"
    case noSync = "health.noSync"
    case workout = "health.workout"
    case workoutTraditionalStrength = "health.workout.traditionalStrength"
    case workoutFunctionalStrength = "health.workout.functionalStrength"
    case workoutCore = "health.workout.core"
    case workoutCrossTraining = "health.workout.crossTraining"
    case workoutHIIT = "health.workout.hiit"
    case workoutRunning = "health.workout.running"
    case workoutWalking = "health.workout.walking"
    case workoutCycling = "health.workout.cycling"
    case workoutSwimming = "health.workout.swimming"
    case workoutHiking = "health.workout.hiking"
    case workoutYoga = "health.workout.yoga"
    case workoutRowing = "health.workout.rowing"
    case workoutElliptical = "health.workout.elliptical"
    case workoutStairClimbing = "health.workout.stairClimbing"
    case workoutFlexibility = "health.workout.flexibility"
    case workoutMixedCardio = "health.workout.mixedCardio"
    case workoutJumpRope = "health.workout.jumpRope"
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
    case vaultPending = "health.vaultPending"
    case cancel = "health.cancel"
    case loadMore = "health.loadMore"
    case overview = "health.overview"
    case log = "health.log"
    case logLift = "health.logLift"
    case logWorkout = "health.logWorkout"
    case newWorkout = "health.newWorkout"
    case workoutType = "health.workoutType"
    case workoutDuration = "health.workoutDuration"
    case workoutUnavailable = "health.workoutUnavailable"
    case workoutChestTricepsCore = "health.workoutType.chestTricepsCore"
    case workoutBackBicepsCore = "health.workoutType.backBicepsCore"
    case workoutArmsShoulders = "health.workoutType.armsShoulders"
    case workoutLegsCore = "health.workoutType.legsCore"
    case workoutCardio = "health.workoutType.cardio"
    case workoutOther = "health.workoutType.other"
    case deepSleep = "health.deepSleep"
    case remSleep = "health.remSleep"
    case lightSleep = "health.lightSleep"
    case awake = "health.awake"
    case protein = "health.protein"
    case carbs = "health.carbs"
    case fat = "health.fat"
    case kcalEaten = "health.kcalEaten"
    case sleepChart = "health.sleepChart"
    case heroPages = "health.heroPages"
    case nightsRecorded = "health.nightsRecorded"
    case mealsLogged = "health.mealsLogged"
    case dailyAverage = "health.dailyAverage"
}

public enum JarvisHealthLocalization {
    public static func workoutName(_ value: String?, language: JarvisAppLanguage) -> String {
        let normalized = JarvisHealthLogic.normalizedWorkoutType(value)
        let key: JarvisHealthLocalizationKey
        switch normalized {
        case "50", "healthkit50", "traditionalstrengthtraining": key = .workoutTraditionalStrength
        case "20", "healthkit20", "functionalstrengthtraining": key = .workoutFunctionalStrength
        case "59", "healthkit59", "coretraining": key = .workoutCore
        case "11", "healthkit11", "crosstraining": key = .workoutCrossTraining
        case "63", "healthkit63", "highintensityintervaltraining", "hiit": key = .workoutHIIT
        case "37", "healthkit37", "running", "run": key = .workoutRunning
        case "walking": key = .workoutWalking
        case "cycling": key = .workoutCycling
        case "swimming": key = .workoutSwimming
        case "hiking": key = .workoutHiking
        case "yoga": key = .workoutYoga
        case "rowing": key = .workoutRowing
        case "elliptical": key = .workoutElliptical
        case "stairclimbing", "stairs", "steptraining": key = .workoutStairClimbing
        case "flexibility": key = .workoutFlexibility
        case "mixedcardio": key = .workoutMixedCardio
        case "jumprope": key = .workoutJumpRope
        case "gym", "strengthtraining": key = .gym
        default: key = .workout
        }
        return string(key, language: language)
    }

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
