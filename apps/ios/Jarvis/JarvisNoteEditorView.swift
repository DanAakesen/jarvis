import Foundation
import JarvisCore
import SwiftUI

/// Edits the title and body together. Failed writes and conflicts preserve the local draft.
struct JarvisNoteEditorSheet: View {
    enum Mode: Equatable {
        case create(folder: String, staged: [String])
        case edit(VaultNote)
    }

    private enum Field: Hashable { case title, body(UUID) }

    private enum Failure: Equatable {
        case failed, unconfirmed, exists, missing, notSignedIn(String)
    }

    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let mode: Mode
    let onSaved: (VaultNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focus: Field?
    @State private var parts: JarvisNoteParts
    @State private var draftTitle: String
    @State private var folder: String
    @State private var stagedFolders: [String]
    @State private var baseline: VaultNote?
    @State private var blocks: [JarvisMarkdownBlock]
    @State private var activeBlock: UUID?
    @State private var selections: [UUID: TextSelection] = [:]
    @State private var graph: KnowledgeGraph?
    @State private var linkedExpanded = false
    @State private var showWikiPicker = false
    @State private var linkedNote: VaultNote?
    @State private var linkError: String?
    @State private var linkSearch = ""
    @State private var saving = false
    @State private var failure: Failure?
    @State private var conflict: VaultNote?
    @State private var discardPresented = false
    @State private var folderPickerPresented = false

    init(client: JarvisNotesClient, copy: JarvisNotesCopy, mode: Mode, graph: KnowledgeGraph? = nil, onSaved: @escaping (VaultNote) -> Void) {
        self.client = client
        self.copy = copy
        self.mode = mode
        _graph = State(initialValue: graph)
        self.onSaved = onSaved
        switch mode {
        case let .create(folder, staged):
            _blocks = State(initialValue: JarvisMarkdownBlock.parse(""))
            _parts = State(initialValue: JarvisNoteParts(newTitle: "", body: ""))
            _draftTitle = State(initialValue: "")
            _folder = State(initialValue: folder)
            _stagedFolders = State(initialValue: staged)
            _baseline = State(initialValue: nil)
        case let .edit(note):
            let parts = JarvisNoteParts(note.content)
            _blocks = State(initialValue: JarvisMarkdownBlock.parse(parts.body))
            _parts = State(initialValue: parts)
            _draftTitle = State(initialValue: parts.displayedTitle(path: note.path))
            _folder = State(initialValue: note.path.split(separator: "/").dropLast().joined(separator: "/"))
            _stagedFolders = State(initialValue: [])
            _baseline = State(initialValue: note)
        }
    }

    private var isCreating: Bool {
        if case .create = mode { return true }
        return false
    }

    private var bodyText: String { JarvisMarkdownBlock.document(blocks) }

    private func focusBody() {
        if let id = activeBlock ?? blocks.first(where: { $0.table == nil })?.id {
            focus = .body(id)
        }
    }

    private var titleBinding: Binding<String> {
        Binding(
            get: { draftTitle },
            set: { value in
                if value.contains(where: \.isNewline) { focusBody() }
                draftTitle = value.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).joined(separator: " ")
                failure = nil
            }
        )
    }

    private var draftContent: String {
        var parts = self.parts
        parts.body = bodyText
        if let baseline { return parts.content(editedTitle: draftTitle, path: baseline.path) }
        return JarvisNoteParts(newTitle: draftTitle, body: parts.body).content
    }

    private var isDirty: Bool {
        isCreating
            ? !draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            : draftContent != baseline?.content || notePath != baseline?.path
    }

    private var notePath: String? {
        if isCreating { return JarvisNotesLogic.notePath(folder: folder, title: draftTitle) }
        guard let filename = baseline?.path.split(separator: "/").last else { return nil }
        return folder.isEmpty ? String(filename) : folder + "/" + filename
    }

