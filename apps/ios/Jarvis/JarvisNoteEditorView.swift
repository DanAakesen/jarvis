import Foundation
import JarvisCore
import SwiftUI

private enum JarvisNoteEditorAlert: Equatable {
    case discard
    case delete
    case info(String)
}

struct JarvisNoteEditorView: View {
    let client: JarvisNotesClient?
    let copy: JarvisNotesCopy
    let onSaved: (VaultNote) -> Void
    let onPin: (Bool) -> Void
    let onDeleted: (String) -> Void
    let onClose: () -> Void
    @State private var isPinned: Bool
    @State private var document: JarvisNoteDocument
    @State private var rawMode = false
    @State private var undoHistory: [String] = []
    @FocusState private var editingBlock: UUID?
    @FocusState private var editingTitle: Bool

    @State private var note: VaultNote
    @State private var draft: String
    @State private var saving = false
    @State private var status: String?
    @State private var latestConflict: VaultNote?
    @State private var needsReload = false
    @State private var activeAlert: JarvisNoteEditorAlert?

    init(
        client: JarvisNotesClient?,
        copy: JarvisNotesCopy,
        note: VaultNote,
        onSaved: @escaping (VaultNote) -> Void,
        isPinned: Bool = false,
        onPin: @escaping (Bool) -> Void = { _ in },
        onDeleted: @escaping (String) -> Void,
        onClose: @escaping () -> Void
    ) {
        self.client = client
        self.copy = copy
        self.onSaved = onSaved
        self.onClose = onClose
        self.onPin = onPin
        self.onDeleted = onDeleted
        _isPinned = State(initialValue: isPinned)
        _document = State(initialValue: JarvisNoteDocument(note.content))
        _note = State(initialValue: note)
        _draft = State(initialValue: note.content)
    }

    private var title: String {
        document.blocks.first(where: { $0.headingLevel == 1 })?.text ?? URL(fileURLWithPath: note.path).deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
    }

    private var hasChanges: Bool { draft != note.content }

    private var visibleStatus: String? {
        if saving { return copy.saving }
        if latestConflict != nil { return copy.conflict }
        if let status { return status }
        if hasChanges { return copy.unsaved }
        return copy.saved
    }

