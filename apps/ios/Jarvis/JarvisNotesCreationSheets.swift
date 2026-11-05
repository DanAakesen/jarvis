import Foundation
import JarvisCore
import SwiftUI

private struct JarvisNoteFolderPicker: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    @Binding var folder: String
    var persistsWithNote = true
    @State private var presented = false
    @State private var draft = ""
    @State private var stagedFolders: [String] = []

    var body: some View {
        Section {
            HStack {
                Text(persistsWithNote ? copy.folderField : copy.parentFolder)
                Spacer()
                JarvisTextButton(title: folder.isEmpty ? copy.vaultRoot : folder.replacingOccurrences(of: "/", with: " / "),
                                 identifier: "notes.create.folder") {
                    draft = folder
                    presented = true
                }
            }
            if persistsWithNote, stagedFolders.contains(folder) {
                Text(copy.folderSavedWithNote).font(.caption).foregroundStyle(.secondary)
            }
        }
        .sheet(isPresented: $presented) {
            NavigationStack {
                JarvisForm {
                    JarvisNoteFolderPickerContent(client: client, copy: copy, folder: $draft,
                                                 stagedFolders: $stagedFolders, persistsWithNote: persistsWithNote)
                }
                .navigationTitle(persistsWithNote ? copy.folderField : copy.parentFolder)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    JarvisSheetToolbar(confirmTitle: copy.useFolder, closeTitle: copy.cancel,
                        onConfirm: { folder = draft; presented = false }, onClose: { presented = false })
                }
            }
        }
    }
}

private struct JarvisNoteFolderPickerContent: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    @Binding var folder: String
    @Binding var stagedFolders: [String]
    var persistsWithNote = true
    @State private var directories: [String] = []
    @State private var newFolderName = ""
    @State private var loadingFolders = false
    @State private var folderLoadFailed = false

    private var trimmedFolder: String { folder.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var newFolderPath: String? {
        JarvisNotesPresentation.newFolderPath(named: newFolderName, in: trimmedFolder)
    }

    private var duplicateFolder: Bool {
        guard let path = newFolderPath else { return false }
        return (directories + stagedFolders).contains { $0 == path || $0.hasPrefix(path + "/") }
    }

    /// Staged paths are persisted only by the enclosing sheet's confirmed write.
    var body: some View {
        Section {
            Text(trimmedFolder.isEmpty ? copy.vaultRoot : trimmedFolder.replacingOccurrences(of: "/", with: " / "))
                .font(.subheadline)
                .accessibilityIdentifier("notes.create.folder.path")
            if let parent = JarvisNotesPresentation.parentFolder(of: trimmedFolder) {
                JarvisTextButton(title: copy.back, identifier: "notes.create.folder.back") {
                    folder = parent
                    newFolderName = ""
                }
            }
            ForEach(JarvisNotesPresentation.childFolders(in: trimmedFolder, paths: directories + stagedFolders)) { child in
                Button { folder = child.path; newFolderName = "" } label: {
                    HStack {
                        Label(child.name, systemImage: "folder")
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption)
                    }.foregroundStyle(.primary)
                }
                .accessibilityIdentifier("notes.create.folder.\(child.path)")
            }
            HStack {
                TextField(copy.folderName, text: $newFolderName)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("notes.create.folder.name")
                JarvisIconButton(title: copy.newFolderHere, systemImage: "folder.badge.plus",
                                 identifier: "notes.create.folder.add", isDisabled: newFolderPath == nil || duplicateFolder || loadingFolders || folderLoadFailed) {
                    guard let path = newFolderPath else { return }
                    stagedFolders.append(path)
                    folder = path
                    newFolderName = ""
                }
            }
            if !newFolderName.isEmpty, newFolderPath == nil || duplicateFolder {
                Text(duplicateFolder ? copy.folderAlreadyExists : copy.folderInvalidName)
                    .font(.caption).foregroundStyle(.secondary)
            }
            if persistsWithNote && !stagedFolders.isEmpty {
                Text(copy.folderSavedWithNote).font(.caption).foregroundStyle(.secondary)
            }
            if loadingFolders {
                JarvisLoadingView(title: copy.loading, size: .inline)
            } else if folderLoadFailed {
                Text(copy.unavailable).font(.caption).foregroundStyle(.secondary)
                JarvisTextButton(title: copy.retry) { Task { await loadFolders() } }
            }
        } header: {
            Text(copy.folderField)
        }
        .task { await loadFolders() }
    }

    private func loadFolders() async {
        loadingFolders = true
        folderLoadFailed = false
        defer { loadingFolders = false }
        do {
            directories = try await client.folderTree().directories
        } catch {
            guard !Task.isCancelled else { return }
            folderLoadFailed = true
        }
    }

}

