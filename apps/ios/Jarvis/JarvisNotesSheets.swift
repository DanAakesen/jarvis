import Foundation
import JarvisCore
import SwiftUI

/// Choose folder: the vault root and every normal folder, nested ones included. Expanding a folder and choosing it
/// are separate targets, and the chosen one carries a check mark. A folder inventory error offers Retry; no tree
/// is ever invented. New folders are only staged: the vault stores a folder when its first note is saved.
struct JarvisFolderChooserSheet: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let initial: String
    @Binding var stagedFolders: [String]
    var allowsNewFolder = true
    let onChoose: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var directories: [String] = []
    @State private var loading = true
    @State private var failed = false
    @State private var selection: String
    @State private var expanded: Set<String> = []
    @State private var query = ""
    @State private var newFolderPresented = false
    @State private var newFolderName = ""
    @State private var folderError: String?

    init(
        client: JarvisNotesClient, copy: JarvisNotesCopy, initial: String,
        stagedFolders: Binding<[String]>, allowsNewFolder: Bool = true, onChoose: @escaping (String) -> Void
    ) {
        self.client = client
        self.copy = copy
        self.initial = initial
        self.allowsNewFolder = allowsNewFolder
        _stagedFolders = stagedFolders
        self.onChoose = onChoose
        _selection = State(initialValue: initial)
        _expanded = State(initialValue: Self.ancestors(of: initial))
    }

    private static func ancestors(of path: String) -> Set<String> {
        var result = Set<String>()
        var prefix = ""
        for segment in path.split(separator: "/") {
            prefix = prefix.isEmpty ? String(segment) : "\(prefix)/\(segment)"
            result.insert(prefix)
        }
        return result
    }

    private var rows: [JarvisFolderPickerRow] {
        JarvisFolderPicker.rows(
            paths: directories + stagedFolders, rootName: copy.vaultRoot, expanded: expanded, query: query
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(copy[.chooseFolder]).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy.cancel) { dismiss() }
            }
            JarvisSearchField(
                placeholder: copy[.searchFolders], text: $query, identifier: "folders.search", clearTitle: copy.clearSearch
            )
            if loading {
                JarvisLoadingView(title: copy.loading, size: .inline)
            } else if failed {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                    Text(copy.unavailable).foregroundStyle(.secondary)
                    JarvisLabelledButton(title: copy.retry, identifier: "folders.retry", isEmphasised: true) {
                        Task { await load() }
                    }
                }
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(rows) { row in folderRow(row) }
                    if !loading, !failed, rows.isEmpty {
                        Text(copy[.noFolders]).foregroundStyle(.secondary).padding()
                    }
                }
            }
            .accessibilityIdentifier("folders.list")
            if let folderError {
                Text(folderError).font(.footnote).foregroundStyle(.red)
            } else if stagedFolders.contains(selection) {
                Text(copy[.folderStagedNote]).font(.footnote).foregroundStyle(.secondary)
            }
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                if allowsNewFolder {
                    JarvisLabelledButton(
                        title: copy.newFolderTitle, systemImage: "plus",
                        identifier: "folders.new", isDisabled: failed || loading
                    ) {
                        folderError = nil
                        newFolderName = ""
                        newFolderPresented = true
                    }
                }
                JarvisLabelledButton(
                    title: copy[.chooseFolder], identifier: "folders.choose", isFullWidth: true, isEmphasised: true
                ) { onChoose(selection) }
            }
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .alert(copy.newFolderTitle, isPresented: $newFolderPresented) {
            TextField(copy.folderName, text: $newFolderName)
            Button(copy.create) { stageFolder() }
            Button(copy.cancel, role: .cancel) {}
        }
        .task { await load() }
        .accessibilityIdentifier("folders.sheet")
    }

    private func folderRow(_ row: JarvisFolderPickerRow) -> some View {
        let isSelected = row.path == selection
        return HStack(spacing: 0) {
            if row.isExpandable {
                JarvisIconButton(
                    title: row.name, systemImage: row.isExpanded ? "chevron.down" : "chevron.right",
                    identifier: "folders.expand.\(row.path)", isCompact: false,
                    hint: row.isExpanded ? copy.expanded : copy.collapsed
                ) {
                    if expanded.contains(row.path) { expanded.remove(row.path) } else { expanded.insert(row.path) }
                }
                .scaleEffect(0.8)
                .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
            } else {
                Color.clear.frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
            }
            JarvisRowButton(identifier: "folders.row.\(row.path)", action: { selection = row.path; folderError = nil }) {
                HStack(spacing: 12) {
                    Image(systemName: row.path.isEmpty ? "tray.full" : "folder")
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .accessibilityHidden(true)
                    Text(row.name).font(.body).foregroundStyle(.primary)
                    Spacer(minLength: 0)
                    if isSelected {
                        Image(systemName: "checkmark").foregroundStyle(JarvisDesignTokens.primaryAccent).accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 8)
                .background(isSelected ? Color.primary.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 12))
            }
            .accessibilityValue(isSelected ? copy[.selected] : "")
            .accessibilityAddTraits(isSelected ? .isSelected : [])
        }
        .padding(.leading, CGFloat(row.depth) * 16)
    }

    @MainActor
    private func load() async {
        loading = true
        failed = false
        defer { loading = false }
        do {
            directories = try await client.folderTree().directories
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
        }
    }

    private func stageFolder() {
        guard let path = JarvisNotesPresentation.newFolderPath(named: newFolderName, in: selection),
              path.utf16.count <= 171 else {
            folderError = copy.folderInvalidName
            return
        }
        if (directories + stagedFolders).contains(path) {
            folderError = copy.folderAlreadyExists
            return
        }
        stagedFolders.append(path)
        expanded.formUnion(Self.ancestors(of: path))
        selection = path
        folderError = nil
    }
}

