import Foundation
import JarvisCore
import SwiftUI

enum JarvisNotesTab: String, CaseIterable, Identifiable, Sendable {
    case notes
    case tasks
    case graph

    var id: String { rawValue }
}

private struct JarvisNoteSwipeRow<Content: View>: View {
    private enum RowAlert {
        case confirm(VaultNote)
        case failure(String)
    }

    let title: String
    let path: String
    let client: JarvisNotesClient?
    let actionTitle: String
    let actionImage: String
    let identifier: String
    let isDisabled: Bool
    let onOpen: () -> Void
    let onAction: () -> Void
    let onDeleted: (String) -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var offset: CGFloat = 0
    @State private var busy = false
    @State private var alert: RowAlert?
    private let actionWidth = CGFloat(JarvisNotesLogic.pinSwipeDistance)
    private let deleteWidth = CGFloat(JarvisNotesLogic.deleteSwipeDistance)

    var body: some View {
        ZStack(alignment: .trailing) {
            Image(systemName: -offset >= deleteWidth ? "trash" : actionImage)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(JarvisDesignTokens.primaryAccentForeground)
                .frame(width: actionWidth)
                .frame(maxHeight: .infinity)
                .background(-offset >= deleteWidth ? Color.red : JarvisDesignTokens.primaryAccent)
                .frame(width: max(0, -offset), alignment: .trailing)
                .clipped()
                .accessibilityHidden(true)

            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    if isDisabled {
                        return
                    } else if offset == 0 {
                        onOpen()
                    } else {
                        withAnimation(reduceMotion ? nil : .snappy) { offset = 0 }
                    }
                }
                .offset(x: offset)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(title)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { if !isDisabled && !busy { onOpen() } }
                .accessibilityAction(named: Text(actionTitle)) { if !isDisabled && !busy { onAction() } }
                .accessibilityAction(named: Text("Delete note")) { if !isDisabled && !busy { prepareDelete() } }
                .accessibilityIdentifier(identifier)
                .disabled(isDisabled || busy)
                .overlay(alignment: .trailing) {
                    if busy { ProgressView().padding() }
                }
        }
        .frame(maxWidth: .infinity)
        .clipShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onChanged { value in
                    guard !isDisabled, !busy,
                          abs(value.translation.width) > abs(value.translation.height) else { return }
                    offset = min(0, max(-deleteWidth, value.translation.width))
                }
                .onEnded { value in
                    let horizontal = abs(value.translation.width) > abs(value.translation.height)
                    let distance = -value.translation.width
                    withAnimation(reduceMotion ? nil : .snappy) { offset = 0 }
                    guard !isDisabled, !busy, horizontal else { return }
                    switch JarvisNotesLogic.swipeAction(distance: Double(distance)) {
                    case .delete: prepareDelete()
                    case .pin: onAction()
                    case .none: break
                    }
                }
        )
        .alert(alertTitle, isPresented: Binding(
            get: { alert != nil },
            set: { if !$0 { alert = nil } }
        )) {
            if case let .confirm(note) = alert {
                Button("No", role: .cancel) { alert = nil }
                Button("Yes", role: .destructive) {
                    alert = nil
                    Task { await delete(note) }
                }
            } else {
                Button("OK", role: .cancel) { alert = nil }
            }
        } message: {
            switch alert {
            case .confirm: Text("Delete this note? It can be recovered from vault Git history.")
            case let .failure(message): Text(message)
            case nil: EmptyView()
            }
        }
    }

    private var alertTitle: String {
        if case .confirm = alert { return "Delete note?" }
        return "Note deletion"
    }

    private func prepareDelete() {
        guard let client, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let note = try await client.readNote(path: path)
                alert = .confirm(note)
            } catch {
                alert = .failure("The note could not be loaded. Refresh and try again.")
            }
        }
    }

    private func delete(_ note: VaultNote) async {
        guard let client, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await client.deleteNote(path: note.path, sha: note.sha)
            onDeleted(note.path)
        } catch JarvisNotesClientError.noteConflict {
            alert = .failure("The note changed. Refresh it before trying again.")
        } catch {
            alert = .failure("Deletion could not be confirmed. Refresh the note before trying again.")
        }
    }
}