struct JarvisNewFolderSheet: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let initialFolder: String
    let onCreated: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var parent = ""
    @State private var name = ""
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var retryUnavailable = false

    private var path: String? {
        guard let value = JarvisNotesPresentation.newFolderPath(named: name, in: parent), value.utf16.count <= 171 else { return nil }
        return value
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                TextField(copy.folderName, text: $name)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("notes.create.folder.title")
                JarvisNoteFolderPicker(client: client, copy: copy, folder: $parent, persistsWithNote: false)
                if !name.isEmpty, path == nil { Text(copy.folderInvalidName).foregroundStyle(.secondary) }
                if let errorMessage { Text(errorMessage).foregroundStyle(.secondary) }
            }
            .navigationTitle(copy.newFolderTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(confirmTitle: copy.create, closeTitle: copy.cancel,
                    isWorking: saving, isConfirmDisabled: path == nil || saving || retryUnavailable,
                    onConfirm: { Task { await create() } }, onClose: { dismiss() })
            }
        }
        .onAppear { parent = initialFolder }
    }

    private func create() async {
        guard let path, !saving else { return }
        saving = true
        errorMessage = nil
        defer { saving = false }
        do {
            _ = try await client.createFolder(path: path)
            await JarvisAppCache.invalidateAll(.notes)
            dismiss()
            onCreated(path)
        } catch let error as JarvisNotesClientError {
            retryUnavailable = error == .writeOutcomeUnknown
            errorMessage = error == .folderAlreadyExists ? copy.folderAlreadyExists
                : retryUnavailable ? copy.unknownWrite : copy.unavailable
        } catch let error as JarvisClientError {
            retryUnavailable = error == .signInRequired || error == .notOwner
            errorMessage = error == .signInRequired ? copy.signIn : error == .notOwner ? copy.notOwner : copy.unavailable
        } catch {
            errorMessage = copy.unavailable
        }
    }
}

struct JarvisNewNoteSheet: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let initialFolder: String
    let onCreated: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var folder = ""
    @State private var content = ""
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var outcomeUnknown = false
    @State private var authorizationUnavailable = false
    var body: some View {
        NavigationStack {
            JarvisForm {
                TextField(copy.titleField, text: $title)
                    .textInputAutocapitalization(.sentences)
                    .accessibilityIdentifier("notes.create.title")
                JarvisNoteFolderPicker(client: client, copy: copy, folder: $folder)
                Section {
                    TextEditor(text: $content)
                        .frame(minHeight: JarvisDesignTokens.notesEditorMinimumHeight)
                } header: {
                    Text(copy.contentField)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(copy.newNote)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: copy.create,
                    closeTitle: copy.cancel,
                    isWorking: saving,
                    isConfirmDisabled: !canCreate || saving || outcomeUnknown || authorizationUnavailable,
                    onConfirm: { Task { await create() } },
                    onClose: { dismiss() }
                )
            }
        }
        .onAppear { folder = initialFolder }

    }

    private var canCreate: Bool {
        JarvisNotesLogic.notePath(folder: folder.trimmingCharacters(in: .whitespacesAndNewlines), title: title) != nil
            && JarvisNotesLogic.validNoteText(content)
    }

    private func create() async {
        guard !saving,
              let path = JarvisNotesLogic.notePath(
                folder: folder.trimmingCharacters(in: .whitespacesAndNewlines),
                title: title
              ) else { return }
        saving = true
        errorMessage = nil
        defer { saving = false }
        let trimmedBody = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = trimmedBody.isEmpty ? "# \(title.trimmingCharacters(in: .whitespacesAndNewlines))" : content
        do {
            _ = try await client.createNote(path: path, content: body)
            await JarvisAppCache.invalidateAll(.notes)
            dismiss()
            await onCreated(path)
        } catch let error as JarvisClientError {
            authorizationUnavailable = error == .signInRequired || error == .notOwner
            errorMessage = error == .signInRequired ? copy.signIn : error == .notOwner ? copy.notOwner : copy.unavailable
        } catch let error as JarvisNotesClientError {
            if case .writeOutcomeUnknown = error {
                outcomeUnknown = true
                errorMessage = copy.unknownWrite
            } else {
                errorMessage = copy.unavailable
            }
        } catch {
            errorMessage = copy.unavailable
        }
    }
}

