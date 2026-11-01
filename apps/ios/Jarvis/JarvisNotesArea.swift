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
    @State private var newNoteFolder = ""
    @State private var pendingTaskIDs = Set<String>()
    @State private var noticePresented = false

    private var copy: JarvisNotesCopy { JarvisNotesCopy(language: language) }

    var body: some View {
        VStack(spacing: 0) {
            header
            tabSwitcher
            if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                selectedContent
            } else {
                searchContent
            }
        }
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
            .background(.bar)
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
        HStack {
            JarvisSidebarMenuButton(language: language)
            Text(copy.title)
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(.primary)
            Spacer()
            Button {
                if selectedTab == .graph {
                    graphSearch = nil
                }
                refreshVersion += 1
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: JarvisDesignTokens.notesIconSize, weight: .medium))
                    .frame(width: JarvisDesignTokens.notesControlHeight, height: JarvisDesignTokens.notesControlHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.glass)
            .accessibilityLabel(selectedTab == .graph ? copy.resetGraph : copy.refresh)
        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.top, JarvisDesignTokens.notesSectionSpacing)
    }

    private var tabSwitcher: some View {
        HStack(spacing: 0) {
            ForEach(JarvisNotesTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    Text(copy.title(for: tab))
                        .font(.subheadline.weight(selectedTab == tab ? .semibold : .regular))
                        .foregroundStyle(selectedTab == tab ? Color.accentColor : Color.primary)
                        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesControlHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                .accessibilityLabel(copy.title(for: tab))
                .accessibilityIdentifier("notes.tab.\(tab.rawValue)")
            }
        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy.title)
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
                stateView(icon: "note.text", title: copy.loading, retry: nil)
            } else if let loadError {
                stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if let tree, folderGroups.isEmpty {
                stateView(icon: "note.text", title: copy.emptyNotes, retry: nil)
            } else {
                JarvisList {
                    ForEach(visibleFolderGroups, id: \.self) { folder in
                        Section {
                            if expandedFolders.contains(folder) {
                                ForEach(groupNotes[folder] ?? []) { note in
                                    noteRow(note)
                                }
                                if groupLoading.contains(folder) {
                                    ProgressView().frame(maxWidth: .infinity)
                                } else if groupHasMore[folder] == true {
                                    Button(copy.loadMore) {
                                        Task { await loadMoreNotes(in: folder) }
                                    }
                                    .foregroundStyle(Color.accentColor)
                                } else if groupNotes[folder] != nil && (groupNotes[folder]?.isEmpty ?? true) {
                                    Text(copy.emptyNotes)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        } header: {
                            folderHeader(folder, inList: false)
                        }
                        .textCase(nil)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable { await loadSelectedTab(force: true) }
            }
        }
    }

    private var tasksContent: some View {
        Group {
            if loading && taskList == nil {
                stateView(icon: "checklist", title: copy.loading, retry: nil)
            } else if let loadError {
                stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if let taskList {
                taskListView(taskList)
                    .refreshable { await loadSelectedTab(force: true) }
            } else {
                stateView(icon: "checklist", title: copy.emptyTasks, retry: nil)
            }
        }
    }

    private var listContent: some View {
        Group {
            if loading && tree == nil {
                stateView(icon: "folder", title: copy.loading, retry: nil)
            } else if let loadError {
                stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if folders.isEmpty && (tree?.rootNoteCount ?? 0) == 0 {
                stateView(icon: "folder", title: copy.emptyList, retry: nil)
            } else {
                JarvisList {
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
                .scrollContentBackground(.hidden)
                .refreshable { await loadSelectedTab(force: true) }
            }
        }
    }

    private var graphContent: some View {
        Group {
            if loading && graph == nil {
                stateView(icon: "point.3.connected.trianglepath.dotted", title: copy.loading, retry: nil)
            } else if let loadError {
                stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
            } else if let graph {
                if graph.nodes.isEmpty {
                    stateView(icon: "point.3.connected.trianglepath.dotted", title: copy.emptyGraph, retry: nil)
                } else {
                    JarvisNotesGraphView(
                        graph: graph,
                        copy: copy,
                        onOpen: { node in await openNote(path: node.path) }
                    )
                    .id(refreshVersion)
                    .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
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
            HStack(spacing: JarvisDesignTokens.notesMetadataSpacing) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Menu {
                    ForEach(JarvisNotesSearchScope.allCases) { scope in
                        Button(copy.title(for: scope)) { selectedScope = scope }
                    }
                } label: {
                    HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                        Text(copy.title(for: selectedScope))
                        Image(systemName: "chevron.down").font(.caption2)
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
                }
                .accessibilityLabel(copy.title(for: selectedScope))
                TextField(copy.search, text: $searchText)
                    .textFieldStyle(.plain)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .accessibilityLabel(copy.search)
                    .accessibilityIdentifier("notes.search")
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(copy.clearSearch)
                }
            }
            .padding(.horizontal, JarvisDesignTokens.notesSectionSpacing)
            .frame(height: JarvisDesignTokens.notesControlHeight)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: Capsule())
            .accessibilityElement(children: .contain)
            Menu {
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
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: JarvisDesignTokens.notesIconSize, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: JarvisDesignTokens.notesControlHeight, height: JarvisDesignTokens.notesControlHeight)
                    .background(.regularMaterial, in: Circle())
                    .contentShape(Circle())
            }
            .accessibilityLabel(copy.create)
            .accessibilityIdentifier("notes.plus")
            .accessibilityHint(
                client == nil ? copy.unavailable : signInUnavailable ? copy.signIn : copy.createHint
            )
            .disabled(client == nil || signInUnavailable)
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
        Button {
            selectedFolder = folder
        } label: {
            Text(title)
                .font(.subheadline.weight(selectedFolder == folder ? .semibold : .regular))
                .foregroundStyle(selectedFolder == folder ? Color.accentColor : Color.primary)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selectedFolder == folder ? .isSelected : [])
    }

    private func folderHeader(_ folder: String, inList: Bool) -> some View {
        let isExpanded = expandedFolders.contains(folder)
        let title = folder.isEmpty ? copy.vaultRoot : folder
        let count = inList
            ? directoryNotes[folder]?.count
            : groupHasMore[folder] == true ? nil : groupNotes[folder]?.count
        return Button {
            toggleFolder(folder)
        } label: {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                Image(systemName: "chevron.right")
                    .font(.system(size: JarvisDesignTokens.notesChevronSize, weight: .semibold))
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .foregroundStyle(.secondary)
                Image(systemName: inList ? "folder" : "folder.fill")
                    .font(.system(size: JarvisDesignTokens.notesIconSize))
                Text(title)
                    .font(.headline)
                Spacer()
                if let count {
                    Text(String(count))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight, alignment: .leading)
            .contentShape(Rectangle())
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(isExpanded ? copy.expanded : copy.collapsed)
    }

    private func noteRow(_ note: VaultNoteSummary) -> some View {
        Button {
            Task { await openNote(path: note.path) }
        } label: {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                if openingNotePaths.contains(note.path) {
                    ProgressView()
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
                stateView(icon: "checklist", title: copy.emptyTasks, retry: nil)
            } else {
                JarvisList {
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
                .scrollContentBackground(.hidden)
            }
        }
    }

    private func taskRow(_ task: VaultTask, today: String) -> some View {
        HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            Button {
                if !task.done { Task { await completeTask(task) } }
            } label: {
                Group {
                    if pendingTaskIDs.contains(task.id) {
                        ProgressView()
                    } else {
                        Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: JarvisDesignTokens.notesTaskActionSize))
                            .foregroundStyle(task.done ? Color.accentColor : Color.secondary)
                    }
                }
                .frame(width: JarvisDesignTokens.notesControlHeight, height: JarvisDesignTokens.notesControlHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(task.done || pendingTaskIDs.contains(task.id))
            .accessibilityLabel(task.done ? copy.completed : copy.complete)
            .accessibilityValue(task.text)
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
            ProgressView().frame(maxWidth: .infinity)
        } else if directoryHasMore[directory] == true {
            Button(copy.loadMore) {
                Task { await loadMoreDirectory(directory) }
            }
            .foregroundStyle(Color.accentColor)
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
                Button(copy.retry, action: retry)
                    .buttonStyle(.glass)
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
                if force || tree == nil {
                    let nextTree = try await client.folderTree()
                    guard !Task.isCancelled else { return }
                    tree = nextTree
                    folders = JarvisNotesPresentation.folderTree(nextTree.directories)
                    if !topLevelFolders.contains(selectedFolder) { selectedFolder = "" }
                    groupNotes = [:]
                    directoryNotes = [:]
                    groupHasMore = [:]
                    directoryHasMore = [:]
                    if nextTree.rootNoteCount > 0 {
                        expandedFolders.insert("")
                        await loadDirectory("", offset: 0)
                    }
                }
            case .tasks:
                if force || taskList == nil {
                    let result = try await client.tasks()
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
            if tree != nil && selectedTab == .notes && groupNotes.isEmpty {
                if let first = topLevelFolders.first {
                    expandedFolders.insert(first)
                    await loadNoteGroup(first, offset: 0)
                }
            }
        } catch {
            guard !Task.isCancelled else { return }
            loadError = message(for: error)
            loadRetryUnavailable = authorizationUnavailable(error)
            signInUnavailable = loadRetryUnavailable
        }
    }

    private func loadNoteGroup(_ folder: String, offset: Int) async {
        guard let client, !groupLoading.contains(folder) else { return }
        groupLoading.insert(folder)
        defer { _ = groupLoading.remove(folder) }
        do {
            let page = try await client.notes(folder: folder, offset: offset)
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

    private func loadDirectory(_ directory: String, offset: Int) async {
        guard let client, !directoryLoading.contains(directory) else { return }
        directoryLoading.insert(directory)
        defer { _ = directoryLoading.remove(directory) }
        do {
            let page = try await client.notes(directory: directory, offset: offset)
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