private enum JarvisNotesSearchScope: String, CaseIterable, Identifiable, Sendable {
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
    @Binding var selectedTab: JarvisNotesTab
    @State private var selectedScope: JarvisNotesSearchScope = .all
    @State private var selectedFolder = ""
    @State private var searchText = ""
    @State private var refreshVersion = 0
    @State private var tree: VaultNoteTree?
    @State private var pinnedPaths: [String] = []
    @State private var browserPresented = false
    @State private var pendingBrowserNote: String?
    @State private var recentVisits: [JarvisNoteVisit] = []
    @State private var libraryGroups: [JarvisNoteLibraryGroup] = []

    private struct LibraryInput: Equatable, Sendable {
        let nodes: [KnowledgeGraphNode]
        let visits: [JarvisNoteVisit]
        let day: Date
    }

    private var libraryInput: LibraryInput {
        LibraryInput(nodes: graph?.nodes ?? [], visits: recentVisits,
                     day: Calendar.current.startOfDay(for: Date()))
    }
    @State private var directoryNotes: [String: [VaultNoteSummary]] = [:]
    @State private var directoryHasMore: [String: Bool] = [:]
    @State private var directoryLoading = Set<String>()
    @State private var taskList: VaultTaskList?
    @State private var graph: KnowledgeGraph?
    @State private var graphSearch: KnowledgeGraphSearch?
    @State private var taskSearch: VaultTaskList?
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
    @State private var loadRequest = UUID()
    @State private var searchRequest = UUID()
    @State private var searchContext = ""
    @State private var directoryRequests: [String: UUID] = [:]
    @State private var openingNoteRequest = UUID()
    @State private var failedReads = Set<ReadSection>()
    @State private var graphResetVersion = 0

    private var copy: JarvisNotesCopy { JarvisNotesCopy(language: language) }

