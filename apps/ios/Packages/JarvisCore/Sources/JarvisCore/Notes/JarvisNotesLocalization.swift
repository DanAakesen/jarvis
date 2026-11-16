import Foundation

public enum JarvisAppLanguage: String, CaseIterable, Identifiable, Sendable {
    case en

    public static let `default` = JarvisAppLanguage.en

    public var id: String { rawValue }

    public var locale: Locale {
        Locale(identifier: "en_GB")
    }
}

public enum JarvisNotesLocalizationKey: String, CaseIterable, Sendable {
    case settingsTitle = "settings.title"
    case todayTitle = "navigation.today"
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
    case source = "notes.source"
    case graph = "notes.graph"
    case newNote = "notes.newNote"
    case newTask = "notes.newTask"
    case retry = "notes.retry"
    case loading = "notes.loading"
    case emptyNotes = "notes.emptyNotes"
    case emptyTasks = "notes.emptyTasks"
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
    case edit = "notes.edit"
    case folderField = "notes.folderField"
    case newFolder = "notes.newFolder"
    case priority = "notes.priority"
    case folderName = "notes.folderName"
    case newFolderHere = "notes.newFolderHere"
    case useFolder = "notes.useFolder"
    case parentFolder = "notes.parentFolder"
    case folderSavedWithNote = "notes.folderSavedWithNote"
    case folderInvalidName = "notes.folderInvalidName"
    case folderAlreadyExists = "notes.folderAlreadyExists"
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
    case overview = "notes.overview"
    case links = "notes.links"
    case recent = "notes.recent"
    case pinned = "notes.pinned"
    case pin = "notes.pin"
    case unpin = "notes.unpin"
    case browseFolders = "notes.browseFolders"
    case raw = "notes.raw"
    case formatted = "notes.formatted"
    case done = "notes.done"
    case yesterday = "notes.yesterday"
    case earlier = "notes.earlier"
    case heading = "notes.heading"
    case checklist = "notes.checklist"
    case addLink = "notes.addLink"
    case undo = "notes.undo"
    case emptyPinned = "notes.emptyPinned"
    case folders = "notes.folders"
    case folderScope = "notes.folderScope"
    case allFolders = "notes.allFolders"
    case sortBy = "notes.sortBy"
    case sortUpdated = "notes.sortUpdated"
    case sortTitle = "notes.sortTitle"
    case sortDue = "notes.sortDue"
    case sortPriority = "notes.sortPriority"
    case reorderPins = "notes.reorderPins"
    case selectItems = "notes.selectItems"
    case more = "notes.more"
    case list = "notes.list"
    case recenter = "notes.recenter"
    case moveUp = "notes.moveUp"
    case moveDown = "notes.moveDown"
    case delete = "notes.delete"
    case deleteNote = "notes.deleteNote"
    case deleteNoteTitle = "notes.deleteNoteTitle"
    case deleteNoteMessage = "notes.deleteNoteMessage"
    case deleteTask = "notes.deleteTask"
    case deleteTaskTitle = "notes.deleteTaskTitle"
    case deleteTaskMessage = "notes.deleteTaskMessage"
    case deleteFailed = "notes.deleteFailed"
    case deleteChanged = "notes.deleteChanged"
    case close = "notes.close"
    case linkedNotes = "notes.linkedNotes"
    case linksInThisNote = "notes.linksInThisNote"
    case notesLinkingHere = "notes.notesLinkingHere"
    case noConnections = "notes.noConnections"
    case viewConnections = "notes.viewConnections"
    case graphScopeHeading = "notes.graphScopeHeading"
    case startWriting = "notes.startWriting"
    case destination = "notes.destination"
    case saveNeedsTitle = "notes.saveNeedsTitle"
    case saveNothingChanged = "notes.saveNothingChanged"
    case noteExists = "notes.noteExists"
    case keepEditing = "notes.keepEditing"
    case continueEditing = "notes.continueEditing"
    case reviewChanges = "notes.reviewChanges"
    case noteChangedTitle = "notes.noteChangedTitle"
    case noteChangedBody = "notes.noteChangedBody"
    case yourDraft = "notes.yourDraft"
    case useMyDraft = "notes.useMyDraft"
    case useLatest = "notes.useLatest"
    case overwriteTitle = "notes.overwriteTitle"
    case overwriteBody = "notes.overwriteBody"
    case saveFailed = "notes.saveFailed"
    case saveUnconfirmed = "notes.saveUnconfirmed"
    case noDifferences = "notes.noDifferences"
    case onlyInLatest = "notes.onlyInLatest"
    case onlyInDraft = "notes.onlyInDraft"
    case formatting = "notes.formatting"
    case bulletList = "notes.bulletList"
    case quote = "notes.quote"
    case continueToNote = "notes.continueToNote"
    case folderStagedNote = "notes.folderStagedNote"
    case chooseFolder = "notes.chooseFolder"
    case searchFolders = "notes.searchFolders"
    case selected = "notes.selected"
    case noFolders = "notes.noFolders"
    case taskTitle = "notes.taskTitle"
    case editTask = "notes.editTask"
    case sourceNote = "notes.sourceNote"
    case notesField = "notes.notesField"
    case addDate = "notes.addDate"
    case dateAndTime = "notes.dateAndTime"
    case time = "notes.time"
    case removeDate = "notes.removeDate"
    case reminderAuto = "notes.reminderAuto"
    case reminderAutoHint = "notes.reminderAutoHint"
    case taskOptions = "notes.taskOptions"
    case scopeFromSource = "notes.scopeFromSource"
    case reopen = "notes.reopen"
    case taskCompleteFailed = "notes.taskCompleteFailed"
    case taskDeleted = "notes.taskDeleted"
    case noteDeleted = "notes.noteDeleted"
    case emptyFolder = "notes.emptyFolder"
    case searchNotes = "notes.searchNotes"
    case searchTasks = "notes.searchTasks"
    case searchEverything = "notes.searchEverything"
    case noResultsFor = "notes.noResultsFor"
    case graphUnavailable = "notes.graphUnavailable"
    case itemsAffected = "notes.itemsAffected"
    case pinSelected = "notes.pinSelected"
    case unpinSelected = "notes.unpinSelected"
    case cancelSelection = "notes.cancelSelection"
    case openingNote = "notes.openingNote"
    case dismissKeyboard = "notes.dismissKeyboard"
    case allTasks = "notes.allTasks"
    case noteLocationRoot = "notes.noteLocationRoot"

    case openTasks = "notes.openTasks"
    case folderCount = "notes.folderCount"
    case rootNotes = "notes.rootNotes"
    case doneTasks = "notes.doneTasks"
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
    case openingLabel = "opening.label"
    case openingProgressValue = "opening.progressValue"
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
