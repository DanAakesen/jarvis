import Foundation
import JarvisCore
import SwiftUI

enum JarvisNotesSearchScope: String, CaseIterable, Identifiable, Sendable {
    case all
    case notes
    case tasks

    var id: String { rawValue }
}

enum JarvisNotesSheet: Identifiable {
    case newNote(folder: String, staged: [String])
    case newTask
    case newFolder
    case task(VaultTask)
    case folderScope
    case reorderPins
    case graphList

    var id: String {
        switch self {
        case .newNote: "newNote"
        case .newTask: "newTask"
        case .newFolder: "newFolder"
        case let .task(task): "task-\(task.id)"
        case .folderScope: "folderScope"
        case .reorderPins: "reorderPins"
        case .graphList: "graphList"
        }
    }
}

enum JarvisNotesPendingDeletion: Identifiable {
    case note(VaultNote, title: String)
    case task(VaultTask)

    var id: String {
        switch self {
        case let .note(note, _): "note-\(note.path)"
        case let .task(task): "task-\(task.id)"
        }
    }
}

enum JarvisNotesReadSection: CaseIterable, Hashable, Sendable {
    case graph, tasks, tree, directory
}

/// Notes, Tasks and Graph: one simple, fast page structure like Apple Notes and Reminders. A page title with its
/// header menu, the content, and a fixed dock with the Notes / Tasks / Graph switch, Search and a separate plus.
/// State lives here; the page views, header and dock are in the `JarvisNotesArea+…` extensions.
struct JarvisNotesArea: View {
    let client: JarvisNotesClient?
    let language: JarvisAppLanguage
    let onRetryConfiguration: () -> Void
    @Binding var selectedTab: JarvisNotesTab

    @State var selectedFolder = ""
    @State var searchText = ""
    @State var searchScope: JarvisNotesSearchScope = .all
    @State var noteSort: JarvisNoteSort = .updated
    @State var taskSort: JarvisTaskSort = .due
    @State var taskScope: JarvisTaskScopeFilter = .all
    @State var refreshVersion = 0
    @State var tree: VaultNoteTree?
    @State var pinnedPaths: [String] = []
    @State var pinnedTaskIDs: [String] = []
    @State var directoryNotes: [String: [VaultNoteSummary]] = [:]
    @State var directoryHasMore: [String: Bool] = [:]
    @State var directoryLoading = Set<String>()
    @State var directoryRequests: [String: UUID] = [:]
    @State var taskList: VaultTaskList?
    @State var graph: KnowledgeGraph?
    @State var graphSearch: KnowledgeGraphSearch?
    @State var taskSearch: VaultTaskList?
    @State var searchLoading = false
    @State var loadError: String?
    @State var loadRetryUnavailable = false
    @State var searchError: String?
    @State var searchRetryUnavailable = false
    @State var signInUnavailable = false
    @State var notice: String?
    @State var noticePresented = false
    @State var sheet: JarvisNotesSheet?
    @State var reader: VaultNote?
    @State var readerPresented = false
    @State var openingNotePaths = Set<String>()
    @State var pendingTaskIDs = Set<String>()
    @State var pendingDeletion: JarvisNotesPendingDeletion?
    @State var successConfirmation: JarvisSuccessConfirmation?
    @State var loadRequest = UUID()
    @State var searchRequest = UUID()
    @State var searchContext = ""
    @State var openingNoteRequest = UUID()
    @State var failedReads = Set<JarvisNotesReadSection>()
    @State var graphResetVersion = 0

    var copy: JarvisNotesCopy { JarvisNotesCopy(language: language) }