struct JarvisNewTaskSheet: View {
    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let onCreated: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var scope: VaultTaskScope = .work
    @State private var priority: VaultTask.Priority = .normal
    @State private var dueDateEnabled = false
    @State private var dueTimeEnabled = false
    @State private var dueDate = Date()
    @State private var dueTime = Date()
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var outcomeUnknown = false
    @State private var authorizationUnavailable = false

    var body: some View {
        NavigationStack {
            JarvisForm {
                TextField(copy.titleField, text: $title, axis: .vertical)
                    .lineLimit(1...3)
                    .accessibilityIdentifier("notes.create.title")
                Toggle(copy.dueDateEnabled, isOn: $dueDateEnabled)
                if dueDateEnabled {
                    DatePicker(copy.dueDate, selection: $dueDate, displayedComponents: .date)
                }
                Toggle(copy.dueTimeEnabled, isOn: $dueTimeEnabled)
                if dueTimeEnabled {
                    DatePicker(copy.dueTime, selection: $dueTime, displayedComponents: .hourAndMinute)
                }
                Section {
                    JarvisSegmentedBar(
                        title: copy.scope,
                        identifierPrefix: "notes.create.scope",
                        items: [
                            JarvisTabItem(tag: VaultTaskScope.work, title: copy.work),
                            JarvisTabItem(tag: VaultTaskScope.personal, title: copy.personal),
                        ],
                        selection: $scope
                    )
                } header: { Text(copy.scope) }
                Section {
                    JarvisSegmentedBar(
                        title: copy.priority,
                        identifierPrefix: "notes.create.priority",
                        items: [
                            JarvisTabItem(tag: VaultTask.Priority.normal, title: copy.priorityNormal),
                            JarvisTabItem(tag: VaultTask.Priority.medium, title: copy.priorityMedium),
                            JarvisTabItem(tag: VaultTask.Priority.high, title: copy.priorityHigh),
                        ],
                        selection: $priority
                    )
                } header: { Text(copy.priority) }
                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            }
            .onChange(of: dueTimeEnabled) { _, isEnabled in
                if isEnabled { dueDateEnabled = true }
            }
            .onChange(of: dueDateEnabled) { _, isEnabled in
                if !isEnabled { dueTimeEnabled = false }
            }
            .navigationTitle(copy.newTask)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: copy.create,
                    closeTitle: copy.cancel,
                    isWorking: saving,
                    isConfirmDisabled: !canCreate || saving || outcomeUnknown || authorizationUnavailable,
                    onConfirm: { Task { await create() } },
                    onClose: { dismiss() }
                )
            }
        }
    }

    private var canCreate: Bool {
        (2...400).contains(title.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count)
    }

    private func create() async {
        guard !saving, canCreate else { return }
        saving = true
        errorMessage = nil
        defer { saving = false }
        let date = dueDateEnabled ? dateString(dueDate) : nil
        let time = dueTimeEnabled ? timeString(dueTime) : nil
        do {
            _ = try await client.createTask(
                text: title,
                scope: scope,
                due: date,
                time: time,
                priority: priority
            )
            await JarvisAppCache.invalidateAll(.tasks)
            dismiss()
            onCreated()
        } catch let error as JarvisClientError {
            authorizationUnavailable = error == .signInRequired || error == .notOwner
            errorMessage = error == .signInRequired ? copy.signIn : error == .notOwner ? copy.notOwner : copy.unavailable
        } catch let error as JarvisNotesClientError {
            if case .writeOutcomeUnknown = error {
                outcomeUnknown = true
                errorMessage = copy.unknownWrite
            } else {
                errorMessage = copy.unavailable
            }
        } catch {
            errorMessage = copy.unavailable
        }
    }

    private func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func timeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
