import Foundation
import JarvisCore
import SwiftUI

private enum JarvisNotesTab: String, CaseIterable, Identifiable {
    case notes
    case tasks
    case list
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
    var list: String { text(.list) }
    var graph: String { text(.graph) }
    var newNote: String { text(.newNote) }
    var newTask: String { text(.newTask) }
    var retry: String { text(.retry) }
    var loading: String { text(.loading) }
    var emptyNotes: String { text(.emptyNotes) }
    var emptyTasks: String { text(.emptyTasks) }
    var emptyList: String { text(.emptyList) }
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
    func newFolder(_ name: String) -> String { "\(text(.newFolder)): \(name)" }
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
    var showGraphList: String { text(.showGraphList) }
    var showGraph: String { text(.showGraph) }
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
        case .list: list
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
    @State private var folders: [VaultFolderNode] = []
    @State private var expandedFolders = Set<String>()
    @State private var groupNotes: [String: [VaultNoteSummary]] = [:]
    @State private var groupHasMore: [String: Bool] = [:]
    @State private var groupLoading = Set<String>()
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
    @State private var newNotePresented = false
    @State private var newTaskPresented = false
    @State private var openedTask: VaultTask?
    @State private var newNoteFolder = ""
    @State private var pendingTaskIDs = Set<String>()
    @State private var noticePresented = false

    private var copy: JarvisNotesCopy { JarvisNotesCopy(language: language) }

