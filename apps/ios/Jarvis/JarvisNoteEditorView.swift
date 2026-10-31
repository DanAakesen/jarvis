import Foundation
import JarvisCore
import SwiftUI

private enum JarvisNoteEditorAlert: Equatable {
    case discard
    case info(String)
}

struct JarvisNoteEditorView: View {
    let client: JarvisNotesClient?
    let copy: JarvisNotesCopy
    let onSaved: (VaultNote) -> Void
    let onClose: () -> Void

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
        onClose: @escaping () -> Void
    ) {
        self.client = client
        self.copy = copy
        self.onSaved = onSaved
        self.onClose = onClose
        _note = State(initialValue: note)
        _draft = State(initialValue: note.content)
    }

    private var title: String {
        URL(fileURLWithPath: note.path).deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
    }

    private var hasChanges: Bool { draft != note.content }

    private var visibleStatus: String? {
        if saving { return copy.saving }
        if latestConflict != nil { return copy.conflict }
        if let status { return status }
        if hasChanges { return copy.unsaved }
        return nil
    }

    private var alertTitle: String {
        activeAlert == .discard ? copy.discardTitle : copy.title
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            if let visibleStatus {
                Text(visibleStatus)
                    .font(.caption)
                    .foregroundStyle(latestConflict == nil ? Color.secondary : Color.orange)
                    .accessibilityLabel(visibleStatus)
            }
            if latestConflict == nil,
               status == copy.conflict || status == copy.unknownWrite || status == copy.savedNeedsRefresh {
                Button(copy.reload) {
                    Task { await reloadLatest() }
                }
                .buttonStyle(.glass)
                .disabled(saving)
            }
            if let latestConflict {
                conflictActions(latestConflict)
            }
            TextEditor(text: $draft)
                .font(.body.monospaced())
                .scrollContentBackground(.hidden)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(copy.contentField)
                .onChange(of: draft) { _, _ in
                    if !saving && latestConflict == nil && !needsReload {
                        status = nil
                    }
                }
        }
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.top, JarvisDesignTokens.notesSectionSpacing)
        .jarvisAmbientBackground()
        .navigationTitle(title.isEmpty ? copy.notes : title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    if hasChanges { activeAlert = .discard } else { onClose() }
                } label: {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel(copy.back)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await saveDraft(sha: note.sha) }
                } label: {
                    if saving {
                        ProgressView()
                    } else {
                        Text(copy.save)
                    }
                }
                .disabled(!hasChanges || saving || latestConflict != nil || needsReload || client == nil)
                .accessibilityLabel(copy.save)
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
            } else {
                Button(copy.ok, role: .cancel) { activeAlert = nil }
            }
        } message: {
            if case let .info(message) = activeAlert {
                Text(message)
            } else {
                Text(verbatim: "")
            }
        }
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
                Button(copy.reload) {
                    applyLatest(latest)
                }
                .buttonStyle(.glass)
                Button(copy.keepDraft) {
                    if draft == latest.content {
                        applyLatest(latest)
                    } else {
                        Task { await saveDraft(sha: latest.sha) }
                    }
                }
                .buttonStyle(.glass)
                .disabled(saving)
            }
        }
        .padding(JarvisDesignTokens.notesSectionSpacing)
        .background(
            .regularMaterial,
            in: RoundedRectangle(cornerRadius: JarvisDesignTokens.notesConflictPanelRadius)
        )
        .accessibilityElement(children: .contain)
    }

    private func saveDraft(sha: String) async {
        guard let client, hasChanges, !saving else { return }
        saving = true
        status = copy.saving
        defer { saving = false }
        do {
            _ = try await client.saveNote(path: note.path, content: draft, sha: sha)
            do {
                let refreshed = try await client.readNote(path: note.path)
                note = refreshed
                draft = refreshed.content
                latestConflict = nil
                status = copy.saved
                onSaved(refreshed)
            } catch {
                status = copy.savedNeedsRefresh
                needsReload = true
                activeAlert = .info(copy.savedNeedsRefresh)
            }
        } catch let error as JarvisNotesClientError {
            switch error {
            case .noteConflict:
                status = copy.conflict
                do {
                    latestConflict = try await client.readNote(path: note.path)
                } catch {
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
            status = copy.unavailable
            activeAlert = .info(copy.unavailable)
        }
    }

    private func applyLatest(_ latest: VaultNote) {
        note = latest
        draft = latest.content
        latestConflict = nil
        needsReload = false
        status = nil
        onSaved(latest)
    }

    private func reloadLatest() async {
        guard let client, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            applyLatest(try await client.readNote(path: note.path))
        } catch {
            activeAlert = .info(copy.unavailable)
        }
    }
}
