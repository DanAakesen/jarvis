import Foundation
import JarvisCore
import SwiftUI

/// The page header with its menu, the fixed dock (mode switch or search scopes, Search and a separate plus) and the
/// sheets that belong to them.
extension JarvisNotesArea {
    // MARK: Header

    private var folderName: String {
        selectedFolder.split(separator: "/").last.map(String.init) ?? ""
    }

    private var scopeLabel: String {
        selectedFolder.isEmpty ? copy[.allFolders] : selectedFolder.replacingOccurrences(of: "/", with: " / ")
    }

    var headerTitle: String {
        selectedTab == .notes && !selectedFolder.isEmpty ? folderName : copy.title(for: selectedTab)
    }

    var header: some View {
        JarvisPageHeader(title: headerTitle, language: language, leading: backButton) {
            headerMenu
        }
    }

    private var parentFolder: String { JarvisNotesPresentation.parentFolder(of: selectedFolder) ?? "" }

    /// The back button and the edge swipe both lead one folder up; neither exists at the vault root.
    var canNavigateUp: Bool { selectedTab == .notes && !selectedFolder.isEmpty }

    func navigateUp() { navigateToFolder(parentFolder) }

    private var backButton: AnyView? {
        guard canNavigateUp else { return nil }
        let parent = parentFolder
        let parentName = parent.isEmpty ? copy.vaultRoot : (parent.split(separator: "/").last.map(String.init) ?? parent)
        return AnyView(
            JarvisIconButton(
                title: "\(copy.back): \(parentName)", systemImage: "chevron.left", identifier: "notes.folder.back"
            ) { navigateToFolder(parent) }
        )
    }

    @ViewBuilder
    private var headerMenu: some View {
        switch selectedTab {
        case .notes:
            JarvisMenuButton(
                title: copy[.more], systemImage: "ellipsis", identifier: "notes.more", isDisabled: client == nil
            ) {
                Button { sheet = .folderScope } label: {
                    Label("\(copy[.folderScope]): \(scopeLabel)", systemImage: "folder")
                }
                Picker(copy[.sortBy], selection: $noteSort) {
                    Text(copy[.sortUpdated]).tag(JarvisNoteSort.updated)
                    Text(copy[.sortTitle]).tag(JarvisNoteSort.title)
                    Text(copy[.sortManual]).tag(JarvisNoteSort.manual)
                }
                Button { sheet = .reorderFolders } label: {
                    Label(copy[.reorderFolders], systemImage: "folder")
                }
                .disabled(folderItems.count < 2)
                Button { sheet = .reorderPins } label: {
                    Label(copy[.reorderPins], systemImage: "arrow.up.arrow.down")
                }
                .disabled(pinnedPaths.count < 2)
            }
        case .tasks:
            JarvisMenuButton(
                title: copy[.more], systemImage: "ellipsis", identifier: "notes.more", isDisabled: client == nil
            ) {
                Picker(copy[.sortBy], selection: $taskSort) {
                    Text(copy[.sortDue]).tag(JarvisTaskSort.due)
                    Text(copy[.sortPriority]).tag(JarvisTaskSort.priority)
                }
                Picker(copy.scope, selection: $taskScope) {
                    Text(copy[.allTasks]).tag(JarvisTaskScopeFilter.all)
                    Text(copy.work).tag(JarvisTaskScopeFilter.work)
                    Text(copy.personal).tag(JarvisTaskScopeFilter.personal)
                }
            }
        case .graph:
            JarvisMenuButton(
                title: copy[.more], systemImage: "ellipsis", identifier: "notes.more", isDisabled: client == nil
            ) {
                Button { sheet = .folderScope } label: {
                    Label("\(copy[.folderScope]): \(scopeLabel)", systemImage: "folder")
                }
                Button { sheet = .graphList } label: { Label(copy[.list], systemImage: "list.bullet") }
                    .disabled(graph == nil)
                Button { graphSearch = nil; searchText = ""; graphResetVersion += 1 } label: {
                    Label(copy[.recenter], systemImage: "scope")
                }
            }
        }
    }

    // MARK: Dock

    private var searchPlaceholderName: String {
        switch searchScope {
        case .all: copy.search
        case .notes: copy[.searchNotes]
        case .tasks: copy[.searchTasks]
        }
    }

