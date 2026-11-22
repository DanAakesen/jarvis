import Foundation
import JarvisCore
import SwiftUI

/// The one document editor, used to create a note and to edit one. Title and body are editable at once, Cancel and
/// Save sit in the accessory above the keyboard, and the draft is never replaced or lost: a conflict or a failed
/// write keeps it on screen and offers a way forward the owner chooses.
struct JarvisNoteEditorSheet: View {
    enum Mode: Equatable {
        case create(folder: String, staged: [String])
        case edit(VaultNote)
    }

    private enum Field: Hashable { case title, body }

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
    @State private var selection: TextSelection?
    @State private var saving = false
    @State private var failure: Failure?
    @State private var conflict: VaultNote?
    @State private var discardPresented = false
    @State private var folderPickerPresented = false

    init(client: JarvisNotesClient, copy: JarvisNotesCopy, mode: Mode, onSaved: @escaping (VaultNote) -> Void) {
        self.client = client
        self.copy = copy
        self.mode = mode
        self.onSaved = onSaved
        switch mode {
        case let .create(folder, staged):
            _parts = State(initialValue: JarvisNoteParts(newTitle: "", body: ""))
            _draftTitle = State(initialValue: "")
            _folder = State(initialValue: folder)
            _stagedFolders = State(initialValue: staged)
            _baseline = State(initialValue: nil)
        case let .edit(note):
            let parts = JarvisNoteParts(note.content)
            _parts = State(initialValue: parts)
            _draftTitle = State(initialValue: parts.displayedTitle(path: note.path))
            _folder = State(initialValue: "")
            _stagedFolders = State(initialValue: [])
            _baseline = State(initialValue: note)
        }
    }

    private var isCreating: Bool {
        if case .create = mode { return true }
        return false
    }

    private var bodyBinding: Binding<String> {
        Binding(get: { parts.body }, set: { parts.body = $0; failure = nil })
    }

