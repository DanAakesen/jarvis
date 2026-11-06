import Foundation
import JarvisCore
import SwiftUI

private enum JarvisNotesTab: String, CaseIterable, Identifiable {
    case notes
    case tasks
    case graph

    var id: String { rawValue }
}

private enum JarvisNotesSearchScope: String, CaseIterable, Identifiable {
    case all
    case notes
    case tasks

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

    private func text(_ key: JarvisNotesLocalizationKey) -> String {
        JarvisNotesLocalization.string(key, language: language)
    }

    fileprivate func title(for tab: JarvisNotesTab) -> String {
        switch tab {
        case .notes: notes
        case .tasks: tasks
        case .graph: graph
        }
    }

    fileprivate func title(for scope: JarvisNotesSearchScope) -> String {
        switch scope {
        case .all: all
        case .notes: notes
        case .tasks: tasks
        }
    }

}

struct JarvisNotesArea: View {
    let client: JarvisNotesClient?
    let language: JarvisAppLanguage
    let onRetryConfiguration: () -> Void

    @State private var selectedTab: JarvisNotesTab = .notes
    @State private var selectedScope: JarvisNotesSearchScope = .all
    @State private var selectedFolder = ""
    @State private var searchText = ""
    @State private var refreshVersion = 0
    @State private var tree: VaultNoteTree?
    @State private var recentVisits: [JarvisNoteVisit] = []
    @State private var directoryNotes: [String: [VaultNoteSummary]] = [:]
    @State private var directoryHasMore: [String: Bool] = [:]
    @State private var directoryLoading = Set<String>()
    @State private var taskList: VaultTaskList?
    @State private var graph: KnowledgeGraph?
    @State private var graphSearch: KnowledgeGraphSearch?
    @State private var taskSearch: VaultTaskList?
    @State private var loading = false
    @State private var searchLoading = false
    @State private var loadError: String?
    @State private var loadRetryUnavailable = false
    @State private var searchError: String?
    @State private var searchRetryUnavailable = false
    @State private var signInUnavailable = false
    @State private var notice: String?
    @State private var editor: VaultNote?
    @State private var editorPresented = false
    @State private var openingNotePaths = Set<String>()
    private struct NewNoteDestination: Identifiable {
        let id = UUID()
        let folder: String
    }
    @State private var newNoteDestination: NewNoteDestination?
    @State private var newFolderPresented = false
    @State private var confirmedFolders = Set<String>()
    @State private var newTaskPresented = false
    @State private var openedTask: VaultTask?
    @State private var pendingTaskIDs = Set<String>()
    @State private var noticePresented = false
    @State private var successConfirmation: JarvisSuccessConfirmation?

    private var copy: JarvisNotesCopy { JarvisNotesCopy(language: language) }