    var dock: some View {
        VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            if isSearching {
                JarvisSegmentedBar(
                    title: copy.search,
                    identifierPrefix: "notes.scope",
                    items: JarvisNotesSearchScope.allCases.map {
                        JarvisTabItem(tag: $0, title: scopeTitle($0), identifier: "notes.scope.\($0.rawValue)")
                    },
                    selection: $searchScope
                )
            } else {
                JarvisSegmentedBar(
                    title: copy.title,
                    identifierPrefix: "notes.tab",
                    items: JarvisNotesTab.allCases.map {
                        JarvisTabItem(tag: $0, title: copy.title(for: $0), identifier: "notes.tab.\($0.rawValue)")
                    },
                    selection: $selectedTab
                )
            }
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                JarvisSearchField(
                    placeholder: copy.search, text: $searchText, identifier: "notes.search",
                    clearTitle: copy.clearSearch, accessibilityTitle: searchPlaceholderName
                )
                plusMenu
            }
        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.vertical, JarvisDesignTokens.notesSectionSpacing)
        // Rows scroll under the dock; a fading backdrop keeps their text from colliding with the controls.
        .background(alignment: .bottom) {
            LinearGradient(
                stops: [.init(color: .clear, location: 0), .init(color: JarvisDesignTokens.pageBackground.opacity(0.96), location: 0.3)],
                startPoint: .top, endPoint: .bottom
            )
            .padding(.top, -56)
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private func scopeTitle(_ scope: JarvisNotesSearchScope) -> String {
        switch scope {
        case .all: copy.all
        case .notes: copy.notes
        case .tasks: copy.tasks
        }
    }

    /// New note sits nearest the thumb on Notes and Graph; New task does on Tasks. Creating from the graph never
    /// links the new note to the selected node.
    private var plusMenu: some View {
        JarvisMenuButton(
            title: copy.create, systemImage: "plus", identifier: "notes.plus",
            isDisabled: client == nil || signInUnavailable,
            hint: client == nil ? copy.unavailable : copy.createHint
        ) {
            if selectedTab == .tasks {
                taskButton
                noteButton
            } else {
                noteButton
                taskButton
            }
            Button { sheet = .newFolder } label: { Label(copy.newFolderTitle, systemImage: "folder.badge.plus") }
                .accessibilityIdentifier("notes.newFolder")
        }
    }

    private var noteButton: some View {
        Button { sheet = .newNote(folder: selectedFolder, staged: []) } label: {
            Label(copy.newNote, systemImage: "note.text")
        }
        .accessibilityIdentifier("notes.newNote")
    }

    private var taskButton: some View {
        Button { sheet = .newTask } label: { Label(copy.newTask, systemImage: "checklist") }
            .accessibilityIdentifier("notes.newTask")
    }

    // MARK: Graph list

    var graphListSheet: some View {
        let nodes = (graph.map(scopedGraph)?.nodes ?? [])
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        return JarvisConnectionsSheet(
            copy: copy, title: copy[.graphScopeHeading],
            sections: [JarvisConnectionsSection(title: scopeLabel, nodes: nodes)],
            emptyText: graph == nil ? copy[.graphUnavailable] : copy.emptyGraph,
            showsEmptyForAll: graph != nil && nodes.isEmpty,
            onRetry: graph == nil ? { refreshVersion += 1 } : nil,
            onOpen: { path in
                sheet = nil
                Task { await openNote(path: path) }
            },
            onClose: { sheet = nil }
        )
    }
}

/// Folder scope for browsing and the graph: the same chooser, without creating folders.
struct JarvisFolderScopeSheet: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let initial: String
    let onChoose: (String) -> Void
    @State private var staged: [String] = []

    var body: some View {
        JarvisFolderChooserSheet(
            client: client, copy: copy, initial: initial, stagedFolders: $staged,
            allowsNewFolder: false, onChoose: onChoose
        )
    }
}

#if targetEnvironment(simulator)
/// Simulator-only launch arguments for the CI screenshot captures: `--screenshot-notes-state=<name>` after the
/// navigation fixture (`--ui-test-navigation --screenshot-screen=notes`). Real builds contain none of this.
extension JarvisNotesArea {
    func applyScreenshotState() async {
        let arguments = ProcessInfo.processInfo.arguments
        guard let state = arguments.first(where: { $0.hasPrefix("--screenshot-notes-state=") })?
            .dropFirst("--screenshot-notes-state=".count) else { return }
        try? await Task.sleep(for: .seconds(2))
        switch state {
        case "folder": navigateToFolder("Work")
        case "tasks": selectedTab = .tasks
        case "graph": selectedTab = .graph
        case "search": searchText = "plan"
        case "graph-search": selectedTab = .graph; try? await Task.sleep(for: .seconds(1)); searchText = "plan"
        case "pinned":
            await setPinned("Work/Projects/release.md", pinned: true)
            await setPinned("Personal/weekend.md", pinned: true)
        case "reader": await openNote(path: "Personal/weekend.md")
        case "new-note": sheet = .newNote(folder: "Personal", staged: [])
        case "new-task": sheet = .newTask
        case "new-folder": sheet = .newFolder
        case "folder-scope": sheet = .folderScope
        case "graph-list": selectedTab = .graph; try? await Task.sleep(for: .seconds(1)); sheet = .graphList
        case "folders-manual":
            saveFolderOrder(["Work", "Personal", "Attachments"])
        case "folders-reorder":
            saveFolderOrder(["Work", "Personal", "Attachments"])
            try? await Task.sleep(for: .seconds(1))
            sheet = .reorderFolders
        case "pins":
            await setPinned("Work/Projects/release.md", pinned: true)
            await setPinned("Personal/weekend.md", pinned: true)
            sheet = .reorderPins
        case "task-detail":
            selectedTab = .tasks
            try? await Task.sleep(for: .seconds(1.5))
            if let task = taskList?.items.first { sheet = .task(task) }
        default: break
        }
    }
}
#else
extension JarvisNotesArea {
    func applyScreenshotState() async {}
}
#endif
