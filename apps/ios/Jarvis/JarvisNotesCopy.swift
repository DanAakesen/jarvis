import Foundation
import JarvisCore

enum JarvisNotesTab: String, CaseIterable, Identifiable, Sendable {
    case notes
    case tasks
    case graph

    var id: String { rawValue }
}

struct JarvisNotesCopy {
    let language: JarvisAppLanguage

    init(language: JarvisAppLanguage = .default) {
        self.language = language
    }

    var title: String { text(.title) }
    var overview: String { text(.overview) }
    var links: String { text(.links) }
    var recent: String { text(.recent) }
    var pinned: String { text(.pinned) }
    var pin: String { text(.pin) }
    var unpin: String { text(.unpin) }
    var browseFolders: String { text(.browseFolders) }
    var raw: String { text(.raw) }
    var formatted: String { text(.formatted) }
    var done: String { text(.done) }
    var yesterday: String { text(.yesterday) }
    var earlier: String { text(.earlier) }
    var heading: String { text(.heading) }
    var checklist: String { text(.checklist) }
    var addLink: String { text(.addLink) }
    var undo: String { text(.undo) }
    var emptyPinned: String { text(.emptyPinned) }

    var openTasks: String { text(.openTasks) }
    var folderCount: String { text(.folderCount) }
    var rootNotes: String { text(.rootNotes) }
    var doneTasks: String { text(.doneTasks) }
    var refresh: String { text(.refresh) }
    var search: String { text(.search) }
    var all: String { text(.all) }
    var notes: String { text(.notes) }
    var tasks: String { text(.tasks) }
    var graph: String { text(.graph) }
    var newNote: String { text(.newNote) }
    var newFolderTitle: String { text(.newFolder) }
    var newTask: String { text(.newTask) }
    var retry: String { text(.retry) }
    var loading: String { text(.loading) }
    var emptyNotes: String { text(.emptyNotes) }
    var emptyTasks: String { text(.emptyTasks) }
    var emptyGraph: String { text(.emptyGraph) }
    var noResults: String { text(.noResults) }
    var offline: String { text(.offline) }
    var unavailable: String { text(.unavailable) }
    var signIn: String { text(.signIn) }
    var notOwner: String { text(.notOwner) }
    var save: String { text(.save) }
    var saved: String { text(.saved) }
    var saving: String { text(.saving) }
    var unsaved: String { text(.unsaved) }
    var conflict: String { text(.conflict) }
    var reload: String { text(.reload) }
    var titleField: String { text(.titleField) }
    var edit: String { text(.edit) }
    var folderField: String { text(.folderField) }
    var priority: String { text(.priority) }
    var source: String { text(.source) }
    var folderName: String { text(.folderName) }
    var newFolderHere: String { text(.newFolderHere) }
    var useFolder: String { text(.useFolder) }
    var parentFolder: String { text(.parentFolder) }
    var folderSavedWithNote: String { text(.folderSavedWithNote) }
    var folderInvalidName: String { text(.folderInvalidName) }
    var folderAlreadyExists: String { text(.folderAlreadyExists) }
    var contentField: String { text(.contentField) }
    var dueDate: String { text(.dueDate) }
    var dueTime: String { text(.dueTime) }
    var scope: String { text(.scope) }
    var personal: String { text(.personal) }
    var work: String { text(.work) }
    var overdue: String { text(.overdue) }
    var today: String { text(.today) }
    var upcoming: String { text(.upcoming) }
    var noDate: String { text(.noDate) }
    var priorityHigh: String { text(.priorityHigh) }
    var priorityMedium: String { text(.priorityMedium) }
    var priorityNormal: String { text(.priorityNormal) }
    var complete: String { text(.complete) }
    var completed: String { text(.completed) }
    var resetGraph: String { text(.resetGraph) }
    var vaultRoot: String { text(.vaultRoot) }
    var loadMore: String { text(.loadMore) }
    var createHint: String { text(.createHint) }
    var discardTitle: String { text(.discardTitle) }
    var discard: String { text(.discard) }
    var cancel: String { text(.cancel) }
    var keepDraft: String { text(.keepDraft) }
    var latestVersion: String { text(.latestVersion) }
    var savedNeedsRefresh: String { text(.savedNeedsRefresh) }
    var unknownWrite: String { text(.unknownWrite) }
    var taskChanged: String { text(.taskChanged) }
    var noteMissing: String { text(.noteMissing) }
    var create: String { text(.create) }
    var dueTimeEnabled: String { text(.dueTimeEnabled) }
    var dueDateEnabled: String { text(.dueDateEnabled) }
    var openNote: String { text(.openNote) }
    var back: String { text(.back) }
    var ok: String { text(.ok) }
    var clearSearch: String { text(.clearSearch) }
    var expanded: String { text(.expanded) }
    var collapsed: String { text(.collapsed) }
    var graphPanZoomHint: String { text(.graphPanZoomHint) }

    func graphAccessibilityLabel(noteCount: Int) -> String { String(format: text(.graphAccessibilityLabel), noteCount) }

    func graphTasks(_ summary: JarvisGraphTaskSummary) -> String {
        switch summary {
        case .open(1): text(.graphOpenTaskOne)
        case .open(let count): String(format: text(.graphOpenTasksMany), count)
        case .none: text(.graphNoOpenTasks)
        case .unavailable: text(.graphTasksUnavailable)
        }
    }

    func graphConnections(_ count: Int) -> String {
        count == 1 ? text(.graphConnectionsOne) : String(format: text(.graphConnectionsMany), count)
    }

    func text(_ key: JarvisNotesLocalizationKey) -> String {
        JarvisNotesLocalization.string(key, language: language)
    }

    subscript(_ key: JarvisNotesLocalizationKey) -> String { text(key) }

    func title(for tab: JarvisNotesTab) -> String {
        switch tab {
        case .notes: notes
        case .tasks: tasks
        case .graph: graph
        }
    }
}