    private var isInitialLoading: Bool {
        guard loadError == nil else { return false }
        switch selectedTab {
        case .notes: return tree == nil
        case .tasks: return taskList == nil
        case .graph: return graph == nil
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if isInitialLoading {
                ScrollView {
                    JarvisPageLoadingView(title: copy.loading, identifier: "notes.loading")
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                }
            } else if selectedTab == .graph || searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                selectedContent
            } else {
                searchContent
            }
        }
        .jarvisPageHeader { header }
        .jarvisAmbientBackground()
        .jarvisSuccessFeedback($successConfirmation)
        .environment(\.locale, language.locale)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !isInitialLoading {
                VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                    searchBar
                }
                .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                .padding(.top, JarvisDesignTokens.notesSectionSpacing)
                .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
            }
        }
        .scrollEdgeEffectHidden(for: .bottom)
        .task(id: "\(selectedTab.rawValue)-\(refreshVersion)") {
            await loadSelectedTab(force: refreshVersion > 0)
        }
        .task(id: searchKey) {
            await search()
        }
        .sheet(item: $newNoteDestination) { destination in
            if let client {
                JarvisNewNoteSheet(
                    client: client,
                    copy: copy,
                    initialFolder: destination.folder,
                    onCreated: { path in
                        newNoteDestination = nil
                        successConfirmation = JarvisSuccessConfirmation(message: copy.saved)
                        refreshVersion += 1
                        await openNote(path: path)
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .sheet(isPresented: $newFolderPresented) {
            if let client {
                JarvisNewFolderSheet(client: client, copy: copy, initialFolder: selectedFolder) { path in
                    newFolderPresented = false
                    confirmedFolders.insert(path)
                    selectedTab = .notes
                    selectedFolder = path
                    directoryNotes[path] = []
                    directoryHasMore[path] = false
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .sheet(item: $openedTask) { task in
            taskDetail(task, today: taskList?.today ?? "")
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $newTaskPresented) {
            if let client {
                JarvisNewTaskSheet(
                    client: client,
                    copy: copy,
                    onCreated: {
                        newTaskPresented = false
                        refreshVersion += 1
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .navigationDestination(isPresented: $editorPresented) {
            if let current = editor {
                JarvisNoteEditorView(
                    client: client,
                    copy: copy,
                    note: current,
                    onSaved: { refreshed in
                        editor = refreshed
                        refreshVersion += 1
                    },
                    onClose: { editorPresented = false }
                )
            }
        }
        .alert(copy.title, isPresented: $noticePresented) {
            Button(copy.ok, role: .cancel) { notice = nil }
        } message: {
            Text(notice ?? "")
        }
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityLabel(copy.title)
    }

    private var header: some View {
        JarvisPageHeader(title: copy.title, language: language)
    }

    /// The create menu sits beside the search field so the thumb reaches it.
    private var plusMenu: some View {
        JarvisMenuButton(
            title: copy.create,
            systemImage: "plus",
            identifier: "notes.plus",
            isDisabled: client == nil || signInUnavailable
        ) {
            Button {
                newNoteDestination = NewNoteDestination(folder: selectedFolder)
            } label: {
                Label(copy.newNote, systemImage: "note.text")
            }
            .accessibilityIdentifier("notes.newNote")
            Button { newFolderPresented = true } label: {
                Label(copy.newFolderTitle, systemImage: "folder.badge.plus")
            }
            .accessibilityIdentifier("notes.newFolder")
            Button {
                newTaskPresented = true
            } label: {
                Label(copy.newTask, systemImage: "checklist")
            }
            .accessibilityIdentifier("notes.newTask")
        }
    }

    /// The page head, as the first scrolling row: data phrase, Overview hero, then the Notes / Tasks / Graph
    /// segmented bar and, on Notes, the Recent strip. The shared skeleton is shown until the first data arrives.
    @ViewBuilder
    private var pageHead: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            if selectedTab == .graph, let graph {
                JarvisPageHeadline(phrase: JarvisNotesPagePhrase.graph(graph, language: language))
            } else if let taskList {
                JarvisPageHeadline(phrase: JarvisNotesPagePhrase.tasks(taskList, language: language))
            }
            if selectedTab != .graph, taskList != nil || tree != nil {
                overviewHero
            }
            tabSwitcher
            if selectedTab == .notes, selectedFolder.isEmpty, let graph {
                JarvisNotesRecentStrip(
                    title: copy.recent,
                    notes: JarvisNotesPresentation.recentlyOpenedNotes(graph, visits: recentVisits),
                    visits: recentVisits,
                    language: language,
                    onOpen: { node in Task { await openNote(path: node.path) } }
                )
            }
        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
    }

    private var overviewHero: some View {
        let counts = taskList.map { JarvisNotesPagePhrase.TaskCounts($0) }
        return JarvisNotesOverviewHero(
            title: copy.overview,
            linkCount: graph?.edges.count,
            linksLabel: copy.links,
            stats: [
                JarvisPageStat(id: "notes", value: graph?.nodes.count ?? tree?.rootNoteCount ?? 0, label: copy.notes, systemImage: "note.text", tint: JarvisDesignTokens.primaryAccent),
                JarvisPageStat(id: "open", value: counts?.open ?? 0, label: copy.openTasks, systemImage: "checklist", tint: JarvisDesignTokens.primaryAccent),
                JarvisPageStat(id: "overdue", value: counts?.overdue ?? 0, label: copy.overdue, systemImage: "flag", tint: JarvisDesignTokens.primaryAccent),
                JarvisPageStat(id: "today", value: counts?.dueToday ?? 0, label: copy.today, systemImage: "clock", tint: JarvisDesignTokens.primaryAccent),
            ],
            shares: graph.map { JarvisNotesPresentation.folderShares($0) } ?? [],
            rootTitle: copy.vaultRoot,
            language: language
        )
    }

    private var tabSwitcher: some View {
        HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            JarvisSegmentedBar(
                title: copy.title,
                identifierPrefix: "notes.tab",
                items: JarvisNotesTab.allCases.map {
                    JarvisTabItem(tag: $0, title: copy.title(for: $0), identifier: "notes.tab.\($0.rawValue)")
                },
                selection: $selectedTab
            )
            if selectedTab == .graph {
                JarvisIconButton(
                    title: copy.resetGraph,
                    systemImage: "arrow.counterclockwise",
                    identifier: "notes.resetGraph"
                ) {
                    graphSearch = nil
                    searchText = ""
                    refreshVersion += 1
                }
            }
        }
    }

    /// A loading, error or empty state still shows the segmented bar so the tabs stay reachable.
    private func tabState(icon: String, title: String, retry: (() -> Void)?) -> some View {
        VStack(spacing: 0) {
            tabSwitcher
                .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
            stateView(icon: icon, title: title, retry: retry)
        }
    }

    @ViewBuilder
    private var selectedContent: some View {
        switch selectedTab {
        case .notes:
            notesContent
        case .tasks:
            tasksContent
        case .graph:
            graphContent
        }
    }

    private var currentDirectoryNotes: [VaultNoteSummary] {
        JarvisNotesPresentation.directoryNotes(directoryNotes[selectedFolder] ?? [], in: selectedFolder)
    }

    private var childFolders: [VaultFolderNode] {
        JarvisNotesPresentation.childFolders(in: selectedFolder, paths: (tree?.directories ?? []) + Array(confirmedFolders))
    }

    private var notesContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                pageHead
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                    if let parent = JarvisNotesPresentation.parentFolder(of: selectedFolder) {
                        JarvisTextButton(title: copy.back, identifier: "notes.folder.back") { navigateToFolder(parent) }
                        Text(selectedFolder.replacingOccurrences(of: "/", with: " / "))
                            .font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("notes.folder.breadcrumb")
                    }
                    if let loadError {
                        stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
                    } else {
                        ForEach(childFolders) { folder in
                            JarvisRowButton(identifier: "notes.folder.\(folder.path)", action: { navigateToFolder(folder.path) }) {
                                HStack(spacing: JarvisPageHeaderMetrics.spacing) {
                                    Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                                    Image(systemName: "folder").foregroundStyle(JarvisNotesFolderPalette.color(folder.path))
                                    Text(folder.name).foregroundStyle(.primary)
                                    Spacer()
                                }
                            }
                        }
                        if directoryNotes[selectedFolder] != nil {
                            JarvisSectionHeadline(selectedFolder.isEmpty ? copy.vaultRoot : String(selectedFolder.split(separator: "/").last ?? "")) {
                                Text("\(currentDirectoryNotes.count)\(directoryHasMore[selectedFolder] == true ? "+" : "")")
                                    .font(.caption).foregroundStyle(.secondary)
                                    .accessibilityIdentifier("notes.folder.count")
                            }
                            if currentDirectoryNotes.isEmpty {
                                Text(copy.emptyNotes).font(.subheadline).foregroundStyle(.secondary)
                            } else {
                                JarvisRowGroup {
                                    ForEach(currentDirectoryNotes) { note in noteRow(note) }
                                }
                            }
                        }
                        if directoryLoading.contains(selectedFolder) {
                            JarvisLoadingView(title: copy.loading, size: .inline)
                        } else if directoryHasMore[selectedFolder] == true {
                            JarvisTextButton(title: copy.loadMore) { Task { await loadMoreDirectory(selectedFolder) } }
                        }
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            }
        }
        .refreshable { await loadSelectedTab(force: true) }
        .accessibilityIdentifier("notes.scroll")
    }

    private func navigateToFolder(_ folder: String) {
        selectedFolder = folder
        loadError = nil
        Task { await loadDirectory(folder, offset: 0) }
    }

    private var tasksContent: some View {
        Group {
            if loading && taskList == nil {
                tabState(icon: "checklist", title: copy.loading, retry: nil)
            } else if let loadError {
                tabState(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if let taskList {
                taskListView(taskList)
                    .refreshable { await loadSelectedTab(force: true) }
            } else {
                tabState(icon: "checklist", title: copy.emptyTasks, retry: nil)
            }
        }
    }

    private var graphContent: some View {
        Group {
            if loading && graph == nil {
                tabState(icon: "point.3.connected.trianglepath.dotted", title: copy.loading, retry: nil)
            } else if let loadError {
                tabState(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if let graph {
                if graph.nodes.isEmpty {
                    tabState(icon: "point.3.connected.trianglepath.dotted", title: copy.emptyGraph, retry: nil)
                } else {
                    VStack(spacing: 0) {
                        pageHead
                        if searchLoading {
                            JarvisLoadingView(title: copy.loading, size: .inline)
                        } else if let searchError {
                            Text(searchError).font(.caption).foregroundStyle(.secondary)
                        } else if !searchText.isEmpty, graphSearch?.hits.isEmpty == true {
                            Text(copy.noResults).font(.caption).foregroundStyle(.secondary)
                        }
                        JarvisNotesGraphView(
                            graph: graph,
                            copy: copy,
                            onOpen: { node in await openNote(path: node.path) },
                            searchMatches: Set(graphSearch?.hits.map(\.nodeId) ?? [])
                        )
                        .id(refreshVersion)
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                    }
                    .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
                }
            }
        }
    }

    private var searchContent: some View {
        Group {
            if searchLoading {
                stateView(icon: "magnifyingglass", title: copy.loading, retry: nil)
            } else if let searchError {
                stateView(icon: "wifi.exclamationmark", title: searchError, retry: searchRetryUnavailable ? nil : refreshCurrent)
            } else if visibleSearchNotes.isEmpty && visibleSearchTasks.isEmpty {
                stateView(icon: "magnifyingglass", title: copy.noResults, retry: nil)
            } else {
                JarvisList(customRowBackgrounds: true) {
                    if !visibleSearchNotes.isEmpty {
                        Section {
                            ForEach(visibleSearchNotes, id: \.nodeId) { hit in
                                if let node = graphSearch?.graph.nodes.first(where: { $0.id == hit.nodeId }) {
                                    Button {
                                        Task { await openNote(path: node.path) }
                                    } label: {
                                        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
                                            Text(node.title).foregroundStyle(.primary)
                                            if !hit.snippet.isEmpty {
                                                Text(hit.snippet)
                                                    .font(.subheadline)
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(JarvisDesignTokens.notesSearchSnippetLineLimit)
                                            }
                                        }
                                        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight, alignment: .leading)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(openingNotePaths.contains(node.path))
                                    .listRowBackground(JarvisGlassSurface())
                                }
                            }
                        } header: {
                            JarvisSectionHeadline(copy.notes)
                        }
                    }
                    if !visibleSearchTasks.isEmpty {
                        taskSection(visibleSearchTasks, title: copy.tasks, today: taskSearch?.today ?? taskList?.today ?? "")
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            JarvisSearchField(
                placeholder: copy.search,
                text: $searchText,
                identifier: "notes.search",
                clearTitle: copy.clearSearch
            )
            plusMenu
        }
    }

    private var visibleSearchNotes: [KnowledgeSearchHit] {
        guard let hits = graphSearch?.hits else { return [] }
        guard selectedFolder.isEmpty else {
            return hits.filter { hit in
                graphSearch?.graph.nodes.first(where: { $0.id == hit.nodeId })?.directory == selectedFolder
            }
        }
        return hits
    }

    private var visibleSearchTasks: [VaultTask] {
        taskSearch?.items ?? []
    }

    private var searchKey: String {
        "\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))|\(selectedScope.rawValue)|\(selectedTab.rawValue)|\(refreshVersion)"
    }

    private func noteRow(_ note: VaultNoteSummary) -> some View {
        Button {
            Task { await openNote(path: note.path) }
        } label: {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                if openingNotePaths.contains(note.path) {
                    JarvisLoadingView()
                        .frame(width: JarvisDesignTokens.notesIconSize, height: JarvisDesignTokens.notesIconSize)
                } else {
                    Image(systemName: "note.text")
                        .font(.system(size: JarvisDesignTokens.notesIconSize))
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    Text(note.title).foregroundStyle(.primary)
                    Text(JarvisNotesLocalization.formattedUpdatedDate(note.updatedAt, language: copy.language))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .jarvisListRow()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(openingNotePaths.contains(note.path))
        .accessibilityLabel(note.title)
        .accessibilityIdentifier("notes.note.\(note.path)")
    }

    private func taskListView(_ list: VaultTaskList) -> some View {
        let groups = JarvisNotesLogic.taskGroups(list.items, today: list.today)
        return Group {
            if groups.overdue.isEmpty && groups.today.isEmpty && groups.upcoming.isEmpty && groups.noDate.isEmpty {
                ScrollView {
                    VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                        pageHead
                        stateView(icon: "checklist", title: copy.emptyTasks, retry: nil)
                    }
                }
            } else {
                JarvisList(customRowBackgrounds: true) {
                    pageHead
                } content: {
                    taskSection(groups.overdue, title: copy.overdue, today: list.today)
                    taskSection(groups.today, title: copy.today, today: list.today)
                    taskSection(groups.upcoming, title: copy.upcoming, today: list.today)
                    taskSection(groups.noDate, title: copy.noDate, today: list.today)
                }
                .listStyle(.plain)
                .listRowSpacing(0)
                .listSectionSpacing(JarvisPageHeaderMetrics.spacing)
                .contentMargins(.top, 0, for: .scrollContent)
                .contentMargins(.bottom, JarvisDesignTokens.notesHorizontalInset, for: .scrollContent)
                .scrollContentBackground(.hidden)
                .accessibilityIdentifier("notes.tasks.list")
            }
        }
    }

    @ViewBuilder
    private func taskSection(_ tasks: [VaultTask], title: String, today: String) -> some View {
        if !tasks.isEmpty {
            Section {
                // A plain List pins section headers above scrolling rows. Keep the
                // board heading in the flow so transparent chrome never overlays tasks.
                JarvisSectionHeadline(title, count: tasks.count)
                    .textCase(nil)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("notes.task.group.\(title)")
                ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                    taskRow(task, today: today, isFirst: index == 0, isLast: index == tasks.count - 1)
                }
            }
            .listSectionSeparator(.hidden)
        }
    }

    private func taskRow(_ task: VaultTask, today: String, isFirst: Bool, isLast: Bool) -> some View {
        JarvisTaskListRow(
            task: task,
            copy: copy,
            today: today,
            isWorking: pendingTaskIDs.contains(task.id),
            isFirst: isFirst,
            isLast: isLast,
            onComplete: { Task { await completeTask(task) } },
            onOpen: { openedTask = task }
        )
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 0, leading: 32, bottom: 0, trailing: 16))
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if !task.done {
                Button {
                    Task { await completeTask(task) }
                } label: {
                    Label(copy.complete, systemImage: "checkmark")
                }
                .tint(.accentColor)
                .disabled(pendingTaskIDs.contains(task.id))
            }
        }
    }

    private func taskDetail(_ task: VaultTask, today: String) -> some View {
        JarvisForm {
            Section {
                Text(JarvisTaskTitle.formatted(task.text)).font(.headline)
            }
            Section {
                LabeledContent(copy.scope, value: task.scope == .work ? copy.work : copy.personal)
                if let due = task.dueDate {
                    LabeledContent(
                        copy.dueDate,
                        value: due == today ? copy.today : JarvisNotesLocalization.formattedDueDate(due, language: copy.language)
                    )
                }
                if let time = task.dueTime {
                    LabeledContent(
                        copy.dueTime,
                        value: JarvisNotesLocalization.formattedDueTime(time, language: copy.language)
                    )
                }
                Text(priorityText(task.priority))
            }
            Section {
                Text(task.path)
                    .font(.footnote)
                    .accessibilityIdentifier("notes.task.source.path")
                if let heading = task.heading, !heading.isEmpty {
                    Text(heading)
                        .font(.footnote)
                        .accessibilityIdentifier("notes.task.source.heading")
                }
            } header: {
                Text(copy.source).foregroundStyle(.primary)
            }
            if !task.done {
                Section {
                    JarvisLabelledButton(title: copy.complete) {
                        openedTask = nil
                        Task { await completeTask(task) }
                    }
                }
            }
        }
        .accessibilityIdentifier("notes.task.detail")
    }

    private func stateView(icon: String, title: String, retry: (() -> Void)?) -> some View {
        VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            Image(systemName: icon)
                .font(.system(size: JarvisDesignTokens.notesEmptyIconSize))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(title)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let retry {
                JarvisLabelledButton(title: copy.retry, action: retry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    private func loadSelectedTab(force: Bool = false) async {
        guard let client else {
            loadError = copy.unavailable
            loading = false
            return
        }
        await JarvisAppCache.bindIfNeeded()
        recentVisits = await JarvisAppCache.shared.recentNoteVisits()
        loading = true
        loadError = nil
        loadRetryUnavailable = false
        signInUnavailable = false
        defer { loading = false }
        do {
            switch selectedTab {
            case .notes:
                if force || graph == nil, let result = try? await client.graph() {
                    guard !Task.isCancelled else { return }
                    graph = result
                }
                if force || taskList == nil, let result = try? await openTasks(client, force: force) {
                    guard !Task.isCancelled else { return }
                    taskList = result
                }
                if force || tree == nil {
                    let repository = await treeRepository(client)
                    if !force, tree == nil, let cachedTree = await repository.resolve(cacheOnly: true).value {
                        await applyTree(cachedTree, force: false)
                        loading = false
                    }
                    let resolved = await repository.resolve(force: force)
                    guard !Task.isCancelled else { return }
                    if let nextTree = resolved.value {
                        if force || nextTree != tree { await applyTree(nextTree, force: force) }
                    } else if let error = resolved.error {
                        throw error
                    }
                }
            case .tasks:
                if force || graph == nil, let result = try? await client.graph() {
                    guard !Task.isCancelled else { return }
                    graph = result
                }
                if force || taskList == nil {
                    let result = try await openTasks(client, force: force)
                    guard !Task.isCancelled else { return }
                    taskList = result
                }
            case .graph:
                if force || graph == nil {
                    let result = try await client.graph()
                    guard !Task.isCancelled else { return }
                    graph = result
                }
            }
        } catch {
            guard !Task.isCancelled else { return }
            loadError = message(for: error)
            loadRetryUnavailable = authorizationUnavailable(error)
            signInUnavailable = loadRetryUnavailable
        }
    }

    private func treeRepository(_ client: JarvisNotesClient) async -> JarvisRepository<VaultNoteTree> {
        await JarvisAppCache.repository(.notes, scope: "tree") { try await client.fetchFolderTree(validator: $0) }
    }

    /// The open tasks, read through the repository: fresh cache costs no request.
    private func openTasks(_ client: JarvisNotesClient, force: Bool) async throws -> VaultTaskList {
        let repository: JarvisRepository<VaultTaskList> = await JarvisAppCache.repository(.tasks, scope: "open") {
            try await client.fetchOpenTasks(validator: $0)
        }
        let resolved = await repository.resolve(force: force)
        if let value = resolved.value { return value }
        throw resolved.error ?? JarvisClientError.networkFailure
    }

    /// The first page of a folder or directory, read through the repository; later pages go straight to the client.
    private func firstPage(
        _ client: JarvisNotesClient,
        folder: String? = nil,
        directory: String? = nil,
        force: Bool
    ) async throws -> VaultNotePage {
        let scope = folder.map { "folder:\($0)" } ?? "dir:\(directory ?? "")"
        let repository: JarvisRepository<VaultNotePage> = await JarvisAppCache.repository(.notes, scope: scope) {
            try await client.fetchNotes(directory: directory, folder: folder, validator: $0)
        }
        let resolved = await repository.resolve(force: force)
        if let value = resolved.value { return value }
        throw resolved.error ?? JarvisClientError.networkFailure
    }

    private func applyTree(_ nextTree: VaultNoteTree, force: Bool) async {
        tree = nextTree
        confirmedFolders.subtract(nextTree.directories)
        if !selectedFolder.isEmpty,
           !(nextTree.directories + Array(confirmedFolders)).contains(where: { $0 == selectedFolder || $0.hasPrefix(selectedFolder + "/") }) {
            selectedFolder = ""
        }
        directoryNotes = [:]
        directoryHasMore = [:]
        await loadDirectory(selectedFolder, offset: 0, force: force)
    }

    private func loadDirectory(_ directory: String, offset: Int, force: Bool = false) async {
        guard let client, !directoryLoading.contains(directory) else { return }
        directoryLoading.insert(directory)
        defer { _ = directoryLoading.remove(directory) }
        do {
            let page = try await (offset == 0
                ? firstPage(client, directory: directory, force: force)
                : client.notes(directory: directory, offset: offset))
            let previous = offset == 0 ? [] : directoryNotes[directory] ?? []
            directoryNotes[directory] = previous + page.notes
            directoryHasMore[directory] = page.hasMore
        } catch {
            guard !Task.isCancelled, directory == selectedFolder else { return }
            signInUnavailable = authorizationUnavailable(error)
            loadError = message(for: error)
            loadRetryUnavailable = signInUnavailable
        }
    }

    private func loadMoreDirectory(_ directory: String) async {
        await loadDirectory(directory, offset: directoryNotes[directory]?.count ?? 0)
    }

    private func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
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
            return
        }
        searchLoading = true
        searchError = nil
        searchRetryUnavailable = false
        signInUnavailable = false
        graphSearch = nil
        taskSearch = nil
        do {
            if selectedScope != .tasks || selectedTab == .graph {
                let result = try await client.searchGraph(query)
                guard !Task.isCancelled else { return }
                graphSearch = result
                graph = result.graph
            }
            if selectedScope != .notes && selectedTab != .graph {
                let result = try await client.tasks(query: query, state: .all)
                guard !Task.isCancelled else { return }
                taskSearch = result
            }
        } catch {
            guard !Task.isCancelled else { return }
            searchError = message(for: error)
            searchRetryUnavailable = authorizationUnavailable(error)
            signInUnavailable = searchRetryUnavailable
        }
        searchLoading = false
    }

    private func openNote(path: String) async {
        guard let client else { return }
        guard !openingNotePaths.contains(path) else { return }
        openingNotePaths.insert(path)
        defer { _ = openingNotePaths.remove(path) }
        do {
            let note = try await client.readNote(path: path)
            guard !Task.isCancelled else { return }
            editor = note
            editorPresented = true
            await JarvisAppCache.shared.recordNoteOpen(path: path)
            recentVisits = await JarvisAppCache.shared.recentNoteVisits()
        } catch {
            guard !Task.isCancelled else { return }
            signInUnavailable = authorizationUnavailable(error)
            notice = message(for: error)
            noticePresented = true
        }
    }

    private func completeTask(_ task: VaultTask) async {
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

    private func refreshCurrent() {
        if client == nil { onRetryConfiguration() }
        refreshVersion += 1
    }

    private func priorityText(_ priority: VaultTask.Priority) -> String {
        switch priority {
        case .high: copy.priorityHigh
        case .medium: copy.priorityMedium
        case .normal: copy.priorityNormal
        }
    }

    private func message(for error: Error) -> String {
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

    private func authorizationUnavailable(_ error: Error) -> Bool {
        guard let error = error as? JarvisClientError else { return false }
        return error == .signInRequired || error == .notOwner
    }
}
