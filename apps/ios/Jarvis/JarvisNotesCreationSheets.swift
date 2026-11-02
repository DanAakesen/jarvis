import Foundation
import JarvisCore
import SwiftUI

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
                TextField(copy.folderField, text: $folder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
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
                ToolbarItem(placement: .cancellationAction) {
                    Button(copy.cancel) { dismiss() }
                        .accessibilityIdentifier("sheet.cancel")
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await create() }
                    } label: {
                        if saving { ProgressView() } else { Text(copy.create) }
                    }
                    .disabled(!canCreate || saving || outcomeUnknown || authorizationUnavailable)
                }
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
    @State private var scope: VaultTaskScope = .personal
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
                Picker(copy.scope, selection: $scope) {
                    Text(copy.personal).tag(VaultTaskScope.personal)
                    Text(copy.work).tag(VaultTaskScope.work)
                }
                .pickerStyle(.segmented)
                Toggle(copy.dueDateEnabled, isOn: $dueDateEnabled)
                if dueDateEnabled {
                    DatePicker(copy.dueDate, selection: $dueDate, displayedComponents: .date)
                }
                Toggle(copy.dueTimeEnabled, isOn: $dueTimeEnabled)
                if dueTimeEnabled {
                    DatePicker(copy.dueTime, selection: $dueTime, displayedComponents: .hourAndMinute)
                }
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
                ToolbarItem(placement: .cancellationAction) {
                    Button(copy.cancel) { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await create() }
                    } label: {
                        if saving { ProgressView() } else { Text(copy.create) }
                    }
                    .disabled(!canCreate || saving || outcomeUnknown || authorizationUnavailable)
                }
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
                time: time
            )
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
