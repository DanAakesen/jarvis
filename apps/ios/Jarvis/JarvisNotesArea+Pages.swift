import Foundation
import JarvisCore
import SwiftUI

/// The three browsing pages and the search results. Rows are direct lazy children so a large vault stays fast.
extension JarvisNotesArea {
    @ViewBuilder
    var selectedContent: some View {
        switch selectedTab {
        case .notes: notesPage
        case .tasks: tasksPage
        case .graph: graphPage
        }
    }

    // MARK: Notes

    private func summary(for path: String) -> VaultNoteSummary {
        if let node = graph?.nodes.first(where: { $0.path == path }) {
            return VaultNoteSummary(
                path: node.path, title: node.title, folder: node.folder, directory: node.directory, updatedAt: node.updatedAt
            )
        }
        let directory = path.split(separator: "/").dropLast().joined(separator: "/")
        return VaultNoteSummary(
            path: path, title: JarvisNoteTitle.fileTitle(path: path),
            folder: directory.split(separator: "/").first.map(String.init) ?? "", directory: directory, updatedAt: ""
        )
    }

    /// Pins inside the folder being browsed; at the vault root every pin shows.
    var scopedPinnedNotes: [VaultNoteSummary] {
        pinnedPaths
            .filter { selectedFolder.isEmpty || $0.hasPrefix(selectedFolder + "/") }
            .map(summary(for:))
    }

    var pinnedItems: [JarvisPinnedItem] {
        pinnedPaths.map {
            let note = summary(for: $0)
            return JarvisPinnedItem(path: note.path, title: note.title, location: JarvisNoteTitle.location(path: note.path))
        }
    }

    private var childFolders: [VaultFolderNode] {
        JarvisNotesPresentation.childFolders(in: selectedFolder, paths: tree?.directories ?? [])
    }

    private var listedNotes: [VaultNoteSummary] {
        let pinned = Set(pinnedPaths)
        let notes = (directoryNotes[selectedFolder] ?? []).filter { !pinned.contains($0.path) }
        return JarvisNotesPresentation.sorted(notes, by: noteSort)
    }

    private func sectionHeader(_ title: String, count: Int? = nil) -> some View {
        JarvisSectionHeadline(title, count: count)
            .padding(.top, 8)
            .padding(.bottom, 6)
    }