/// New folder: choose a parent and a name, then continue to a new note in that proposed destination. Nothing is
/// written here; canceling the note leaves no empty folder behind.
struct JarvisNewFolderSheet: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let onContinue: (String) -> Void
    let onClose: () -> Void

    @FocusState private var nameFocused: Bool
    @State private var parent: String
    @State private var name = ""
    @State private var directories: [String] = []
    @State private var staged: [String] = []
    @State private var chooserPresented = false

    init(client: JarvisNotesClient, copy: JarvisNotesCopy, initialParent: String,
         onContinue: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.client = client
        self.copy = copy
        self.onContinue = onContinue
        self.onClose = onClose
        _parent = State(initialValue: initialParent)
    }

    private var path: String? {
        guard let value = JarvisNotesPresentation.newFolderPath(named: name, in: parent), value.utf16.count <= 171 else { return nil }
        return value
    }

    private var duplicate: Bool {
        guard let path else { return false }
        return directories.contains { $0 == path || $0.hasPrefix(path + "/") }
    }

    private var problem: String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        if path == nil { return copy.folderInvalidName }
        return duplicate ? copy.folderAlreadyExists : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(copy.newFolderTitle).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy.cancel, action: onClose)
            }
            JarvisRowGroup {
                JarvisDetailRow(
                    title: parent.isEmpty ? copy.vaultRoot : parent.replacingOccurrences(of: "/", with: " / "),
                    systemImage: "folder", identifier: "newfolder.parent", action: { chooserPresented = true }
                )
            }
            .accessibilityLabel(copy.parentFolder)
            TextField(copy.folderName, text: $name)
                .focused($nameFocused)
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .padding(JarvisDesignTokens.notesSectionSpacing)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
                .accessibilityIdentifier("newfolder.name")
            Text(problem ?? copy[.folderStagedNote])
                .font(.footnote)
                .foregroundStyle(problem == nil ? Color.secondary : Color.red)
            Spacer(minLength: 0)
            JarvisLabelledButton(
                title: copy[.continueToNote], identifier: "newfolder.continue",
                isDisabled: path == nil || duplicate, isFullWidth: true, isEmphasised: true
            ) {
                if let path { onContinue(path) }
            }
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .sheet(isPresented: $chooserPresented) {
            JarvisFolderChooserSheet(client: client, copy: copy, initial: parent, stagedFolders: $staged) {
                parent = $0
                chooserPresented = false
            }
        }
        .task {
            directories = (try? await client.folderTree().directories) ?? []
            try? await Task.sleep(for: .milliseconds(250))
            nameFocused = true
        }
        .accessibilityIdentifier("newfolder.sheet")
    }
}

struct JarvisPinnedItem: Identifiable, Equatable {
    let path: String
    let title: String
    let location: String
    var id: String { path }
}

/// Reorder pins: drag handles plus Move up / Move down actions. Pin order is display metadata on this device; no
/// file is moved or rewritten.
struct JarvisReorderPinsSheet: View {
    let copy: JarvisNotesCopy
    let items: [JarvisPinnedItem]
    let onChanged: ([String]) -> Void
    let onClose: () -> Void

    @State private var order: [String]

    init(copy: JarvisNotesCopy, items: [JarvisPinnedItem], onChanged: @escaping ([String]) -> Void, onClose: @escaping () -> Void) {
        self.copy = copy
        self.items = items
        self.onChanged = onChanged
        self.onClose = onClose
        _order = State(initialValue: items.map(\.path))
    }

    private func item(_ path: String) -> JarvisPinnedItem? { items.first { $0.path == path } }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(copy[.reorderPins]).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy.done, action: onClose)
            }
            List {
                ForEach(order, id: \.self) { path in
                    if let item = item(path) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.headline)
                            if !item.location.isEmpty { Text(item.location).font(.caption).foregroundStyle(.secondary) }
                        }
                        .frame(minHeight: JarvisDesignTokens.controlMinimumHeight, alignment: .leading)
                        .listRowBackground(JarvisGlassSurface())
                        .accessibilityElement(children: .combine)
                        .accessibilityAction(named: Text(copy[.moveUp])) { move(path, by: -1) }
                        .accessibilityAction(named: Text(copy[.moveDown])) { move(path, by: 1) }
                        .accessibilityIdentifier("pins.row.\(path)")
                    }
                }
                .onMove { source, destination in
                    order = JarvisPinOrder.moved(order, from: source, to: destination)
                    onChanged(order)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.editMode, .constant(.active))
            JarvisLabelledButton(title: copy.done, identifier: "pins.done", isFullWidth: true, isEmphasised: true, action: onClose)
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("pins.sheet")
    }

    private func move(_ path: String, by offset: Int) {
        order = JarvisPinOrder.moved(order, path, by: offset)
        onChanged(order)
    }
}