    var body: some View {
        VStack(spacing: 0) {
            if selectedTab == .graph || searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                selectedContent
            } else {
                searchContent
            }
        }
        .jarvisPageHeader { header }
        .jarvisSuccessFeedback($successConfirmation)
        .environment(\.locale, language.locale)
        .jarvisPageFooter {
            VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                searchBar
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.top, JarvisDesignTokens.notesSectionSpacing)
            .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
        }
        .jarvisAmbientBackground()
        .toolbarBackground(.hidden, for: .bottomBar)
        .scrollEdgeEffectHidden(true, for: .bottom)
        .task(id: "\(selectedTab.rawValue)-\(refreshVersion)") {
            await loadSelectedTab(force: refreshVersion > 0)
        }
        .task(id: libraryInput) {
            await updateLibrary()
        }
        .task(id: searchKey) {
            await search()
        }
        .onDisappear {
            loadRequest = UUID()
            searchRequest = UUID()
            openingNoteRequest = UUID()
            directoryRequests = [:]
            directoryLoading = []
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
        .sheet(isPresented: $browserPresented, onDismiss: {
            if let path = pendingBrowserNote {
                pendingBrowserNote = nil
                Task { await openNote(path: path) }
            }
        }) {
            folderBrowser
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
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
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
                    isPinned: pinnedPaths.contains(current.path),
                    onPin: { pinned in Task { await setPinned(current.path, pinned: pinned) } },
                    onDeleted: { path in
                        editorPresented = false
                        Task { await noteDeleted(path) }
                    },
                    onClose: { editorPresented = false }
                )
                .id(current.path)
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
            Button { browserPresented = true } label: {
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
        .accessibilityHint(client == nil ? copy.unavailable : (signInUnavailable ? loadError ?? copy.signIn : copy.createHint))
    }

    /// The page head, as the first scrolling row: data phrase, Overview hero, then the Notes / Tasks / Graph
    /// segmented bar. Pinned and Recent follow on Notes; only their values wait for data.
    @ViewBuilder
    private var pageHead: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            if selectedTab == .graph, let graph {
                JarvisPageHeadline(phrase: JarvisNotesPagePhrase.graph(graph, language: language))
            } else if let taskList {
                JarvisPageHeadline(phrase: JarvisNotesPagePhrase.tasks(taskList, language: language))
            }
            if selectedTab != .graph {
                overviewHero
            }
            tabSwitcher
            if let loadError {
                stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
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
                JarvisPageStat(id: "notes", value: graph?.nodes.count, label: copy.notes, systemImage: "note.text", tint: JarvisDesignTokens.primaryAccent, isLoading: !failedReads.contains(.graph) && client != nil),
                JarvisPageStat(id: "open", value: counts?.open, label: copy.openTasks, systemImage: "checklist", tint: JarvisDesignTokens.primaryAccent, isLoading: !failedReads.contains(.tasks) && client != nil),
                JarvisPageStat(id: "overdue", value: counts?.overdue, label: copy.overdue, systemImage: "flag", tint: JarvisDesignTokens.primaryAccent, isLoading: !failedReads.contains(.tasks) && client != nil),
                JarvisPageStat(id: "today", value: counts?.dueToday, label: copy.today, systemImage: "clock", tint: JarvisDesignTokens.primaryAccent, isLoading: !failedReads.contains(.tasks) && client != nil),
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
                    graphResetVersion += 1
                    refreshVersion += 1
                }
            }
        }
    }

    /// A loading, error or empty state still shows the segmented bar so the tabs stay reachable.
    private func tabState(icon: String, title: String, retry: (() -> Void)?) -> some View {
        VStack(spacing: 0) {
            pageHead
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
            LazyVStack(alignment: .leading, spacing: 0) {
                pageHead.padding(.bottom, 24)
                pinnedSection.padding(.bottom, 24)
                JarvisSectionHeadline(copy.recent) {
                    JarvisTextButton(title: copy.browseFolders, identifier: "notes.browseFolders") {
                        browserPresented = true
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                .padding(.bottom, 16)
                if libraryGroups.isEmpty {
                    Text(graph == nil ? (failedReads.contains(.graph) ? copy.unavailable : copy.loading) : (graph?.nodes.isEmpty == true ? copy.emptyNotes : copy.loading))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                }
                // Keep every row a direct lazy child. Wrapping the complete inventory
                // in an eager VStack/material group stalls navigation and AX snapshots.
                ForEach(libraryGroups) { group in
                    Section {
                        ForEach(group.notes) { node in
                            noteRow(VaultNoteSummary(path: node.path, title: node.title,
                                folder: node.folder, directory: node.directory, updatedAt: node.updatedAt))
                                .jarvisLazyRowSurface(
                                    first: node.id == group.notes.first?.id,
                                    last: node.id == group.notes.last?.id
                                )
                                .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                        }
                    } header: {
                        Text(title(for: group.period))
                            .font(.subheadline).foregroundStyle(.secondary)
                            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                            .padding(.top, group.id == libraryGroups.first?.id ? 0 : 16)
                            .padding(.bottom, 16)
                    }
                }
            }
            .padding(.bottom, 20)
        }
        .refreshable { await loadSelectedTab(force: true) }
        .accessibilityIdentifier("notes.scroll")
    }

    @MainActor
    private func updateLibrary() async {
        let input = libraryInput
        let now = Date()
        let calendar = Calendar.current
        let work = Task.detached(priority: .userInitiated) {
            JarvisNotesPresentation.libraryGroups(
                nodes: input.nodes, visits: input.visits, now: now, calendar: calendar
            )
        }
        let groups = await withTaskCancellationHandler {
            await work.value
        } onCancel: {
            work.cancel()
        }
        guard !Task.isCancelled else { return }
        libraryGroups = groups
    }

    private func title(for period: JarvisNoteLibraryGroup.Period) -> String {
        switch period {
        case .today: copy.today
        case .yesterday: copy.yesterday
        case .earlier: copy.earlier
        }
    }

    private var pinnedSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(copy.pinned, systemImage: "pin.fill")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            let pinned = pinnedPaths.compactMap { path in graph?.nodes.first { $0.path == path } }
            if graph == nil {
                if failedReads.contains(.graph) {
                    Text(copy.unavailable).foregroundStyle(.secondary)
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                } else {
                    JarvisLoadingView(title: copy.loading, size: .inline)
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                }
            } else if pinned.isEmpty {
                Text(copy.emptyPinned).font(.subheadline).foregroundStyle(.secondary)
                    .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            } else {
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        ForEach(pinned) { node in
                            JarvisRowButton(identifier: "notes.pinned.\(node.path)", action: {
                                Task { await openNote(path: node.path) }
                            }) {
                                Text(node.title)
                                    .font(.headline).foregroundStyle(.primary)
                                    .lineLimit(3).frame(width: 168, alignment: .leading)
                                    .frame(minHeight: 68, alignment: .leading)
                                    .padding(14)
                            }
                            .jarvisGlassSurface(cornerRadius: 18)
                            .disabled(openingNotePaths.contains(node.path))
                        }
                    }.scrollTargetLayout()
                }
                .contentMargins(.horizontal, JarvisDesignTokens.notesHorizontalInset, for: .scrollContent)
                .scrollTargetBehavior(.viewAligned)
                .scrollIndicators(.hidden)
                .accessibilityIdentifier("notes.pinned.carousel")
            }
        }
    }

    private func setPinned(_ path: String, pinned: Bool) async {
        await JarvisAppCache.shared.setNotePinned(path: path, pinned: pinned)
        pinnedPaths = await JarvisAppCache.shared.pinnedNotePaths()
    }

    private func noteDeleted(_ path: String) async {
        await JarvisAppCache.invalidateAll(.notes)
        await setPinned(path, pinned: false)
        for directory in Array(directoryNotes.keys) {
            directoryNotes[directory]?.removeAll { $0.path == path }
        }
        refreshVersion += 1
    }

    private var folderBrowser: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                    if let parent = JarvisNotesPresentation.parentFolder(of: selectedFolder) {
                        JarvisTextButton(title: copy.back, identifier: "notes.folder.back") { navigateToFolder(parent) }
                        Text(selectedFolder.replacingOccurrences(of: "/", with: " / "))
                            .font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("notes.folder.breadcrumb")
                    }
                    if let loadError {
                        stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
                    }
                    Group {
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
                        JarvisSectionHeadline(selectedFolder.isEmpty ? copy.vaultRoot : String(selectedFolder.split(separator: "/").last ?? "")) {
                            if directoryNotes[selectedFolder] != nil {
                                Text("\(currentDirectoryNotes.count)\(directoryHasMore[selectedFolder] == true ? "+" : "")")
                                    .font(.caption).foregroundStyle(.secondary)
                                    .accessibilityIdentifier("notes.folder.count")
                            }
                        }
                        if directoryNotes[selectedFolder] != nil {
                            if currentDirectoryNotes.isEmpty {
                                Text(copy.emptyNotes).font(.subheadline).foregroundStyle(.secondary)
                            } else {
                                JarvisRowGroup {
                                    ForEach(currentDirectoryNotes) { note in
                                        noteRow(note, inBrowser: true)
                                    }
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
                .padding(JarvisDesignTokens.notesHorizontalInset)
            }
            .safeAreaInset(edge: .bottom) {
                HStack {
                    Spacer()
                    JarvisLabelledButton(title: copy.newFolderTitle, systemImage: "folder.badge.plus",
                                         identifier: "notes.browser.newFolder", isDisabled: client == nil) {
                        newFolderPresented = true
                    }
                }.padding(JarvisDesignTokens.notesHorizontalInset)
            }
            .jarvisAmbientBackground()
            .navigationTitle(copy.browseFolders)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    JarvisTextButton(title: copy.done, identifier: "notes.browser.done") { browserPresented = false }
                }.sharedBackgroundVisibility(.hidden)
            }
        }
    }

    private func navigateToFolder(_ folder: String) {
        selectedFolder = folder
        loadError = nil
        Task { await loadDirectory(folder, offset: 0) }
    }

    private var tasksContent: some View {
        taskListView(taskList)
            .refreshable { await loadSelectedTab(force: true) }
    }

    private var graphContent: some View {
        Group {
            if let graph {
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
                        .id(graphResetVersion)
                        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                    }
                    .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
                }
            } else {
                tabState(icon: "point.3.connected.trianglepath.dotted", title: failedReads.contains(.graph) ? copy.unavailable : copy.loading, retry: nil)
            }
        }
    }

    private var searchContent: some View {
        Group {
                JarvisList(customRowBackgrounds: true) {
                    pageHead
                    if searchLoading {
                        JarvisLoadingView(title: copy.loading, size: .inline)
                    }
                    if let searchError {
                        stateView(icon: "wifi.exclamationmark", title: searchError, retry: searchRetryUnavailable ? nil : refreshCurrent)
                    }
                    if !searchLoading, searchError == nil, visibleSearchNotes.isEmpty && visibleSearchTasks.isEmpty {
                        Text(copy.noResults).foregroundStyle(.secondary)
                    }
                    if selectedScope != .tasks {
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
        guard searchContext == currentSearchContext else { return [] }
        guard let hits = graphSearch?.hits else { return [] }
        guard selectedFolder.isEmpty else {
            return hits.filter { hit in
                graphSearch?.graph.nodes.first(where: { $0.id == hit.nodeId })?.directory == selectedFolder
            }
        }
        return hits
    }

    private var visibleSearchTasks: [VaultTask] {
        searchContext == currentSearchContext ? taskSearch?.items ?? [] : []
    }

    private var currentSearchContext: String {
        "\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))|\(selectedScope.rawValue)|\(selectedTab.rawValue)"
    }

    private var searchKey: String {
        "\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))|\(selectedScope.rawValue)|\(selectedTab.rawValue)|\(refreshVersion)"
    }

    private func noteRow(_ note: VaultNoteSummary, inBrowser: Bool = false) -> some View {
        let isPinned = pinnedPaths.contains(note.path)
        return JarvisNoteSwipeRow(
            title: note.title,
            path: note.path,
            client: client,
            actionTitle: isPinned ? copy.unpin : copy.pin,
            actionImage: isPinned ? "pin.slash" : "pin",
            identifier: "notes.note.\(note.path)",
            isDisabled: openingNotePaths.contains(note.path),
            onOpen: {
                if inBrowser {
                    pendingBrowserNote = note.path
                    browserPresented = false
                } else {
                    Task { await openNote(path: note.path) }
                }
            },
            onAction: { Task { await setPinned(note.path, pinned: !isPinned) } },
            onDeleted: { path in Task { await noteDeleted(path) } }
        ) {
            HStack(alignment: .center, spacing: JarvisDesignTokens.notesSectionSpacing) {
                if openingNotePaths.contains(note.path) {
                    JarvisLoadingView()
                        .frame(width: JarvisDesignTokens.notesIconSize, height: JarvisDesignTokens.notesIconSize)
                } else {
                    Image(systemName: "note.text")
                        .font(.system(size: JarvisDesignTokens.notesIconSize))
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                }
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    Text(note.title).font(.headline).lineLimit(2).foregroundStyle(.primary)
                    Text(note.directory.isEmpty ? copy.vaultRoot : note.directory.replacingOccurrences(of: "/", with: " / "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Text(JarvisNotesLocalization.formattedUpdatedDate(note.updatedAt, language: copy.language))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if isPinned {
                    Image(systemName: "pin.fill")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .jarvisListRow()
            .contentShape(Rectangle())
        }
        .accessibilityValue(isPinned ? copy.pinned : "")
    }

    private func taskListView(_ list: VaultTaskList?) -> some View {
        JarvisList(customRowBackgrounds: true) {
            pageHead
        } content: {
            if let list {
                let groups = JarvisNotesLogic.taskGroups(list.items, today: list.today)
                if list.items.isEmpty {
                    stateView(icon: "checklist", title: copy.emptyTasks, retry: nil)
                } else {
                    taskSection(groups.overdue, title: copy.overdue, today: list.today)
                    taskSection(groups.today, title: copy.today, today: list.today)
                    taskSection(groups.upcoming, title: copy.upcoming, today: list.today)
                    taskSection(groups.noDate, title: copy.noDate, today: list.today)
                }
            } else {
                ForEach([copy.overdue, copy.today, copy.upcoming, copy.noDate], id: \.self) { title in
                    Section {
                        JarvisSectionHeadline(title)
                        if loadError == nil {
                            JarvisLoadingView(title: copy.loading, size: .inline)
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .listRowSpacing(0)
        .listSectionSpacing(JarvisPageHeaderMetrics.spacing)
        .contentMargins(.top, 0, for: .scrollContent)
        .contentMargins(.bottom, JarvisDesignTokens.notesHorizontalInset, for: .scrollContent)
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("notes.tasks.list")
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
            isFirst: isFirst,
            isLast: isLast,
            onOpen: { openedTask = task }
        )
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 0, leading: JarvisDesignTokens.notesHorizontalInset,
                                 bottom: 0, trailing: JarvisDesignTokens.notesHorizontalInset))
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
        JarvisTaskDetailSheet(
            task: task,
            today: today,
            copy: copy,
            client: client,
            onComplete: {
                openedTask = nil
                Task { await completeTask(task) }
            },
            onSaved: {
                openedTask = nil
                successConfirmation = JarvisSuccessConfirmation(message: copy.saved)
                refreshVersion += 1
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
                JarvisLabelledButton(title: copy.retry, identifier: "notes.retry", action: retry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    private func loadSelectedTab(force: Bool = false) async {
        let request = UUID()
        loadRequest = request
        let tab = selectedTab
        guard let client else {
            loadError = copy.unavailable
            failedReads = Set(ReadSection.allCases)
            return
        }
        await JarvisAppCache.bindIfNeeded()
        guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
        recentVisits = await JarvisAppCache.shared.recentNoteVisits()
        pinnedPaths = await JarvisAppCache.shared.pinnedNotePaths()
        guard !Task.isCancelled, loadRequest == request, selectedTab == tab else { return }
        loadError = nil
        loadRetryUnavailable = false
        signInUnavailable = false
        await withTaskGroup(of: Void.self) { group in
            for section in ReadSection.allCases where tab == .notes || section == .graph || (tab == .tasks && section == .tasks) {
                group.addTask {
                    await loadSection(section, client: client, force: force, request: request, tab: tab)
                }
            }
        }
    }

    private enum ReadSection: CaseIterable, Hashable, Sendable {
        case graph, tasks, tree, directory
    }

    @MainActor
    private func loadSection(
        _ section: ReadSection,
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
        confirmedFolders.subtract(nextTree.directories)
        if !selectedFolder.isEmpty,
           !(nextTree.directories + Array(confirmedFolders)).contains(where: { $0 == selectedFolder || $0.hasPrefix(selectedFolder + "/") }) {
            selectedFolder = ""
        }
    }

    private func loadDirectory(_ directory: String, offset: Int, force: Bool = false) async {
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

    private func loadMoreDirectory(_ directory: String) async {
        await loadDirectory(directory, offset: directoryNotes[directory]?.count ?? 0)
    }

    private func search() async {
        let context = currentSearchContext
        let request = UUID()
        searchRequest = request
        if searchContext != context {
            graphSearch = nil
            taskSearch = nil
            searchContext = context
        }
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
            searchLoading = false
            return
        }
        searchLoading = true
        searchError = nil
        searchRetryUnavailable = false
        signInUnavailable = false
        let scope = selectedScope
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

    private func openNote(path: String) async {
        guard let client else { return }
        guard !openingNotePaths.contains(path) else { return }
        let request = UUID()
        openingNoteRequest = request
        openingNotePaths.insert(path)
        defer { _ = openingNotePaths.remove(path) }
        do {
            let note = try await client.readNote(path: path)
            guard !Task.isCancelled, openingNoteRequest == request else { return }
            editor = note
            editorPresented = true
            await JarvisAppCache.shared.recordNoteOpen(path: path)
            guard !Task.isCancelled, openingNoteRequest == request else { return }
            recentVisits = await JarvisAppCache.shared.recentNoteVisits()
        } catch {
            guard !Task.isCancelled, openingNoteRequest == request else { return }
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