    private var alertTitle: String {
        switch activeAlert {
        case .discard: copy.discardTitle
        case .delete: "Delete note?"
        default: copy.title
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    if let index = document.blocks.firstIndex(where: { $0.headingLevel == 1 }) {
                        TextField(copy.titleField, text: Binding(
                            get: { document.blocks[index].text },
                            set: { value in
                                remember(draft)
                                document.blocks[index].text = value
                                draft = document.markdown
                                clearStatus()
                            }), axis: .vertical)
                            .font(.largeTitle.bold())
                            .focused($editingTitle)
                            .accessibilityIdentifier("note.title")
                    } else {
                        Text(title).font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
                    }
                    Text(note.path.split(separator: "/").dropLast().joined(separator: " / "))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                JarvisIconButton(title: isPinned ? copy.unpin : copy.pin,
                                 systemImage: isPinned ? "pin.fill" : "pin",
                                 identifier: "note.pin") {
                    isPinned.toggle()
                    onPin(isPinned)
                }
                JarvisIconButton(title: "Delete note", systemImage: "trash", identifier: "note.delete",
                                 isDisabled: saving || latestConflict != nil || needsReload || client == nil) {
                    activeAlert = .delete
                }
            }
            Divider()
            if let visibleStatus {
                Text(visibleStatus)
                    .font(.caption)
                    .foregroundStyle(latestConflict == nil ? Color.secondary : Color.orange)
                    .accessibilityLabel(visibleStatus)
            }
            if latestConflict == nil,
               status == copy.conflict || status == copy.unknownWrite || status == copy.savedNeedsRefresh {
                JarvisLabelledButton(title: copy.reload, isDisabled: saving) {
                    Task { await reloadLatest() }
                }
            }
            if let latestConflict {
                conflictActions(latestConflict)
            }
            if rawMode {
                TextEditor(text: $draft)
                    .font(.body.monospaced())
                    .scrollContentBackground(.hidden)
                    .accessibilityLabel(copy.contentField)
                    .accessibilityIdentifier("note.rawEditor")
                    .onChange(of: draft) { previous, next in
                        document = JarvisNoteDocument(next)
                        if previous != next { remember(previous) }
                        clearStatus()
                    }
            } else {
                formattedEditor
            }

        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.top, JarvisDesignTokens.notesSectionSpacing)
        .safeAreaInset(edge: .bottom) {
            if !rawMode && editingBlock == nil && !editingTitle {
                formattingToolbar
                    .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            }
        }
        .jarvisAmbientBackground()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                JarvisIconButton(
                    title: copy.back,
                    systemImage: "chevron.left",
                    identifier: "note.back"
                ) {
                    if hasChanges { activeAlert = .discard } else { onClose() }
                }
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .topBarTrailing) {
                JarvisTextButton(title: rawMode ? copy.formatted : copy.raw, identifier: "note.raw") {
                    editingBlock = nil
                    editingTitle = false
                    rawMode.toggle()
                }
            }.sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSheetConfirmButton(title: copy.save, isWorking: saving,
                                         isDisabled: latestConflict != nil || needsReload || client == nil) {
                    editingBlock = nil
                    editingTitle = false
                    if hasChanges {
                        Task { if await saveDraft(sha: note.sha) { onClose() } }
                    } else { onClose() }
                }
            }.sharedBackgroundVisibility(.hidden)
            if !rawMode {
                ToolbarItemGroup(placement: .keyboard) {
                    formattingToolbar
                }
            }
        }
        .alert(alertTitle, isPresented: Binding(
            get: { activeAlert != nil },
            set: { if !$0 { activeAlert = nil } }
        )) {
            if activeAlert == .discard {
                Button(copy.cancel, role: .cancel) { activeAlert = nil }
                Button(copy.discard, role: .destructive) {
                    activeAlert = nil
                    onClose()
                }
            } else if activeAlert == .delete {
                Button("No", role: .cancel) { activeAlert = nil }
                Button("Yes", role: .destructive) {
                    activeAlert = nil
                    Task { await deleteNote() }
                }
            } else {
                Button(copy.ok, role: .cancel) { activeAlert = nil }
            }
        } message: {
            if case let .info(message) = activeAlert {
                Text(message)
            } else if activeAlert == .delete {
                Text(hasChanges
                     ? "Delete this note and discard your unsaved changes? It can be recovered from vault Git history."
                     : "Delete this note? It can be recovered from vault Git history.")
            } else {
                Text(verbatim: "")
            }
        }
    }

    private var formattedEditor: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(document.blocks.enumerated()), id: \.element.id) { index, block in
                        if index != document.blocks.firstIndex(where: { $0.headingLevel == 1 }) {
                            blockEditor(index, block: block).id(block.id)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 24)
            }
            .accessibilityIdentifier("note.formattedEditor")
            .onChange(of: editingBlock) { _, target in
                if let target { proxy.scrollTo(target, anchor: .center) }
            }
        }
    }

    private var formattingToolbar: some View {
        ScrollView(.horizontal) {
        HStack(spacing: 4) {
            JarvisMenuButton(title: copy.heading, systemImage: "textformat", identifier: "note.format") {
                Button(copy.heading) { appendBlock(prefix: "## ") }
                Button(copy.contentField) { appendBlock(prefix: "") }
            }
            JarvisIconButton(title: copy.checklist, systemImage: "checkmark.square", identifier: "note.checklist") {
                appendBlock(prefix: "- [ ] ")
            }
            JarvisIconButton(title: "Bullet list", systemImage: "list.bullet", identifier: "note.bullet") {
                appendBlock(prefix: "- ")
            }
            JarvisIconButton(title: "Quote", systemImage: "text.quote", identifier: "note.quote") {
                appendBlock(prefix: "> ")
            }
            JarvisIconButton(title: copy.addLink, systemImage: "link", identifier: "note.link") {
                appendBlock(prefix: "", text: "[](https://)")
            }
            JarvisIconButton(title: copy.undo, systemImage: "arrow.uturn.backward", identifier: "note.undo",
                             isDisabled: undoHistory.isEmpty) {
                guard let previous = undoHistory.popLast() else { return }
                draft = previous
                document = JarvisNoteDocument(previous)
                editingBlock = nil
                clearStatus()
            }
        }
        }
        .scrollIndicators(.hidden)
    }

    private func deleteNote() async {
        guard let client, !saving, latestConflict == nil, !needsReload else { return }
        saving = true
        defer { saving = false }
        do {
            try await client.deleteNote(path: note.path, sha: note.sha)
            onDeleted(note.path)
        } catch JarvisNotesClientError.noteConflict {
            needsReload = true
            status = copy.conflict
            activeAlert = .info("The note changed. Reload it before trying again.")
        } catch {
            needsReload = true
            status = copy.unknownWrite
            activeAlert = .info("Deletion could not be confirmed. Refresh the note before trying again.")
        }
    }

    @ViewBuilder
    private func blockEditor(_ index: Int, block: JarvisNoteDocument.Block) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            if block.isChecklist {
                JarvisIconButton(title: block.isChecked ? copy.completed : copy.complete,
                                 systemImage: block.isChecked ? "checkmark.square" : "square",
                                 identifier: "note.check.\(index)") {
                    remember(draft)
                    document.blocks[index].toggleCheck()
                    draft = document.markdown
                    clearStatus()
                }
            } else if block.isBullet {
                Text("•").accessibilityHidden(true)
            }
            TextField(document.blocks.count == 1 ? copy.contentField : "", text: Binding(
                get: { document.blocks[index].text },
                set: { value in
                    remember(draft)
                    document.blocks[index].text = value
                    draft = document.markdown
                    clearStatus()
                }), axis: .vertical)
                .font(blockFont(block))
                .foregroundStyle(block.isChecked ? Color.secondary : Color.primary)
                .strikethrough(block.isChecked)
                .focused($editingBlock, equals: block.id)
                .accessibilityLabel(copy.contentField)
                .accessibilityIdentifier("note.block.\(index)")
        }
        .padding(.top, block.headingLevel > 0 ? 12 : 0)
    }

    private func blockFont(_ block: JarvisNoteDocument.Block) -> Font {
        if block.isCode { return .body.monospaced() }
        switch block.headingLevel {
        case 1: return .title.bold()
        case 2: return .title2.bold()
        case 3...6: return .headline
        default: return .body
        }
    }

    private func appendBlock(prefix: String, text: String = "") {
        remember(draft)
        editingBlock = document.append(prefix: prefix, text: text)
        draft = document.markdown
        clearStatus()
    }

    private func remember(_ source: String) {
        guard undoHistory.last != source else { return }
        undoHistory.append(source)
        if undoHistory.count > 100 { undoHistory.removeFirst() }
    }

    private func clearStatus() {
        if !saving && latestConflict == nil && !needsReload { status = nil }
    }

    private func conflictActions(_ latest: VaultNote) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            Text(copy.latestVersion)
                .font(.subheadline.weight(.semibold))
            ScrollView {
                Text(latest.content)
                    .font(.caption.monospaced())
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: JarvisDesignTokens.notesConflictPreviewMaximumHeight)
            HStack {
                JarvisLabelledButton(title: copy.reload) {
                    applyLatest(latest)
                }
                JarvisLabelledButton(title: copy.keepDraft, isDisabled: saving) {
                    if draft == latest.content {
                        applyLatest(latest)
                    } else {
                        Task { await saveDraft(sha: latest.sha) }
                    }
                }
            }
        }
        .padding(JarvisDesignTokens.notesSectionSpacing)
        .background(
            .regularMaterial,
            in: RoundedRectangle(cornerRadius: JarvisDesignTokens.notesConflictPanelRadius)
        )
        .accessibilityElement(children: .contain)
    }

    @discardableResult
    private func saveDraft(sha: String) async -> Bool {
        guard let client, hasChanges, !saving else { return false }
        let path = note.path
        let submitted = draft
        saving = true
        status = copy.saving
        defer { saving = false }
        do {
            _ = try await client.saveNote(path: path, content: submitted, sha: sha)
            await JarvisAppCache.invalidateAll(.notes)
            do {
                let refreshed = try await client.readNote(path: path)
                guard !Task.isCancelled, note.path == path else { return false }
                note = refreshed
                if draft == submitted {
                    draft = refreshed.content
                    document = JarvisNoteDocument(refreshed.content)
                }
                latestConflict = nil
                status = copy.saved
                onSaved(refreshed)
                return draft == refreshed.content
            } catch {
                guard !Task.isCancelled, note.path == path else { return false }
                status = copy.savedNeedsRefresh
                needsReload = true
                activeAlert = .info(copy.savedNeedsRefresh)
            }
        } catch let error as JarvisNotesClientError {
            guard !Task.isCancelled, note.path == path else { return false }
            switch error {
            case .noteConflict:
                status = copy.conflict
                do {
                    let latest = try await client.readNote(path: path)
                    guard !Task.isCancelled, note.path == path else { return false }
                    latestConflict = latest
                } catch {
                    guard !Task.isCancelled, note.path == path else { return false }
                    latestConflict = nil
                    needsReload = true
                    activeAlert = .info(copy.conflict)
                }
            case .writeOutcomeUnknown:
                status = copy.unknownWrite
                needsReload = true
                activeAlert = .info(copy.unknownWrite)
            case .noteNotFound:
                status = copy.noteMissing
                activeAlert = .info(copy.noteMissing)
            default:
                status = copy.unavailable
                activeAlert = .info(copy.unavailable)
            }
        } catch {
            guard !Task.isCancelled, note.path == path else { return false }
            status = copy.unavailable
            activeAlert = .info(copy.unavailable)
        }
        return false
    }

    private func applyLatest(_ latest: VaultNote) {
        note = latest
        draft = latest.content
        document = JarvisNoteDocument(latest.content)
        undoHistory = []
        latestConflict = nil
        needsReload = false
        status = nil
        onSaved(latest)
    }

    private func reloadLatest() async {
        guard let client, !saving else { return }
        let path = note.path
        let submitted = draft
        saving = true
        defer { saving = false }
        do {
            let latest = try await client.readNote(path: path)
            guard !Task.isCancelled, note.path == path, draft == submitted else { return }
            applyLatest(latest)
        } catch {
            guard !Task.isCancelled, note.path == path else { return }
            activeAlert = .info(copy.unavailable)
        }
    }
}