    var trimmedSearch: String { searchText.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isSearching: Bool { !trimmedSearch.isEmpty }

    var body: some View {
        ZStack {
            // The browsing page stays alive under search results, so leaving search restores its folder,
            // mode and scroll position exactly.
            selectedContent
                .opacity(isSearching && selectedTab != .graph ? 0 : 1)
                .allowsHitTesting(!(isSearching && selectedTab != .graph))
                .accessibilityHidden(isSearching && selectedTab != .graph)
            if isSearching && selectedTab != .graph {
                searchContent
                    .background { JarvisScreenBackground() }
            }
        }
        .jarvisPageHeader { header }
        .jarvisSuccessFeedback($successConfirmation)
        .environment(\.locale, language.locale)
        .jarvisPageFooter { dock }
        .jarvisAmbientBackground()
        .toolbarBackground(.hidden, for: .bottomBar)
        .scrollEdgeEffectHidden(true, for: .bottom)
        .task(id: "\(selectedTab.rawValue)-\(refreshVersion)") {
            await loadSelectedTab(force: refreshVersion > 0)
        }
        .task(id: searchKey) {
            await search()
        }
        .task { await applyScreenshotState() }
        .onDisappear {
            loadRequest = UUID()
            searchRequest = UUID()
            openingNoteRequest = UUID()
            directoryRequests = [:]
            directoryLoading = []
        }
        .sheet(item: $sheet) { presented in
            sheetContent(presented)
        }
        .navigationDestination(isPresented: $readerPresented) {
            if let current = reader {
                JarvisNoteReaderView(
                    client: client, copy: copy, language: language, note: current, graph: graph,
                    isPinned: pinnedPaths.contains(current.path),
                    onPin: { pinned in Task { await setPinned(current.path, pinned: pinned) } },
                    onDeleted: { path in
                        readerPresented = false
                        Task { await noteDeleted(path) }
                    },
                    onNoteChanged: { refreshed in
                        reader = refreshed
                        refreshVersion += 1
                    },
                    onOpenPath: { path in Task { await openNote(path: path) } },
                    onRetryGraph: { refreshVersion += 1 },
                    onClose: { readerPresented = false }
                )
                .id(current.path)
            }
        }
        .confirmationDialog(
            deletionTitle, isPresented: Binding(get: { pendingDeletion != nil }, set: { if !$0 { pendingDeletion = nil } }),
            titleVisibility: .visible, presenting: pendingDeletion
        ) { item in
            Button(deletionAction(item), role: .destructive) { Task { await confirmDeletion(item) } }
            Button(copy.cancel, role: .cancel) {}
        } message: { item in
            Text(deletionMessage(item))
        }
        .alert(copy.title, isPresented: $noticePresented) {
            Button(copy.ok, role: .cancel) { notice = nil }
        } message: {
            Text(notice ?? "")
        }
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityLabel(copy.title)
    }

    // MARK: Sheets

    @ViewBuilder
    private func sheetContent(_ presented: JarvisNotesSheet) -> some View {
        if let client {
            switch presented {
            case let .newNote(folder, staged):
                JarvisNoteEditorSheet(client: client, copy: copy, mode: .create(folder: folder, staged: staged)) { path, note in
                    sheet = nil
                    successConfirmation = JarvisSuccessConfirmation(message: copy.saved)
                    refreshVersion += 1
                    if let note {
                        reader = note
                        readerPresented = true
                    } else {
                        Task { await openNote(path: path) }
                    }
                }
            case .newTask:
                JarvisTaskEditorSheet(client: client, copy: copy, mode: .create(scope: .work)) {
                    sheet = nil
                    successConfirmation = JarvisSuccessConfirmation(message: copy.saved)
                    refreshVersion += 1
                }
            case .newFolder:
                JarvisNewFolderSheet(
                    client: client, copy: copy, initialParent: selectedFolder,
                    onContinue: { path in sheet = .newNote(folder: path, staged: [path]) },
                    onClose: { sheet = nil }
                )
            case let .task(task):
                JarvisTaskDetailSheet(
                    task: task, today: taskList?.today ?? "", copy: copy, client: client,
                    onOpenSource: { path in
                        sheet = nil
                        Task { await openNote(path: path) }
                    },
                    onChanged: { refreshVersion += 1 },
                    onClose: { sheet = nil }
                )
            case .folderScope:
                JarvisFolderScopeSheet(client: client, copy: copy, initial: selectedFolder) { folder in
                    sheet = nil
                    navigateToFolder(folder)
                }
            case .reorderPins:
                JarvisReorderPinsSheet(
                    copy: copy, items: pinnedItems,
                    onChanged: { order in
                        pinnedPaths = order
                        Task { await JarvisAppCache.shared.setPinnedNotePaths(order) }
                    },
                    onClose: { sheet = nil }
                )
            case .graphList:
                graphListSheet
            }
        } else if case .graphList = presented {
            graphListSheet
        }
    }

    // MARK: Deletion

    private var deletionTitle: String {
        if case .task = pendingDeletion { return copy[.deleteTaskTitle] }
        return copy[.deleteNoteTitle]
    }

    private func deletionAction(_ item: JarvisNotesPendingDeletion) -> String {
        if case .task = item { return copy[.deleteTask] }
        return copy[.deleteNote]
    }

    private func deletionMessage(_ item: JarvisNotesPendingDeletion) -> String {
        switch item {
        case let .note(_, title): "\(title)\n\(copy[.deleteNoteMessage])"
        case let .task(task): "\(JarvisTaskTitle.plain(task.text))\n\(copy[.deleteTaskMessage])"
        }
    }

    // MARK: Loading

    var searchKey: String {
        "\(trimmedSearch)|\(searchScope.rawValue)|\(selectedTab.rawValue)|\(refreshVersion)"
    }

    var currentSearchContext: String {
        "\(trimmedSearch)|\(searchScope.rawValue)|\(selectedTab.rawValue)"
    }

    func refreshCurrent() {
        if client == nil { onRetryConfiguration() }
        refreshVersion += 1
    }

    func message(for error: Error) -> String {
        if let error = error as? JarvisClientError {
            switch error {
            case .signInRequired: return copy.signIn
            case .notOwner: return copy.notOwner
            case .networkFailure, .timedOut: return copy.offline
            default: return copy.unavailable
            }
        }
        if let error = error as? JarvisNotesClientError {
            switch error {
            case .noteConflict: return copy.conflict
            case .writeOutcomeUnknown: return copy.unknownWrite
            case .taskConflict: return copy.taskChanged
            case .folderAlreadyExists: return copy.folderAlreadyExists
            case .noteNotFound: return copy.noteMissing
            case .invalidRequest, .invalidResponse: return copy.unavailable
            }
        }
        return copy.unavailable
    }

    func authorizationUnavailable(_ error: Error) -> Bool {
        guard let error = error as? JarvisClientError else { return false }
        return error == .signInRequired || error == .notOwner
    }

    func loadSelectedTab(force: Bool = false) async {
        let request = UUID()
        loadRequest = request
        let tab = selectedTab
        guard let client else {
            loadError = copy.unavailable
            failedReads = Set(JarvisNotesReadSection.allCases)
            return
        }
        await JarvisAppCache.bindIfNeeded()
        guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
        pinnedPaths = await JarvisAppCache.shared.pinnedNotePaths()
        pinnedTaskIDs = await JarvisAppCache.shared.pinnedTaskIDs()
        guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
        loadError = nil
        loadRetryUnavailable = false
        signInUnavailable = false
        let sections: [JarvisNotesReadSection]
        switch tab {
        case .notes: sections = [.graph, .tree, .directory]
        case .tasks: sections = [.tasks]
        case .graph: sections = [.graph]
        }
        await withTaskGroup(of: Void.self) { group in
            for section in sections {
                group.addTask {
                    await loadSection(section, client: client, force: force, request: request, tab: tab)
                }
            }
        }
    }

    @MainActor
    private func loadSection(
        _ section: JarvisNotesReadSection,
        client: JarvisNotesClient,
        force: Bool,
        request: UUID,
        tab: JarvisNotesTab
    ) async {
        guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
        failedReads.remove(section)
        do {
            switch section {
            case .tree:
                let repository = await treeRepository(client)
                if !force, tree == nil, let cachedTree = await repository.resolve(cacheOnly: true).value {
                    guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
                    applyTree(cachedTree)
                }
                let resolved = await repository.resolve(force: force)
                guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
                if let nextTree = resolved.value { applyTree(nextTree) }
                if let error = resolved.error { throw error }
            case .directory:
                await loadDirectory(selectedFolder, offset: 0, force: force)
            case .tasks:
                let repository: JarvisRepository<VaultTaskList> = await JarvisAppCache.repository(.tasks, scope: "open") {
                    try await client.fetchOpenTasks(validator: $0)
                }
                for await update in repository.updates(force: force) {
                    guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
                    switch update {
                    case .cached(let value, _), .fresh(let value): taskList = value
                    case .failed(let error, _): throw error
                    case .refreshing: break
                    }
                }
            case .graph:
                let repository: JarvisRepository<KnowledgeGraph> = await JarvisAppCache.repository(.notes, scope: "graph") { _ in
                    .modified(try await client.graph(), validator: nil)
                }
                for await update in repository.updates(force: force) {
                    guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
                    switch update {
                    case .cached(let value, _), .fresh(let value): graph = value
                    case .failed(let error, _): throw error
                    case .refreshing: break
                    }
                }
            }
        } catch {
            guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
            failedReads.insert(section)
            loadError = message(for: error)
            loadRetryUnavailable = loadRetryUnavailable || authorizationUnavailable(error)
            signInUnavailable = signInUnavailable || loadRetryUnavailable
        }
    }

    private func treeRepository(_ client: JarvisNotesClient) async -> JarvisRepository<VaultNoteTree> {
        await JarvisAppCache.repository(.notes, scope: "tree") { try await client.fetchFolderTree(validator: $0) }
    }

    private func applyTree(_ nextTree: VaultNoteTree) {
        tree = nextTree
        if !selectedFolder.isEmpty,
           !nextTree.directories.contains(where: { $0 == selectedFolder || $0.hasPrefix(selectedFolder + "/") }) {
            selectedFolder = ""
        }
    }

    func navigateToFolder(_ folder: String) {
        selectedFolder = folder
        loadError = nil
        Task { await loadDirectory(folder, offset: 0) }
    }

    func loadDirectory(_ directory: String, offset: Int, force: Bool = false) async {
        guard let client, force || !directoryLoading.contains(directory) else { return }
        let request = UUID()
        directoryRequests[directory] = request
        directoryLoading.insert(directory)
        defer {
            if directoryRequests[directory] == request { _ = directoryLoading.remove(directory) }
        }
        do {
            if offset == 0 {
                let retainedCount = directoryNotes[directory]?.count ?? 0
                let repository: JarvisRepository<VaultNotePage> = await JarvisAppCache.repository(.notes, scope: "dir:\(directory)") {
                    try await client.fetchNotes(directory: directory, validator: $0)
                }
                for await update in repository.updates(force: force) {
                    guard !Task.isCancelled, directoryRequests[directory] == request else { return }
                    switch update {
                    case .cached(let page, _):
                        if directoryNotes[directory] == nil {
                            directoryNotes[directory] = page.notes
                            directoryHasMore[directory] = page.hasMore
                        }
                    case .fresh(let page):
                        var notes = page.notes
                        var hasMore = page.hasMore
                        while hasMore, notes.count < retainedCount {
                            let next = try await client.notes(directory: directory, offset: notes.count)
                            guard !Task.isCancelled, directoryRequests[directory] == request else { return }
                            guard !next.notes.isEmpty else { break }
                            notes += next.notes
                            hasMore = next.hasMore
                        }
                        directoryNotes[directory] = notes
                        directoryHasMore[directory] = hasMore
                    case .failed(let error, _): throw error
                    case .refreshing: break
                    }
                }
            } else {
                let page = try await client.notes(directory: directory, offset: offset)
                guard !Task.isCancelled, directoryRequests[directory] == request else { return }
                directoryNotes[directory] = (directoryNotes[directory] ?? []) + page.notes
                directoryHasMore[directory] = page.hasMore
            }
        } catch {
            guard !Task.isCancelled, directoryRequests[directory] == request, directory == selectedFolder else { return }
            signInUnavailable = authorizationUnavailable(error)
            loadError = message(for: error)
            loadRetryUnavailable = signInUnavailable
        }
    }

    func loadMoreDirectory(_ directory: String) async {
        await loadDirectory(directory, offset: directoryNotes[directory]?.count ?? 0)
    }

    // MARK: Search

    func search() async {
        let context = currentSearchContext
        let request = UUID()
        searchRequest = request
        if searchContext != context {
            graphSearch = nil
            taskSearch = nil
            searchContext = context
        }
        let query = trimmedSearch
        guard !query.isEmpty else {
            graphSearch = nil
            taskSearch = nil
            searchError = nil
            searchLoading = false
            signInUnavailable = false
            return
        }
        guard let client else {
            searchError = copy.unavailable
            searchLoading = false
            return
        }
        // Typing pauses briefly so each keystroke does not start two network reads.
        try? await Task.sleep(for: .milliseconds(Int(JarvisDesignTokens.searchDebounceMilliseconds)))
        guard !Task.isCancelled, searchRequest == request else { return }
        searchLoading = true
        searchError = nil
        searchRetryUnavailable = false
        signInUnavailable = false
        let scope = searchScope
        let tab = selectedTab
        async let notes: Void = searchNotes(client, query: query, scope: scope, tab: tab, request: request)
        async let tasks: Void = searchTasks(client, query: query, scope: scope, tab: tab, request: request)
        _ = await (notes, tasks)
        if searchRequest == request { searchLoading = false }
    }

    @MainActor
    private func searchNotes(
        _ client: JarvisNotesClient, query: String, scope: JarvisNotesSearchScope,
        tab: JarvisNotesTab, request: UUID
    ) async {
        guard scope != .tasks || tab == .graph else { return }
        do {
            let result = try await client.searchGraph(query)
            guard !Task.isCancelled, searchRequest == request else { return }
            graphSearch = result
        } catch {
            guard !Task.isCancelled, searchRequest == request else { return }
            searchError = message(for: error)
            searchRetryUnavailable = searchRetryUnavailable || authorizationUnavailable(error)
            signInUnavailable = signInUnavailable || searchRetryUnavailable
        }
    }

    @MainActor
    private func searchTasks(
        _ client: JarvisNotesClient, query: String, scope: JarvisNotesSearchScope,
        tab: JarvisNotesTab, request: UUID
    ) async {
        guard scope != .notes, tab != .graph else { return }
        do {
            let result = try await client.tasks(query: query, state: .all)
            guard !Task.isCancelled, searchRequest == request else { return }
            taskSearch = result
        } catch {
            guard !Task.isCancelled, searchRequest == request else { return }
            searchError = message(for: error)
            searchRetryUnavailable = searchRetryUnavailable || authorizationUnavailable(error)
            signInUnavailable = signInUnavailable || searchRetryUnavailable
        }
    }

    // MARK: Actions

    func openNote(path: String) async {
        guard let client else { return }
        guard !openingNotePaths.contains(path) else { return }
        let request = UUID()
        openingNoteRequest = request
        openingNotePaths.insert(path)
        defer { _ = openingNotePaths.remove(path) }
        do {
            let note = try await client.readNote(path: path)
            guard !Task.isCancelled, openingNoteRequest == request else { return }
            reader = note
            readerPresented = true
        } catch {
            guard !Task.isCancelled, openingNoteRequest == request else { return }
            signInUnavailable = authorizationUnavailable(error)
            notice = message(for: error)
            noticePresented = true
        }
    }

    func setPinned(_ path: String, pinned: Bool) async {
        await JarvisAppCache.shared.setNotePinned(path: path, pinned: pinned)
        pinnedPaths = await JarvisAppCache.shared.pinnedNotePaths()
    }

    func setTaskPinned(_ id: String, pinned: Bool) async {
        await JarvisAppCache.shared.setTaskPinned(id: id, pinned: pinned)
        pinnedTaskIDs = await JarvisAppCache.shared.pinnedTaskIDs()
    }

    func noteDeleted(_ path: String) async {
        await JarvisAppCache.invalidateAll(.notes)
        await JarvisAppCache.invalidateAll(.tasks)
        await setPinned(path, pinned: false)
        for directory in Array(directoryNotes.keys) {
            directoryNotes[directory]?.removeAll { $0.path == path }
        }
        refreshVersion += 1
    }

    /// A swipe or menu asks to delete: read the note's current version first, then wait for the owner's confirmation.
    func requestDeleteNote(path: String, title: String) async {
        guard let client, !openingNotePaths.contains(path) else { return }
        openingNotePaths.insert(path)
        defer { _ = openingNotePaths.remove(path) }
        do {
            let note = try await client.readNote(path: path)
            pendingDeletion = .note(note, title: title)
        } catch {
            guard !Task.isCancelled else { return }
            notice = message(for: error)
            noticePresented = true
        }
    }

    @MainActor
    func confirmDeletion(_ item: JarvisNotesPendingDeletion) async {
        guard let client else { return }
        switch item {
        case let .note(note, _):
            guard openingNotePaths.insert(note.path).inserted else { return }
            defer { _ = openingNotePaths.remove(note.path) }
            do {
                try await client.deleteNote(path: note.path, sha: note.sha)
                successConfirmation = JarvisSuccessConfirmation(message: copy[.noteDeleted])
                await noteDeleted(note.path)
            } catch JarvisNotesClientError.noteConflict {
                notice = copy[.deleteChanged]
                noticePresented = true
                refreshVersion += 1
            } catch {
                notice = copy[.deleteFailed]
                noticePresented = true
                refreshVersion += 1
            }
        case let .task(task):
            guard pendingTaskIDs.insert(task.id).inserted else { return }
            defer { _ = pendingTaskIDs.remove(task.id) }
            do {
                try await client.deleteTask(task)
                await JarvisAppCache.invalidateAll(.tasks)
                await setTaskPinned(task.pinKey, pinned: false)
                successConfirmation = JarvisSuccessConfirmation(message: copy[.taskDeleted])
                refreshVersion += 1
            } catch JarvisNotesClientError.taskConflict {
                notice = copy[.deleteChanged]
                noticePresented = true
                refreshVersion += 1
            } catch {
                notice = copy[.deleteFailed]
                noticePresented = true
                refreshVersion += 1
            }
        }
    }

    func completeTask(_ task: VaultTask) async {
        guard let client, !pendingTaskIDs.contains(task.id) else { return }
        pendingTaskIDs.insert(task.id)
        notice = nil
        defer { _ = pendingTaskIDs.remove(task.id) }
        do {
            _ = try await client.setTaskDone(task, done: true)
            successConfirmation = JarvisSuccessConfirmation(message: copy.completed)
            await JarvisAppCache.invalidateAll(.tasks)
            refreshVersion += 1
        } catch {
            guard !Task.isCancelled else { return }
            signInUnavailable = authorizationUnavailable(error)
            notice = message(for: error)
            noticePresented = true
            refreshVersion += 1
        }
    }
}