    private var blockedReason: String? {
        if isCreating {
            if notePath == nil { return copy[.saveNeedsTitle] }
        } else if draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return copy[.saveNeedsTitle]
        }
        return JarvisNotesLogic.validNoteText(draftContent) ? nil : copy.unavailable
    }

    private var location: String {
        let value = folder
        return value.isEmpty ? copy.vaultRoot : value.replacingOccurrences(of: "/", with: " / ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(isCreating ? copy.newNote : copy.title).font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy.cancel, isDisabled: saving, action: cancel)
                JarvisSheetConfirmButton(title: copy.done, isWorking: saving, isDisabled: blockedReason != nil) {
                    if isDirty { Task { await save() } } else { dismiss() }
                }
            }
            HStack(alignment: .center) {
                TextField(copy.titleField, text: titleBinding)
                    .font(.title.bold()).focused($focus, equals: .title).submitLabel(.next)
                    .onSubmit { focusBody() }.accessibilityIdentifier("editor.title")
                Spacer(minLength: 4)
                JarvisLabelledButton(title: location, systemImage: "folder", isCompact: true) { folderPickerPresented = true }
            }
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach($blocks) { $block in
                        if block.table != nil {
                            JarvisNoteTableGrid(block: $block)
                        } else {
                            TextEditor(text: $block.text, selection: $selections[block.id])
                                .font(.body).scrollContentBackground(.hidden).scrollDisabled(true)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(minHeight: blocks.count == 1 ? 150 : 44)
                                .focused($focus, equals: .body(block.id))
                                .accessibilityLabel(copy.contentField).accessibilityIdentifier("editor.body")
                        }
                    }
                }
            }.frame(maxHeight: .infinity)
            if let blockedReason, !draftTitle.isEmpty { Text(blockedReason).font(.footnote) }
            if let failure { banner(failure) }
        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.top, JarvisDesignTokens.notesSectionSpacing)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 6) {
                if !isCreating { linkedNotes }
                HStack(spacing: 0) { tools }
                    .frame(maxWidth: .infinity)
                    .jarvisGlassSurface()
            }.padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .onChange(of: focus) { _, next in
            if case let .body(id) = next { activeBlock = id }
        }
        .disabled(saving)
        .sheet(isPresented: $showWikiPicker) { linkPicker }
        .sheet(item: $linkedNote) { next in
            NavigationStack {
                JarvisNoteEditorSheet(client: client, copy: copy, mode: .edit(next), graph: graph) { _ in }
            }
        }
        .jarvisPageBackground()
        .interactiveDismissDisabled(isDirty || saving)
        .confirmationDialog(copy.discardTitle, isPresented: $discardPresented, titleVisibility: .visible) {
            Button(copy.discard, role: .destructive) { dismiss() }
            Button(copy[.keepEditing], role: .cancel) {}
        }
        .sheet(isPresented: $folderPickerPresented) {
            JarvisFolderChooserSheet(
                client: client, copy: copy, initial: folder, stagedFolders: $stagedFolders,
                onChoose: { folder = $0; folderPickerPresented = false }
            )
        }
        .sheet(item: $conflict) { latest in
            JarvisNoteConflictSheet(
                copy: copy, draft: draftContent, latest: latest,
                onKeepEditing: { conflict = nil },
                onUseLatest: { applyLatest(latest) },
                onSaveOverLatest: {
                    baseline = latest
                    conflict = nil
                    Task { await save() }
                }
            )
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            if isCreating { focus = .title }
            if graph == nil { graph = try? await client.graph() }
#if targetEnvironment(simulator)
            // CI captures only: type a change and save, to show the conflict or failed-save recovery states.
            if !isCreating, ProcessInfo.processInfo.arguments.contains("--screenshot-notes-edit-save") {
                try? await Task.sleep(for: .seconds(1))
                insertAtCursor("\nEdited in the fixture.\n")
                try? await Task.sleep(for: .seconds(1))
                await save()
            }
#endif
        }
    }

    @ViewBuilder
    private var tools: some View {
        JarvisAccessoryToolButton(title: copy.heading, systemImage: "textformat.size", identifier: "editor.heading") { prefixLine("## ") }
        JarvisAccessoryToolButton(title: "Bold", systemImage: "bold", identifier: "editor.bold") { wrap("**") }
        JarvisAccessoryToolButton(title: "Italic", systemImage: "italic", identifier: "editor.italic") { wrap("*") }
        JarvisAccessoryToolButton(title: copy.checklist, systemImage: "checkmark.square", identifier: "editor.checklist") { prefixLine("- [ ] ") }
        JarvisAccessoryToolButton(title: copy.addLink, systemImage: "link", identifier: "editor.link") { showWikiPicker = true }
        JarvisAccessoryToolMenu(title: copy[.formatting], systemImage: "ellipsis", identifier: "editor.format") {
            Button("Insert table", systemImage: "tablecells", action: insertTable)
            Button(copy[.bulletList]) { prefixLine("- ") }
            Button("Numbered list") { prefixLine("1. ") }
            Button(copy[.quote]) { prefixLine("> ") }
            Button("Highlight") { wrap("==") }
            Button("Inline code") { wrap("`") }
            Button("Web link") { wrap("[", "](https://)") }
        }
    }

    private var linkedNotes: some View {
        let connections = baseline.flatMap { note in graph.map { JarvisNoteLinks.connections(of: note.path, in: $0) } }
        let nodes = (connections?.outgoing ?? []) + (connections?.incoming ?? [])
        let unique = Dictionary(grouping: nodes, by: \.path).compactMap { $0.value.first }.sorted { $0.title < $1.title }
        return DisclosureGroup(isExpanded: $linkedExpanded) {
            ScrollView {
                VStack(alignment: .leading) {
                    if graph == nil { Text(copy[.graphUnavailable]) }
                    else if unique.isEmpty { Text(copy[.noConnections]) }
                    if let linkError { Text(linkError).font(.caption) }
                    ForEach(unique) { node in
                        JarvisDetailRow(title: node.title, subtitle: node.path, identifier: "link." + node.path) {
                            Task {
                                do { linkedNote = try await client.readNote(path: node.path); linkError = nil }
                                catch { linkError = copy.unavailable }
                            }
                        }
                    }
                }
            }.frame(maxHeight: 120)
        } label: { Label(copy[.linkedNotes] + "  " + String(unique.count), systemImage: "link") }
            .padding(.horizontal).padding(.vertical, 8).jarvisGlassSurface()
    }

    private var linkPicker: some View {
        NavigationStack {
            List {
                if graph == nil { Text(copy[.graphUnavailable]) }
                ForEach((graph?.nodes ?? []).filter { linkSearch.isEmpty || $0.path.localizedCaseInsensitiveContains(linkSearch) || $0.title.localizedCaseInsensitiveContains(linkSearch) }) { node in
                    Button(node.title) {
                        let path = (node.path as NSString).deletingPathExtension
                        insertAtCursor("[[" + path + "]]")
                        showWikiPicker = false
                    }
                }
            }.searchable(text: $linkSearch).navigationTitle(copy.addLink)
            .toolbar { ToolbarItem(placement: .cancellationAction) { JarvisSheetCloseButton(title: copy.cancel) { showWikiPicker = false } } }
        }
    }

    @ViewBuilder
    private func banner(_ current: Failure) -> some View {
        switch current {
        case .failed, .unconfirmed:
            JarvisInlineBanner(
                message: current == .failed ? copy[.saveFailed] : copy[.saveUnconfirmed], identifier: "editor.failure"
            ) {
                JarvisLabelledButton(title: copy[.continueEditing], isCompact: true) { failure = nil }
                JarvisLabelledButton(title: copy.retry, identifier: "editor.retry", isEmphasised: true, isCompact: true) {
                    Task { await retry() }
                }
            }
        case .exists:
            JarvisInlineBanner(message: copy[.noteExists], identifier: "editor.failure") {
                JarvisLabelledButton(title: copy[.continueEditing], isCompact: true) { failure = nil }
            }
        case .missing:
            JarvisInlineBanner(message: copy.noteMissing, identifier: "editor.failure") {
                JarvisLabelledButton(title: copy[.continueEditing], isCompact: true) { failure = nil }
            }
        case let .notSignedIn(message):
            JarvisInlineBanner(message: message, identifier: "editor.failure") {
                JarvisLabelledButton(title: copy[.continueEditing], isCompact: true) { failure = nil }
            }
        }
    }

    private func cancel() {
        guard !saving else { return }
        if isDirty { discardPresented = true } else { dismiss() }
    }

    private var activeIndex: Int {
        blocks.firstIndex(where: { $0.id == activeBlock && $0.table == nil }) ?? blocks.lastIndex(where: { $0.table == nil }) ?? 0
    }

    private func editRange(_ index: Int) -> Range<String.Index> {
        let text = blocks[index].text
        if let selection = selections[blocks[index].id], case let .selection(range) = selection.indices,
           range.lowerBound >= text.startIndex, range.upperBound <= text.endIndex { return range }
        return text.endIndex..<text.endIndex
    }

    private func replace(_ range: Range<String.Index>, with value: String, caret: Int? = nil) {
        let index = activeIndex
        var text = blocks[index].text
        let offset = text.distance(from: text.startIndex, to: range.lowerBound) + (caret ?? value.count)
        text.replaceSubrange(range, with: value)
        blocks[index].text = text
        selections[blocks[index].id] = TextSelection(insertionPoint: text.index(text.startIndex, offsetBy: offset))
        focus = .body(blocks[index].id)
    }

    private func wrap(_ start: String, _ end: String? = nil) {
        let selected = editRange(activeIndex)
        let value = String(blocks[activeIndex].text[selected])
        replace(selected, with: start + value + (end ?? start), caret: start.count + value.count)
    }

    private func prefixLine(_ prefix: String) {
        let text = blocks[activeIndex].text
        let caret = editRange(activeIndex).lowerBound
        let start = text[..<caret].lastIndex(of: "\n").map { text.index(after: $0) } ?? text.startIndex
        replace(start..<start, with: prefix)
    }

    private func insertAtCursor(_ value: String) { replace(editRange(activeIndex), with: value) }

    private func insertTable() {
        let index = activeIndex
        let text = blocks[index].text
        let caret = editRange(index).lowerBound
        let before = String(text[..<caret])
        let after = String(text[caret...])
        blocks[index].text = before + (before.isEmpty || before.hasSuffix("\n") ? "" : "\n")
        let table = JarvisMarkdownTable()
        let tail = JarvisMarkdownBlock(text: (after.hasPrefix("\n") ? "" : "\n") + after)
        blocks.insert(contentsOf: [.init(text: table.markdown, table: table), tail], at: index + 1)
        activeBlock = tail.id
        selections = [:]
        focus = nil
    }

    private func applyLatest(_ latest: VaultNote) {
        parts = JarvisNoteParts(latest.content)
        blocks = JarvisMarkdownBlock.parse(parts.body)
        selections = [:]
        activeBlock = nil
        draftTitle = parts.displayedTitle(path: latest.path)
        baseline = latest
        conflict = nil
        failure = nil
    }

    @MainActor
    private func save() async {
        guard !saving, blockedReason == nil, let path = notePath else { return }
        saving = true
        defer { saving = false }
        failure = nil
        focus = nil
        let submitted = draftContent
        do {
            if isCreating {
                _ = try await client.createNote(path: path, content: submitted)
            } else if let baseline {
                _ = try await client.saveNote(path: baseline.path, content: submitted, sha: baseline.sha,
                                              destination: path == baseline.path ? nil : path)
            }
            await finish(path: path)
        } catch {
            await handle(error, path: path, submitted: submitted)
        }
    }

    @MainActor
    private func finish(path: String, confirmed: VaultNote? = nil) async {
        // The write landed even if the follow-up read fails.
        await JarvisAppCache.invalidateAll(.notes)
        await JarvisAppCache.invalidateAll(.tasks)
        let refreshed: VaultNote
        do {
            if let confirmed { refreshed = confirmed } else { refreshed = try await client.readNote(path: path) }
        } catch {
            failure = .unconfirmed
            return
        }
        onSaved(refreshed)
        dismiss()
    }

    @MainActor
    private func handle(_ error: Error, path: String, submitted: String) async {
        if (error as? JarvisNotesClientError) == .destinationExists { failure = .exists; return }
        switch JarvisNoteSaveFailure.classify(error) {
        case .conflict:
            if isCreating {
                failure = .exists
            } else {
                let source = baseline?.path ?? path
                await presentConflict(path: source, submitted: submitted, reported: Self.reportedLatest(error, path: source, url: baseline?.url))
            }
        case .outcomeUnknown: failure = .unconfirmed
        case .notFound: failure = .missing
        case .signInRequired:
            failure = .notSignedIn((error as? JarvisClientError) == .notOwner ? copy.notOwner : copy.signIn)
        case .other: failure = .failed
        }
    }

    /// A conflict keeps the draft. If the latest version already holds exactly this draft, the save did land.
    @MainActor
    private func presentConflict(path: String, submitted: String, reported: VaultNote?) async {
        do {
            // The vault's own conflict reply carries the newer version; a fresh read is the fallback.
            let latest: VaultNote
            if let reported { latest = reported } else { latest = try await client.readNote(path: path) }
            if latest.content == submitted, notePath == latest.path {
                await finish(path: path, confirmed: latest)
            } else {
                conflict = latest
            }
        } catch {
            failure = .unconfirmed
        }
    }

    private static func reportedLatest(_ error: Error, path: String, url: String?) -> VaultNote? {
        guard case let JarvisNotesClientError.noteConflict(sha?, content?) = error, let url else { return nil }
        return VaultNote(path: path, content: content, sha: sha, url: url)
    }

    /// Retry first checks what the vault holds, so a write that actually succeeded is never repeated or reported as a failure.
    @MainActor
    private func retry() async {
        guard !saving, let path = notePath else { return }
        saving = true
        defer { saving = false }
        failure = nil
        let submitted = draftContent
        do {
            if isCreating {
                do {
                    let existing = try await client.readNote(path: path)
                    if existing.content == submitted { await finish(path: path, confirmed: existing) } else { failure = .exists }
                    return
                } catch JarvisNotesClientError.noteNotFound {
                    _ = try await client.createNote(path: path, content: submitted)
                    await finish(path: path)
                    return
                }
            }
            if let baseline, baseline.path != path {
                let original: VaultNote
                do { original = try await client.readNote(path: baseline.path) }
                catch JarvisNotesClientError.noteNotFound {
                    let moved = try await client.readNote(path: path)
                    if moved.content == submitted { await finish(path: path, confirmed: moved) }
                    else { failure = .unconfirmed }
                    return
                }
                guard original.sha == baseline.sha else { conflict = original; return }
                _ = try await client.saveNote(path: original.path, content: submitted, sha: original.sha, destination: path)
                await finish(path: path)
                return
            }
            let latest = try await client.readNote(path: path)
            switch JarvisNoteSaveRecovery.decide(draft: submitted, baselineSha: baseline?.sha ?? "", latest: latest) {
            case .alreadySaved: await finish(path: path, confirmed: latest)
            case .writeAgain:
                _ = try await client.saveNote(path: path, content: submitted, sha: latest.sha)
                await finish(path: path)
            case .conflict:
                conflict = latest
            }
        } catch {
            await handle(error, path: path, submitted: submitted)
        }
    }
}