    private var titleBinding: Binding<String> {
        Binding(
            get: { draftTitle },
            set: { value in
                if value.contains(where: \.isNewline) { focus = .body }
                draftTitle = value.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).joined(separator: " ")
                failure = nil
            }
        )
    }

    private var draftContent: String {
        if let baseline { return parts.content(editedTitle: draftTitle, path: baseline.path) }
        return JarvisNoteParts(newTitle: draftTitle, body: parts.body).content
    }

    private var isDirty: Bool {
        isCreating
            ? !draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !parts.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            : draftContent != baseline?.content
    }

    private var notePath: String? {
        isCreating
            ? JarvisNotesLogic.notePath(folder: folder, title: draftTitle)
            : baseline?.path
    }

    private var blockedReason: String? {
        if isCreating {
            if notePath == nil { return copy[.saveNeedsTitle] }
        } else if draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return copy[.saveNeedsTitle]
        } else if !isDirty {
            return copy[.saveNothingChanged]
        }
        return JarvisNotesLogic.validNoteText(draftContent) ? nil : copy.unavailable
    }

    private var location: String {
        let value = isCreating ? folder : JarvisNoteTitle.location(path: baseline?.path ?? "")
        return value.isEmpty ? copy.vaultRoot : value.replacingOccurrences(of: "/", with: " / ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            if isCreating {
                HStack {
                    Text(copy.newNote)
                        .font(.title2.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    JarvisSheetCloseButton(title: copy.cancel, isDisabled: saving) { cancel() }
                }
                JarvisRowGroup {
                    JarvisDetailRow(
                        title: location, systemImage: "folder", identifier: "editor.destination",
                        isDisabled: saving, action: { folderPickerPresented = true }
                    )
                }
                .accessibilityLabel(copy[.destination])
            } else {
                Label(location, systemImage: "folder")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("editor.location")
            }
            TextField(copy.titleField, text: titleBinding, axis: .vertical)
                .font(.title.weight(.bold))
                .lineLimit(1...3)
                .submitLabel(.next)
                .focused($focus, equals: .title)
                .onSubmit { focus = .body }
                .disabled(saving)
                .accessibilityIdentifier("editor.title")
            ZStack(alignment: .topLeading) {
                TextEditor(text: bodyBinding, selection: $selection)
                    .scrollContentBackground(.hidden)
                    .focused($focus, equals: .body)
                    .disabled(saving)
                    .accessibilityLabel(copy.contentField)
                    .accessibilityIdentifier("editor.body")
                if parts.body.isEmpty {
                    Text(copy[.startWriting])
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                        .padding(.leading, 5)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxHeight: .infinity)
            if let blockedReason {
                Text(blockedReason)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("editor.blocked")
            }
            if let failure { banner(failure) }
        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.top, JarvisDesignTokens.notesSectionSpacing)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            JarvisEditorAccessory(
                cancelTitle: copy.cancel, saveTitle: copy.save,
                isSaveDisabled: blockedReason != nil, isSaving: saving, isCancelDisabled: saving,
                saveHint: blockedReason ?? "",
                onCancel: cancel, onSave: { Task { await save() } }
            ) { tools }
        }
        .jarvisAmbientBackground()
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
            focus = isCreating ? .title : .body
#if targetEnvironment(simulator)
            // CI captures only: type a change and save, to show the conflict or failed-save recovery states.
            if !isCreating, ProcessInfo.processInfo.arguments.contains("--screenshot-notes-edit-save") {
                try? await Task.sleep(for: .seconds(1))
                parts.body += "\nEdited in the fixture.\n"
                try? await Task.sleep(for: .seconds(1))
                await save()
            }
#endif
        }
    }

    @ViewBuilder
    private var tools: some View {
        JarvisAccessoryToolMenu(title: copy[.formatting], systemImage: "textformat", identifier: "editor.format") {
            Button(copy.heading) { prefixLine("## ") }
            Button(copy[.bulletList]) { prefixLine("- ") }
            Button(copy[.quote]) { prefixLine("> ") }
        }
        JarvisAccessoryToolButton(title: copy.checklist, systemImage: "checkmark.square", identifier: "editor.checklist", isDisabled: saving) {
            prefixLine("- [ ] ")
        }
        JarvisAccessoryToolButton(title: copy.addLink, systemImage: "link", identifier: "editor.link", isDisabled: saving) {
            insertAtCursor("[link](https://)")
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

    private func cursorIndex(in text: String) -> String.Index {
        if let selection, case let .selection(range) = selection.indices {
            return min(range.lowerBound, text.endIndex)
        }
        return text.endIndex
    }

    private func prefixLine(_ prefix: String) {
        let text = parts.body
        let insertion = cursorIndex(in: text)
        let lineStart = text[..<insertion].lastIndex(of: "\n").map { text.index(after: $0) } ?? text.startIndex
        let offset = text.distance(from: text.startIndex, to: lineStart) + prefix.count
        parts.body.insert(contentsOf: prefix, at: lineStart)
        selection = TextSelection(insertionPoint: parts.body.index(parts.body.startIndex, offsetBy: offset))
        focus = .body
    }

    private func insertAtCursor(_ value: String) {
        let text = parts.body
        let insertion = cursorIndex(in: text)
        let offset = text.distance(from: text.startIndex, to: insertion) + value.count
        parts.body.insert(contentsOf: value, at: insertion)
        selection = TextSelection(insertionPoint: parts.body.index(parts.body.startIndex, offsetBy: offset))
        focus = .body
    }

    private func applyLatest(_ latest: VaultNote) {
        parts = JarvisNoteParts(latest.content)
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
            } else if let sha = baseline?.sha {
                _ = try await client.saveNote(path: path, content: submitted, sha: sha)
            }
            await finish(path: path)
        } catch {
            await handle(error, path: path, submitted: submitted)
        }
    }

    @MainActor
    private func finish(path: String, confirmed: VaultNote? = nil) async {
        let refreshed: VaultNote
        do {
            if let confirmed { refreshed = confirmed } else { refreshed = try await client.readNote(path: path) }
        } catch {
            failure = .unconfirmed
            return
        }
        await JarvisAppCache.invalidateAll(.notes)
        await JarvisAppCache.invalidateAll(.tasks)
        onSaved(refreshed)
        dismiss()
    }

    @MainActor
    private func handle(_ error: Error, path: String, submitted: String) async {
        switch JarvisNoteSaveFailure.classify(error) {
        case .conflict:
            if isCreating {
                failure = .exists
            } else {
                await presentConflict(path: path, submitted: submitted, reported: Self.reportedLatest(error, path: path, url: baseline?.url))
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
            if latest.content == submitted {
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
