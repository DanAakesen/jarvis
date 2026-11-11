import JarvisCore
import SwiftUI

struct JarvisTaskDetailSheet: View {
    let task: VaultTask
    let today: String
    let copy: JarvisNotesCopy
    let client: JarvisNotesClient?
    let onComplete: () -> Void
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var title: String
    @State private var dueDateEnabled: Bool
    @State private var dueTimeEnabled: Bool
    @State private var dueDate: Date
    @State private var dueTime: Date
    @State private var priority: VaultTask.Priority
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var saveBlocked = false

    init(
        task: VaultTask,
        today: String,
        copy: JarvisNotesCopy,
        client: JarvisNotesClient?,
        onComplete: @escaping () -> Void,
        onSaved: @escaping () -> Void
    ) {
        self.task = task
        self.today = today
        self.copy = copy
        self.client = client
        self.onComplete = onComplete
        self.onSaved = onSaved
        _title = State(initialValue: JarvisTaskTitle.plain(task.text))
        _dueDateEnabled = State(initialValue: task.dueDate != nil)
        _dueTimeEnabled = State(initialValue: task.dueTime != nil)
        _dueDate = State(initialValue: Self.date(task.dueDate) ?? .now)
        _dueTime = State(initialValue: Self.time(task.dueTime) ?? .now)
        _priority = State(initialValue: task.priority)
    }

    private var canSave: Bool {
        (1...400).contains(title.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count)
            && (!dueTimeEnabled || dueDateEnabled)
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section {
                    if editing {
                        TextField(copy.titleField, text: $title, axis: .vertical)
                            .lineLimit(1...4)
                            .accessibilityIdentifier("notes.task.edit.title")
                    } else {
                        Text(JarvisTaskTitle.formatted(task.text))
                            .font(.headline)
                    }
                }
                Section {
                    LabeledContent(copy.scope, value: task.scope == .work ? copy.work : copy.personal)
                    if editing {
                        Toggle(copy.dueDateEnabled, isOn: $dueDateEnabled)
                        if dueDateEnabled {
                            DatePicker(copy.dueDate, selection: $dueDate, displayedComponents: .date)
                        }
                        Toggle(copy.dueTimeEnabled, isOn: $dueTimeEnabled)
                            .disabled(!dueDateEnabled)
                        if dueTimeEnabled && dueDateEnabled {
                            DatePicker(copy.dueTime, selection: $dueTime, displayedComponents: .hourAndMinute)
                        }
                        JarvisSegmentedBar(
                            title: copy.priority,
                            identifierPrefix: "notes.task.edit.priority",
                            items: [
                                JarvisTabItem(tag: VaultTask.Priority.normal, title: copy.priorityNormal),
                                JarvisTabItem(tag: VaultTask.Priority.medium, title: copy.priorityMedium),
                                JarvisTabItem(tag: VaultTask.Priority.high, title: copy.priorityHigh),
                            ],
                            selection: $priority
                        )
                    } else {
                        if let due = task.dueDate {
                            LabeledContent(
                                copy.dueDate,
                                value: due == today ? copy.today : JarvisNotesLocalization.formattedDueDate(due, language: copy.language)
                            )
                        }
                        if let time = task.dueTime {
                            LabeledContent(
                                copy.dueTime,
                                value: JarvisNotesLocalization.formattedDueTime(time, language: copy.language)
                            )
                        }
                        Text(priorityText(task.priority))
                    }
                }
                Section {
                    Text(task.path)
                        .font(.footnote)
                        .accessibilityIdentifier("notes.task.source.path")
                    if let heading = task.heading, !heading.isEmpty {
                        Text(heading)
                            .font(.footnote)
                            .accessibilityIdentifier("notes.task.source.heading")
                    }
                } header: {
                    Text(copy.source).foregroundStyle(.primary)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.secondary)
                    }
                }
                if !task.done && !editing {
                    Section {
                        JarvisLabelledButton(title: copy.complete) {
                            dismiss()
                            onComplete()
                        }
                    }
                }
            }
            .navigationTitle(copy.tasks)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if editing {
                    JarvisSheetToolbar(
                        confirmTitle: copy.save,
                        closeTitle: copy.cancel,
                        isWorking: saving,
                        isConfirmDisabled: !canSave || saveBlocked,
                        onConfirm: { Task { await save() } },
                        onClose: cancelEditing
                    )
                } else {
                    ToolbarItem(placement: .topBarLeading) {
                        JarvisIconButton(
                            title: copy.edit,
                            systemImage: "pencil",
                            identifier: "notes.task.edit",
                            isDisabled: client == nil
                        ) {
                            editing = true
                        }
                    }
                    .sharedBackgroundVisibility(.hidden)
                    ToolbarItem(placement: .topBarTrailing) {
                        JarvisSheetCloseButton(title: copy.cancel) { dismiss() }
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
            }
        }
        .accessibilityIdentifier("notes.task.detail")
    }

    private func cancelEditing() {
        title = JarvisTaskTitle.plain(task.text)
        dueDateEnabled = task.dueDate != nil
        dueTimeEnabled = task.dueTime != nil
        dueDate = Self.date(task.dueDate) ?? .now
        dueTime = Self.time(task.dueTime) ?? .now
        priority = task.priority
        errorMessage = nil
        editing = false
    }

    private func save() async {
        guard !saving, !saveBlocked, canSave, let client else { return }
        saving = true
        errorMessage = nil
        defer { saving = false }
        do {
            let editedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await client.editTask(
                task,
                text: editedTitle == JarvisTaskTitle.plain(task.text) ? task.text : editedTitle,
                due: dueDateEnabled ? Self.dateString(dueDate) : nil,
                time: dueTimeEnabled && dueDateEnabled ? Self.timeString(dueTime) : nil,
                priority: priority
            )
            await JarvisAppCache.invalidateAll(.tasks)
            dismiss()
            onSaved()
        } catch let error as JarvisClientError {
            errorMessage = error == .signInRequired ? copy.signIn : error == .notOwner ? copy.notOwner : copy.unavailable
        } catch let error as JarvisNotesClientError {
            switch error {
            case .taskConflict:
                errorMessage = copy.taskChanged
                saveBlocked = true
            case .writeOutcomeUnknown:
                errorMessage = copy.unknownWrite
                saveBlocked = true
            default:
                errorMessage = copy.unavailable
            }
        } catch {
            errorMessage = copy.unavailable
        }
    }

    private func priorityText(_ value: VaultTask.Priority) -> String {
        switch value {
        case .high: copy.priorityHigh
        case .medium: copy.priorityMedium
        case .normal: copy.priorityNormal
        }
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: value)
    }

    private static func time(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter.date(from: value)
    }

    private static func dateString(_ value: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: value)
    }

    private static func timeString(_ value: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: value)
    }
}