/// "This note changed": the draft stays, the latest version is shown beside it, and nothing is saved until the owner picks.
struct JarvisNoteConflictSheet: View {
    let copy: JarvisNotesCopy
    let draft: String
    let latest: VaultNote
    let onKeepEditing: () -> Void
    let onUseLatest: () -> Void
    let onSaveOverLatest: () -> Void

    @State private var reviewing = false
    @State private var confirmOverwrite = false
    @State private var confirmUseLatest = false

    private func excerpt(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: true).prefix(4).joined(separator: "\n")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(reviewing ? copy[.reviewChanges] : copy[.noteChangedTitle])
                    .font(.title2.weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy[.keepEditing], action: onKeepEditing)
            }
            if reviewing { review } else { summary }
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents(reviewing ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled()
        .accessibilityIdentifier("editor.conflict")
        .confirmationDialog(copy[.overwriteTitle], isPresented: $confirmOverwrite, titleVisibility: .visible) {
            Button(copy[.useMyDraft], role: .destructive, action: onSaveOverLatest)
            Button(copy.cancel, role: .cancel) {}
        } message: {
            Text(copy[.overwriteBody])
        }
        .confirmationDialog(copy[.useLatest], isPresented: $confirmUseLatest, titleVisibility: .visible) {
            Button(copy[.useLatest], role: .destructive, action: onUseLatest)
            Button(copy.cancel, role: .cancel) {}
        } message: {
            Text(copy[.discardTitle])
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            Text(copy[.noteChangedBody]).font(.body).foregroundStyle(.secondary)
            card(copy[.yourDraft], excerpt(draft))
            card(copy.latestVersion, excerpt(latest.content))
            Spacer(minLength: 0)
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                JarvisLabelledButton(title: copy[.keepEditing], identifier: "editor.conflict.keep", isFullWidth: true, action: onKeepEditing)
                JarvisLabelledButton(title: copy[.reviewChanges], identifier: "editor.conflict.review", isFullWidth: true, isEmphasised: true) {
                    reviewing = true
                }
            }
        }
    }

    private func card(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold))
            Text(text.isEmpty ? "—" : text)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(5)
        }
        .padding(JarvisDesignTokens.notesSectionSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var review: some View {
        if draft == latest.content {
            Text(copy[.noDifferences]).foregroundStyle(.secondary)
        } else if let rows = JarvisLineDiff.rows(latest: latest.content, draft: draft) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(rows) { row in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: row.kind == .added ? "plus" : row.kind == .removed ? "minus" : "circle.fill")
                                .font(.caption2)
                                .frame(width: 14)
                                .foregroundStyle(row.kind == .same ? Color.secondary.opacity(0.4) : Color.primary)
                                .accessibilityHidden(true)
                            Text(row.text.isEmpty ? " " : row.text)
                                .font(.footnote.monospaced())
                                .foregroundStyle(row.kind == .same ? Color.secondary : Color.primary)
                                .strikethrough(row.kind == .removed)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 2)
                        .background(row.kind == .same ? Color.clear : Color.primary.opacity(0.08))
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(
                            (row.kind == .added ? copy[.onlyInDraft] : row.kind == .removed ? copy[.onlyInLatest] : "") + " " + row.text
                        )
                    }
                }
            }
            .accessibilityIdentifier("editor.conflict.diff")
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                    card(copy[.yourDraft], draft)
                    card(copy.latestVersion, latest.content)
                }
            }
        }
        Text("− \(copy[.onlyInLatest])    + \(copy[.onlyInDraft])")
            .font(.caption)
            .foregroundStyle(.secondary)
        HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            JarvisLabelledButton(title: copy[.useLatest], identifier: "editor.conflict.useLatest", isFullWidth: true) {
                confirmUseLatest = true
            }
            JarvisLabelledButton(title: copy[.useMyDraft], identifier: "editor.conflict.useDraft", isFullWidth: true, isEmphasised: true) {
                confirmOverwrite = true
            }
        }
        JarvisLabelledButton(title: copy.back, identifier: "editor.conflict.back", isFullWidth: true) { reviewing = false }
    }
}