    var body: some View {
        VStack(spacing: 0) {
            if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                selectedContent
            } else {
                searchContent
            }
        }
        .jarvisPageHeader { header }
        .jarvisAmbientBackground()
        .environment(\.locale, language.locale)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                if selectedTab == .notes { folderFilters }
                searchBar
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.top, JarvisDesignTokens.notesSectionSpacing)
            .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
        }
        .task(id: "\(selectedTab.rawValue)-\(refreshVersion)") {
            await loadSelectedTab()
        }
        .task(id: searchKey) {
            await search()
        }
        .sheet(isPresented: $newNotePresented) {
            if let client {
                JarvisNewNoteSheet(
                    client: client,
                    copy: copy,
                    initialFolder: newNoteFolder,
                    onCreated: { path in
                        newNotePresented = false
                        refreshVersion += 1
                        await openNote(path: path)
                    }
                )
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
                    onSaved: { refreshed in editor = refreshed },
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
                newNoteFolder = selectedFolder
                newNotePresented = true
            } label: {
                Label(copy.newNote, systemImage: "note.text")
            }
            .accessibilityIdentifier("notes.newNote")
            Button {
                newTaskPresented = true
            } label: {
                Label(copy.newTask, systemImage: "checklist")
            }
        }
    }

    /// The page head, as the first scrolling row: data phrase, Overview hero, then the Notes / Tasks / List / Graph
    /// segmented bar and, on Notes, the Recent strip. Nothing but the bar shows until the data is loaded.
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
            if selectedTab == .notes, let graph {
                JarvisNotesRecentStrip(
                    title: copy.recent,
                    notes: JarvisNotesPresentation.recentNotes(graph),
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

    private var graphFolderCounts: [String: Int] {
        Dictionary(uniqueKeysWithValues: (graph.map { JarvisNotesPresentation.folderShares($0) } ?? []).map { ($0.folder, $0.count) })
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
        case .list:
            listContent
        case .graph:
            graphContent
        }
    }

    private var notesContent: some View {
        Group {
            if loading && tree == nil {
                tabState(icon: "note.text", title: copy.loading, retry: nil)
            } else if let loadError {
                tabState(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if tree != nil, folderGroups.isEmpty {
                VStack(spacing: 0) {
                    JarvisPageHeadline(phrase: JarvisNotesPagePhrase.empty(language: language))
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                    tabState(icon: "note.text", title: copy.emptyNotes, retry: nil)
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                        pageHead
                        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                            ForEach(visibleFolderGroups, id: \.self) { folder in
                                folderSection(folder)
                            }
                        }
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                    }
                }
                .contentMargins(.bottom, JarvisNotesOverviewMetrics.bottomClearance, for: .scrollContent)
                .scrollContentBackground(.hidden)
                .refreshable { await loadSelectedTab(force: true) }
                .accessibilityIdentifier("notes.scroll")
            }
        }
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

    private var listContent: some View {
        Group {
            if loading && tree == nil {
                tabState(icon: "folder", title: copy.loading, retry: nil)
            } else if let loadError {
                tabState(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if folders.isEmpty && (tree?.rootNoteCount ?? 0) == 0 {
                tabState(icon: "folder", title: copy.emptyList, retry: nil)
            } else {
                JarvisList(head: { pageHead }) {
                    if (tree?.rootNoteCount ?? 0) > 0 {
                        Section {
                            if expandedFolders.contains("") {
                                directoryContent("")
                            }
                        } header: {
                            folderHeader("", inList: true)
                        }
                    }
                    ForEach(folders) { folder in folderRow(folder) }
                }
                .listStyle(.plain)
                .contentMargins(.bottom, JarvisNotesOverviewMetrics.bottomClearance, for: .scrollContent)
                .scrollContentBackground(.hidden)
                .refreshable { await loadSelectedTab(force: true) }
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
                        JarvisNotesGraphView(
                            graph: graph,
                            copy: copy,
                            onOpen: { node in await openNote(path: node.path) }
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
                JarvisList {
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
                                }
                            }
                        } header: {
                            Text(copy.notes)
                        }
                    }
                    if !visibleSearchTasks.isEmpty {
                        Section {
                            ForEach(visibleSearchTasks) { task in
                                taskRow(task, today: taskSearch?.today ?? taskList?.today ?? "")
                            }
                        } header: {
                            Text(copy.tasks)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
    }

    private var folderFilters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: JarvisDesignTokens.notesChipSpacing) {
                folderFilter("", title: copy.all)
                ForEach(topLevelFolders, id: \.self) { folder in
                    folderFilter(folder, title: folder)
                }
            }
            .padding(.horizontal, JarvisDesignTokens.notesCompactInset)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel(copy.folderField)
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

    private var folderGroups: [String] {
        var groups = topLevelFolders
        if (tree?.rootNoteCount ?? 0) > 0 { groups.insert("", at: 0) }
        return groups
    }

    private var visibleFolderGroups: [String] {
        selectedFolder.isEmpty ? folderGroups : folderGroups.filter { $0 == selectedFolder }
    }

    private var topLevelFolders: [String] {
        Array(Set((tree?.directories ?? []).compactMap { $0.split(separator: "/").first.map(String.init) }))
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    private var visibleSearchNotes: [KnowledgeSearchHit] {
        guard let hits = graphSearch?.hits else { return [] }
        guard selectedFolder.isEmpty else {
            return hits.filter { hit in
                graphSearch?.graph.nodes.first(where: { $0.id == hit.nodeId })?.folder == selectedFolder
            }
        }
        return hits
    }

    private var visibleSearchTasks: [VaultTask] {
        taskSearch?.items ?? []
    }

    private var searchKey: String {
        "\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))|\(selectedScope.rawValue)|\(refreshVersion)"
    }

    private func folderFilter(_ folder: String, title: String) -> some View {
        JarvisLabelledButton(title: title, isSelected: selectedFolder == folder) { selectedFolder = folder }
    }

    /// One folder of the Notes tab in the Software Factory list style: a rounded outlined header row, then its notes
    /// in a transparent rounded container indented 16 pt more, rows separated by hairlines.
    private func folderSection(_ folder: String) -> some View {
        let notes = groupNotes[folder] ?? []
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.notesChipSpacing) {
            folderHeader(folder, inList: false)
            if expandedFolders.contains(folder) {
                VStack(spacing: 0) {
                    ForEach(Array(notes.enumerated()), id: \.element.id) { index, note in
                        if index > 0 { JarvisNotesHairline() }
                        noteRow(note)
                            .padding(.horizontal, JarvisDesignTokens.notesSectionSpacing)
                    }
                    if groupLoading.contains(folder) {
                        JarvisLoadingView()
                            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight)
                    } else if groupHasMore[folder] == true {
                        JarvisLabelledButton(title: copy.loadMore) {
                            Task { await loadMoreNotes(in: folder) }
                        }
                        .padding(JarvisDesignTokens.notesChipSpacing)
                    } else if groupNotes[folder] != nil && notes.isEmpty {
                        Text(copy.emptyNotes)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight)
                    }
                }
                .jarvisHairlineOutline(radius: JarvisNotesOverviewMetrics.listRadius)
                .padding(.leading, JarvisNotesOverviewMetrics.listIndent)
                .accessibilityIdentifier("notes.folder.rows")
            }
        }
    }

    private func folderHeader(_ folder: String, inList: Bool) -> some View {
        let isExpanded = expandedFolders.contains(folder)
        let title = folder.isEmpty ? copy.vaultRoot : folder
        let count = graphFolderCounts[folder] ?? (inList
            ? directoryNotes[folder]?.count
            : groupHasMore[folder] == true ? nil : groupNotes[folder]?.count)
        return Button {
            toggleFolder(folder)
        } label: {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                Circle()
                    .fill(JarvisDesignTokens.primaryAccent)
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.headline)
                Spacer()
                if let count {
                    Text(String(count))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, JarvisDesignTokens.notesChipSpacing)
                        .padding(.vertical, JarvisDesignTokens.notesInlineSpacing / 2)
                        .background(Color.primary.opacity(0.08), in: Capsule())
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: JarvisDesignTokens.notesChevronSize, weight: .semibold))
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, JarvisDesignTokens.notesSectionSpacing + JarvisDesignTokens.notesInlineSpacing)
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight, alignment: .leading)
            .contentShape(Rectangle())
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
        .jarvisHairlineOutline(radius: JarvisNotesOverviewMetrics.listRadius)
        .accessibilityLabel(title)
        .accessibilityValue(isExpanded ? copy.expanded : copy.collapsed)
        .accessibilityIdentifier("notes.folder.header")
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
                Text(note.title)
                    .foregroundStyle(.primary)
                Spacer()
                Text(JarvisNotesLocalization.formattedUpdatedDate(note.updatedAt, language: copy.language))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(openingNotePaths.contains(note.path))
        .accessibilityLabel(note.title)
    }

    private func taskListView(_ list: VaultTaskList) -> some View {
        let groups = JarvisNotesLogic.taskGroups(list.items, today: list.today)
        return Group {
            if groups.overdue.isEmpty && groups.today.isEmpty && groups.upcoming.isEmpty && groups.noDate.isEmpty {
                tabState(icon: "checklist", title: copy.emptyTasks, retry: nil)
            } else {
                JarvisList(head: { pageHead }) {
                    if !groups.overdue.isEmpty {
                        Section {
                            ForEach(groups.overdue) { task in taskRow(task, today: list.today) }
                        } header: {
                            Text(copy.overdue)
                        }
                    }
                    if !groups.today.isEmpty {
                        Section {
                            ForEach(groups.today) { task in taskRow(task, today: list.today) }
                        } header: {
                            Text(copy.today)
                        }
                    }
                    if !groups.upcoming.isEmpty {
                        Section {
                            ForEach(groups.upcoming) { task in taskRow(task, today: list.today) }
                        } header: {
                            Text(copy.upcoming)
                        }
                    }
                    if !groups.noDate.isEmpty {
                        Section {
                            ForEach(groups.noDate) { task in taskRow(task, today: list.today) }
                        } header: {
                            Text(copy.noDate)
                        }
                    }
                }
                .listStyle(.plain)
                .contentMargins(.bottom, JarvisNotesOverviewMetrics.bottomClearance, for: .scrollContent)
                .scrollContentBackground(.hidden)
            }
        }
    }

    private func taskRow(_ task: VaultTask, today: String) -> some View {
        HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            JarvisIconButton(
                title: task.done ? copy.completed : copy.complete,
                systemImage: task.done ? "checkmark.circle.fill" : "circle",
                identifier: "notes.task.complete",
                isBusy: pendingTaskIDs.contains(task.id),
                isDisabled: task.done,
                isSelected: task.done
            ) { Task { await completeTask(task) } }
            .accessibilityValue(task.text)
            Button {
                openedTask = task
            } label: {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
                Text(task.text).foregroundStyle(.primary)
                HStack(spacing: JarvisDesignTokens.notesMetadataSpacing) {
                    Text(task.scope == .work ? copy.work : copy.personal)
                    if let due = task.dueDate {
                        Text(due == today ? copy.today : JarvisNotesLocalization.formattedDueDate(due, language: copy.language))
                    }
                    if let time = task.dueTime {
                        Text(JarvisNotesLocalization.formattedDueTime(time, language: copy.language))
                    }
                    Text(priorityText(task.priority))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("notes.task.open")
        }
        .frame(minHeight: JarvisDesignTokens.notesRowMinimumHeight)
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
                Text(task.text).font(.headline)
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

    @ViewBuilder
    private func folderRow(_ folder: VaultFolderNode) -> some View {
        DisclosureGroup(isExpanded: folderBinding(folder.path)) {
            directoryContent(folder.path)
            ForEach(folder.children) { child in AnyView(folderRow(child)) }
        } label: {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                Image(systemName: "folder")
                    .font(.system(size: JarvisDesignTokens.notesIconSize))
                    .foregroundStyle(.primary)
                Text(folder.name).foregroundStyle(.primary)
                Spacer()
                if directoryHasMore[folder.path] != true, let count = directoryNotes[folder.path]?.count {
                    Text(String(count)).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .frame(minHeight: JarvisDesignTokens.notesRowMinimumHeight)
            .contentShape(Rectangle())
        }
        .contextMenu {
            Button {
                newNoteFolder = folder.path
                newNotePresented = true
            } label: {
                Label(copy.newNote, systemImage: "note.text")
            }
        }
    }

    @ViewBuilder
    private func directoryContent(_ directory: String) -> some View {
        ForEach(directoryNotes[directory] ?? []) { note in
            noteRow(note)
        }
        if directoryLoading.contains(directory) {
            JarvisLoadingView().frame(maxWidth: .infinity)
        } else if directoryHasMore[directory] == true {
            JarvisLabelledButton(title: copy.loadMore) {
                Task { await loadMoreDirectory(directory) }
            }
        }
    }

    private func folderBinding(_ folder: String) -> Binding<Bool> {
        Binding(
            get: { expandedFolders.contains(folder) },
            set: { expanded in
                if expanded {
                    expandedFolders.insert(folder)
                    Task { await loadDirectory(folder, offset: 0) }
                } else {
                    expandedFolders.remove(folder)
                }
            }
        )
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
        loading = true
        loadError = nil
        loadRetryUnavailable = false
        signInUnavailable = false
        defer { loading = false }
        do {
            switch selectedTab {
            case .notes, .list:
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
                        if nextTree != tree { await applyTree(nextTree, force: force) }
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
        folders = JarvisNotesPresentation.folderTree(nextTree.directories)
        if !topLevelFolders.contains(selectedFolder) { selectedFolder = "" }
        groupNotes = [:]
        directoryNotes = [:]
        groupHasMore = [:]
        directoryHasMore = [:]
        if nextTree.rootNoteCount > 0 {
            expandedFolders.insert("")
            await loadDirectory("", offset: 0, force: force)
        }
    }

    private func loadNoteGroup(_ folder: String, offset: Int, force: Bool = false) async {
        guard let client, !groupLoading.contains(folder) else { return }
        groupLoading.insert(folder)
        defer { _ = groupLoading.remove(folder) }
        do {
            let page = try await (offset == 0
                ? firstPage(client, folder: folder, force: force)
                : client.notes(folder: folder, offset: offset))
            let previous = offset == 0 ? [] : groupNotes[folder] ?? []
            groupNotes[folder] = previous + page.notes
            groupHasMore[folder] = page.hasMore
        } catch {
            guard !Task.isCancelled else { return }
            loadError = message(for: error)
            loadRetryUnavailable = authorizationUnavailable(error)
            signInUnavailable = loadRetryUnavailable
        }
    }

    private func loadMoreNotes(in folder: String) async {
        await loadNoteGroup(folder, offset: groupNotes[folder]?.count ?? 0)
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
            guard !Task.isCancelled else { return }
            signInUnavailable = authorizationUnavailable(error)
            loadError = message(for: error)
            loadRetryUnavailable = signInUnavailable
        }
    }

    private func loadMoreDirectory(_ directory: String) async {
        await loadDirectory(directory, offset: directoryNotes[directory]?.count ?? 0)
    }

    private func toggleFolder(_ folder: String) {
        if expandedFolders.contains(folder) {
            expandedFolders.remove(folder)
        } else {
            expandedFolders.insert(folder)
            Task {
                if selectedTab == .notes {
                    await loadNoteGroup(folder, offset: 0)
                } else {
                    await loadDirectory(folder, offset: 0)
                }
            }
        }
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
            if selectedScope != .tasks {
                let result = try await client.searchGraph(query)
                guard !Task.isCancelled else { return }
                graphSearch = result
                graph = result.graph
            }
            if selectedScope != .notes {
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