    private var notesPage: some View {
        let pinned = scopedPinnedNotes
        let folders = childFolders
        let notes = listedNotes
        let isLoadingNotes = directoryNotes[selectedFolder] == nil && !failedReads.contains(.directory)
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let loadError {
                    stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
                        .frame(minHeight: 160)
                }
                if !pinned.isEmpty {
                    sectionHeader(copy.pinned)
                    ForEach(pinned) { note in
                        noteRow(note, first: note.id == pinned.first?.id, last: note.id == pinned.last?.id)
                    }
                }
                if !folders.isEmpty {
                    sectionHeader(copy.folders)
                    ForEach(folders) { folder in
                        folderRow(folder, first: folder.id == folders.first?.id, last: folder.id == folders.last?.id)
                    }
                }
                if !notes.isEmpty {
                    sectionHeader(copy.notes)
                    ForEach(notes) { note in
                        noteRow(note, first: note.id == notes.first?.id, last: note.id == notes.last?.id)
                    }
                }
                if isLoadingNotes && loadError == nil {
                    JarvisLoadingView(title: copy.loading, size: .inline).padding(.top, 24).frame(maxWidth: .infinity)
                } else if directoryLoading.contains(selectedFolder) && !notes.isEmpty {
                    JarvisLoadingView(title: copy.loading, size: .inline).padding(.top, 12).frame(maxWidth: .infinity)
                } else if directoryHasMore[selectedFolder] == true {
                    JarvisTextButton(title: copy.loadMore, identifier: "notes.loadMore") {
                        Task { await loadMoreDirectory(selectedFolder) }
                    }
                    .frame(maxWidth: .infinity)
                }
                if !isLoadingNotes, loadError == nil, pinned.isEmpty, folders.isEmpty, notes.isEmpty {
                    stateView(icon: "note.text", title: copy[.emptyFolder], retry: nil)
                        .frame(minHeight: 200)
                        .accessibilityIdentifier("notes.empty")
                }
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.bottom, 20)
        }
        .refreshable { await loadSelectedTab(force: true) }
        .accessibilityIdentifier("notes.scroll")
    }

    private func rowDivider(_ last: Bool) -> some View {
        Divider().padding(.leading, 52).opacity(last ? 0 : 1)
    }

    func noteRow(_ note: VaultNoteSummary, first: Bool, last: Bool) -> some View {
        let isPinned = pinnedPaths.contains(note.path)
        let location = JarvisNoteTitle.location(path: note.path)
        return JarvisPinDeleteSwipeRow(
            title: note.title,
            accessibilityValue: [location.isEmpty ? copy.vaultRoot : location, isPinned ? copy.pinned : ""]
                .filter { !$0.isEmpty }.joined(separator: ", "),
            identifier: "notes.note.\(note.path)",
            pinTitle: isPinned ? copy.unpin : copy.pin,
            pinImage: isPinned ? "pin.slash" : "pin",
            deleteTitle: copy[.deleteNote],
            isDisabled: openingNotePaths.contains(note.path),
            onOpen: { Task { await openNote(path: note.path) } },
            onPin: { Task { await setPinned(note.path, pinned: !isPinned) } },
            onDelete: { Task { await requestDeleteNote(path: note.path, title: note.title) } }
        ) {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                if openingNotePaths.contains(note.path) {
                    JarvisLoadingView(size: .inline)
                        .frame(width: JarvisDesignTokens.notesIconSize + 6, height: JarvisDesignTokens.notesIconSize + 6)
                } else {
                    Image(systemName: "doc.text")
                        .font(.system(size: JarvisDesignTokens.notesIconSize + 4))
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .frame(width: JarvisDesignTokens.notesIconSize + 6)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(note.title).font(.headline).lineLimit(2).foregroundStyle(.primary)
                    Text(location.isEmpty ? copy.vaultRoot : location)
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: isPinned ? "pin.fill" : "chevron.right")
                    .font(isPinned ? .body : .footnote.weight(.semibold))
                    .foregroundStyle(isPinned ? JarvisDesignTokens.primaryAccent : Color.secondary.opacity(0.7))
                    .accessibilityHidden(true)
            }
            .frame(minHeight: JarvisDesignTokens.notesRowMinimumHeight - 20)
            .padding(.horizontal, JarvisPageHeaderMetrics.rowInset)
            .padding(.vertical, JarvisPageHeaderMetrics.rowVerticalInset)
            .overlay(alignment: .bottom) { rowDivider(last) }
        }
        .jarvisLazyRowSurface(first: first, last: last)
    }

    private func folderRow(_ folder: VaultFolderNode, first: Bool, last: Bool) -> some View {
        JarvisRowButton(identifier: "notes.folder.\(folder.path)", action: { navigateToFolder(folder.path) }) {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                Image(systemName: "folder")
                    .font(.system(size: JarvisDesignTokens.notesIconSize + 4))
                    .foregroundStyle(JarvisNotesFolderPalette.color(folder.path))
                    .frame(width: JarvisDesignTokens.notesIconSize + 6)
                    .accessibilityHidden(true)
                Text(folder.name).font(.headline).foregroundStyle(.primary).lineLimit(2)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.secondary.opacity(0.7))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, JarvisPageHeaderMetrics.rowInset)
            .padding(.vertical, JarvisPageHeaderMetrics.rowVerticalInset - 2)
            .overlay(alignment: .bottom) { rowDivider(last) }
        }
        .jarvisLazyRowSurface(first: first, last: last)
    }

    // MARK: Tasks

    private func title(for kind: JarvisTaskSection.Kind) -> String {
        switch kind {
        case .pinned: copy.pinned
        case .overdue: copy.overdue
        case .today: copy.today
        case .upcoming: copy.upcoming
        case .noDate: copy.noDate
        case .high: copy.priorityHigh
        case .medium: copy.priorityMedium
        case .normal: copy.priorityNormal
        }
    }

    private var tasksPage: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let loadError {
                    stateView(icon: "wifi.exclamationmark", title: loadError, retry: loadRetryUnavailable ? nil : refreshCurrent)
                        .frame(minHeight: 160)
                }
                if let list = taskList {
                    let sections = JarvisNotesLogic.taskSections(
                        list.items, today: list.today, sort: taskSort, scope: taskScope, pinned: pinnedTaskIDs
                    )
                    if sections.isEmpty {
                        stateView(icon: "checklist", title: copy.emptyTasks, retry: nil)
                            .frame(minHeight: 220)
                            .accessibilityIdentifier("notes.tasks.empty")
                    }
                    ForEach(sections) { section in
                        sectionHeader(title(for: section.kind), count: section.tasks.count)
                            .accessibilityIdentifier("notes.task.group.\(section.kind.rawValue)")
                        ForEach(section.tasks) { task in
                            taskRow(
                                task, today: list.today, isPinned: section.kind == .pinned,
                                first: task.id == section.tasks.first?.id, last: task.id == section.tasks.last?.id
                            )
                        }
                    }
                } else if loadError == nil {
                    JarvisLoadingView(title: copy.loading, size: .inline).padding(.top, 24).frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.bottom, 20)
        }
        .refreshable { await loadSelectedTab(force: true) }
        .accessibilityIdentifier("notes.tasks.list")
    }

    func taskRow(_ task: VaultTask, today: String, isPinned: Bool, first: Bool, last: Bool) -> some View {
        let isBusy = pendingTaskIDs.contains(task.id)
        return JarvisPinDeleteSwipeRow(
            title: JarvisTaskTitle.plain(task.text),
            accessibilityValue: [JarvisTaskFormat.sourceName(task), JarvisTaskFormat.priority(task.priority, copy: copy),
                                 JarvisTaskFormat.due(date: task.dueDate, time: task.dueTime, today: today, language: language) ?? ""]
                .filter { !$0.isEmpty }.joined(separator: ", "),
            identifier: "notes.task.row.\(task.id)",
            pinTitle: pinnedTaskIDs.contains(task.id) ? copy.unpin : copy.pin,
            pinImage: pinnedTaskIDs.contains(task.id) ? "pin.slash" : "pin",
            deleteTitle: copy[.deleteTask],
            isDisabled: isBusy,
            extraActionTitle: task.done ? nil : copy.complete,
            onExtra: { Task { await completeTask(task) } },
            onOpen: { sheet = .task(task) },
            onPin: { Task { await setTaskPinned(task.id, pinned: !pinnedTaskIDs.contains(task.id)) } },
            onDelete: { pendingDeletion = .task(task) }
        ) {
            JarvisTaskRowContent(
                task: task, copy: copy, today: today, isPinned: isPinned, isBusy: isBusy,
                onComplete: { Task { await completeTask(task) } }
            )
            .overlay(alignment: .bottom) { Divider().padding(.leading, 52).opacity(last ? 0 : 1) }
        }
        .jarvisLazyRowSurface(first: first, last: last)
    }

    // MARK: Graph

    /// The graph limited to the chosen folder scope. Nothing is added or inferred.
    func scopedGraph(_ source: KnowledgeGraph) -> KnowledgeGraph {
        JarvisNotesPresentation.graph(source, in: selectedFolder)
    }

    private var graphPage: some View {
        Group {
            if let graph {
                let scoped = scopedGraph(graph)
                if scoped.nodes.isEmpty {
                    stateView(icon: "point.3.connected.trianglepath.dotted", title: copy.emptyGraph, retry: nil)
                } else {
                    VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                        if isSearching { graphSearchStatus }
                        JarvisNotesGraphView(
                            graph: scoped,
                            copy: copy,
                            onOpen: { node in await openNote(path: node.path) },
                            searchMatches: Set(graphSearch?.hits.map(\.nodeId) ?? [])
                        )
                        .id(graphResetVersion)
                        if isSearching, let hits = graphSearch?.hits, !hits.isEmpty { graphSearchRows(hits) }
                    }
                    .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
                    .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
                }
            } else if failedReads.contains(.graph) {
                stateView(
                    icon: "point.3.connected.trianglepath.dotted", title: copy[.graphUnavailable],
                    retry: loadRetryUnavailable ? nil : refreshCurrent
                )
            } else {
                JarvisLoadingView(title: copy.loading)
            }
        }
    }

    @ViewBuilder
    private var graphSearchStatus: some View {
        if searchLoading {
            JarvisLoadingView(title: copy.loading, size: .inline)
        } else if let searchError {
            Text(searchError).font(.caption).foregroundStyle(.secondary)
        } else if graphSearch?.hits.isEmpty == true {
            Text(copy.noResults).font(.caption).foregroundStyle(.secondary)
        }
    }

    /// Matching rows are the accessible alternative to focusing nodes on the canvas.
    private func graphSearchRows(_ hits: [KnowledgeSearchHit]) -> some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(hits, id: \.nodeId) { hit in
                    if let node = graph?.nodes.first(where: { $0.id == hit.nodeId }) {
                        JarvisDetailRow(
                            title: node.title, subtitle: JarvisNoteTitle.location(path: node.path),
                            systemImage: "doc.text", identifier: "notes.graph.hit.\(node.path)",
                            action: { Task { await openNote(path: node.path) } }
                        )
                    }
                }
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
        }
        .frame(maxHeight: 220)
    }

    // MARK: Search

    private var visibleSearchNotes: [KnowledgeSearchHit] {
        searchContext == currentSearchContext ? graphSearch?.hits ?? [] : []
    }

    private var visibleSearchTasks: [VaultTask] {
        searchContext == currentSearchContext ? taskSearch?.items ?? [] : []
    }

    private var scopeName: String {
        switch searchScope {
        case .all: copy.all
        case .notes: copy.notes
        case .tasks: copy.tasks
        }
    }

    var searchContent: some View {
        let notes = searchScope == .tasks ? [] : visibleSearchNotes
        let tasks = searchScope == .notes ? [] : visibleSearchTasks
        let today = taskSearch?.today ?? taskList?.today ?? ""
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if searchLoading {
                    JarvisLoadingView(title: copy.loading, size: .inline).padding(.top, 16).frame(maxWidth: .infinity)
                }
                if let searchError {
                    stateView(icon: "wifi.exclamationmark", title: searchError, retry: searchRetryUnavailable ? nil : refreshCurrent)
                        .frame(minHeight: 160)
                }
                if !searchLoading, searchError == nil, notes.isEmpty, tasks.isEmpty {
                    VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                        Text(String(format: copy[.noResultsFor], trimmedSearch, scopeName))
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        JarvisLabelledButton(title: copy.clearSearch, identifier: "notes.search.clearResults") { searchText = "" }
                    }
                    .frame(maxWidth: .infinity, minHeight: 200)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("notes.search.empty")
                }
                if !notes.isEmpty {
                    sectionHeader(copy.notes, count: notes.count)
                    ForEach(notes, id: \.nodeId) { hit in
                        if let node = graphSearch?.graph.nodes.first(where: { $0.id == hit.nodeId }) {
                            let isFirst = hit.nodeId == notes.first?.nodeId
                            let isLast = hit.nodeId == notes.last?.nodeId
                            JarvisRowButton(identifier: "notes.search.note.\(node.path)", action: { Task { await openNote(path: node.path) } }) {
                                HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                                    Image(systemName: "doc.text")
                                        .font(.system(size: JarvisDesignTokens.notesIconSize + 4))
                                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(node.title).font(.headline).foregroundStyle(.primary)
                                        Text(hit.snippet.isEmpty ? JarvisNoteTitle.location(path: node.path) : hit.snippet)
                                            .font(.caption).foregroundStyle(.secondary)
                                            .lineLimit(JarvisDesignTokens.notesSearchSnippetLineLimit)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                                        .foregroundStyle(Color.secondary.opacity(0.7)).accessibilityHidden(true)
                                }
                                .padding(.horizontal, JarvisPageHeaderMetrics.rowInset)
                                .padding(.vertical, JarvisPageHeaderMetrics.rowVerticalInset - 2)
                                .overlay(alignment: .bottom) { rowDivider(isLast) }
                            }
                            .disabled(openingNotePaths.contains(node.path))
                            .jarvisLazyRowSurface(first: isFirst, last: isLast)
                        }
                    }
                }
                if !tasks.isEmpty {
                    sectionHeader(copy.tasks, count: tasks.count)
                    ForEach(tasks) { task in
                        let isFirst = task.id == tasks.first?.id
                        let isLast = task.id == tasks.last?.id
                        JarvisRowButton(identifier: "notes.search.task.\(task.id)", action: { sheet = .task(task) }) {
                            JarvisTaskRowContent(
                                task: task, copy: copy, today: today, isBusy: pendingTaskIDs.contains(task.id),
                                onComplete: { Task { await completeTask(task) } }
                            )
                            .overlay(alignment: .bottom) { rowDivider(isLast) }
                        }
                        .jarvisLazyRowSurface(first: isFirst, last: isLast)
                    }
                }
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.bottom, 20)
        }
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("notes.search.results")
    }

    // MARK: Shared states

    func stateView(icon: String, title: String, retry: (() -> Void)?) -> some View {
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
                JarvisLabelledButton(title: copy.retry, identifier: "notes.retry", isEmphasised: true, action: retry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .accessibilityElement(children: .contain)
    }
}
