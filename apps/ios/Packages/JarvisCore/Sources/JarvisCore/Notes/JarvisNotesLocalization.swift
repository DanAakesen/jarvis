import Foundation

public enum JarvisAppLanguage: String, CaseIterable, Identifiable, Sendable {
    case da
    case en

    public static let `default` = JarvisAppLanguage.da
    public static let preferenceKey = "jarvis.appLanguage"

    public var id: String { rawValue }

    public var locale: Locale {
        Locale(identifier: self == .da ? "da_DK" : "en_GB")
    }
}

public enum JarvisNotesLocalizationKey: String, CaseIterable, Sendable {
    case languageTitle = "language.title"
    case languageDanish = "language.danish"
    case languageEnglish = "language.english"
    case settingsTitle = "settings.title"
    case chatTitle = "navigation.chat"
    case voiceTitle = "navigation.voice"
    case voiceConnectionLost = "voice.connectionLost"
    case voiceRetryNow = "voice.retryNow"
    case voiceRetrying = "voice.retrying"
    case voiceEnd = "voice.end"
    case voiceConnectionEnd = "voice.connectionEnd"
    case workspacesTitle = "navigation.workspaces"
    case healthTitle = "navigation.health"
    case softwareFactoryTitle = "navigation.softwareFactory"
    case bankingTitle = "navigation.banking"
    case usageTitle = "navigation.usage"
    case statusTitle = "navigation.status"
    case proactiveTitle = "navigation.proactive"
    case later = "navigation.later"
    case openSidebar = "navigation.openSidebar"
    case closeSidebar = "navigation.closeSidebar"
    case title = "notes.title"
    case refresh = "notes.refresh"
    case search = "notes.search"
    case all = "notes.all"
    case notes = "notes.notes"
    case tasks = "notes.tasks"
    case list = "notes.list"
    case graph = "notes.graph"
    case newNote = "notes.newNote"
    case newTask = "notes.newTask"
    case retry = "notes.retry"
    case loading = "notes.loading"
    case emptyNotes = "notes.emptyNotes"
    case emptyTasks = "notes.emptyTasks"
    case emptyList = "notes.emptyList"
    case emptyGraph = "notes.emptyGraph"
    case noResults = "notes.noResults"
    case offline = "notes.offline"
    case unavailable = "notes.unavailable"
    case signIn = "notes.signIn"
    case notOwner = "notes.notOwner"
    case save = "notes.save"
    case saved = "notes.saved"
    case saving = "notes.saving"
    case unsaved = "notes.unsaved"
    case conflict = "notes.conflict"
    case reload = "notes.reload"
    case titleField = "notes.titleField"
    case folderField = "notes.folderField"
    case contentField = "notes.contentField"
    case dueDate = "notes.dueDate"
    case dueTime = "notes.dueTime"
    case scope = "notes.scope"
    case personal = "notes.personal"
    case work = "notes.work"
    case overdue = "notes.overdue"
    case today = "notes.today"
    case upcoming = "notes.upcoming"
    case noDate = "notes.noDate"
    case priorityHigh = "notes.priorityHigh"
    case priorityMedium = "notes.priorityMedium"
    case priorityNormal = "notes.priorityNormal"
    case complete = "notes.complete"
    case completed = "notes.completed"
    case showGraphList = "notes.showGraphList"
    case showGraph = "notes.showGraph"
    case resetGraph = "notes.resetGraph"
    case vaultRoot = "notes.vaultRoot"
    case loadMore = "notes.loadMore"
    case createHint = "notes.createHint"
    case discardTitle = "notes.discardTitle"
    case discard = "notes.discard"
    case cancel = "notes.cancel"
    case keepDraft = "notes.keepDraft"
    case latestVersion = "notes.latestVersion"
    case savedNeedsRefresh = "notes.savedNeedsRefresh"
    case unknownWrite = "notes.unknownWrite"
    case taskChanged = "notes.taskChanged"
    case noteMissing = "notes.noteMissing"
    case create = "notes.create"
    case dueTimeEnabled = "notes.dueTimeEnabled"
    case dueDateEnabled = "notes.dueDateEnabled"
    case openNote = "notes.openNote"
    case back = "notes.back"
    case ok = "notes.ok"
    case clearSearch = "notes.clearSearch"
    case expanded = "notes.expanded"
    case collapsed = "notes.collapsed"
    case graphPanZoomHint = "notes.graphPanZoomHint"
    case gateSignIn = "gate.signIn"
    case gateSigningIn = "gate.signingIn"
    case gateRetry = "gate.retry"
    case gateFailed = "gate.failed"
    case gateDenied = "gate.denied"
    case gateSignOut = "gate.signOut"
    case gateOffline = "gate.offline"
    case gateFaceIDFailed = "gate.faceIDFailed"
    case gateUsePasscode = "gate.usePasscode"
    case gateSignedOut = "gate.signedOut"
    case gateFaceIDReason = "gate.faceIDReason"
    case gateFaceIDLabel = "gate.faceIDLabel"
    case voiceCaptionYou = "voice.captionYou"
    case voiceCaptionJarvis = "voice.captionJarvis"
    case voiceCaptionsLabel = "voice.captionsLabel"
    case voiceHideCaptions = "voice.hideCaptions"
    case voiceShowCaptions = "voice.showCaptions"
}

public enum JarvisNotesLocalization {
    public static func string(
        _ key: JarvisNotesLocalizationKey,
        language: JarvisAppLanguage = .default
    ) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return key.rawValue
        }
        return bundle.localizedString(forKey: key.rawValue, value: key.rawValue, table: "JarvisNotes")
    }

    public static func formattedUpdatedDate(_ value: String, language: JarvisAppLanguage) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions.insert(.withFractionalSeconds)
        guard let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) else {
            return value
        }
        return date.formatted(
            .dateTime
                .year(.twoDigits)
                .month(.abbreviated)
                .day()
                .locale(language.locale)
        )
    }

    public static func formattedDueDate(_ value: String, language: JarvisAppLanguage) -> String {
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

    public static func formattedDueTime(_ value: String, language: JarvisAppLanguage) -> String {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.calendar = Calendar(identifier: .gregorian)
        input.timeZone = TimeZone(secondsFromGMT: 0)
        input.dateFormat = "HH:mm"
        guard let date = input.date(from: value) else { return value }

        let output = DateFormatter()
        output.locale = language.locale
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.timeStyle = .short
        return output.string(from: date)
    }
}
