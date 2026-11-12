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

    private var editedTitle: String {
        let originalTitle = JarvisTaskTitle.plain(task.text)
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title == originalTitle || trimmedTitle == originalTitle ? task.text : trimmedTitle
    }

    private var editedDueDate: String? {
        dueDateEnabled ? Self.dateString(dueDate) : nil
    }

    private var editedDueTime: String? {
        dueDateEnabled && dueTimeEnabled ? Self.timeString(dueTime) : nil
    }

    private var hasChanges: Bool {
        editedTitle != task.text || editedDueDate != task.dueDate
            || editedDueTime != task.dueTime || priority != task.priority
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section {
                    TextField(copy.titleField, text: $title, axis: .vertical)
                        .lineLimit(1...4)
                        .accessibilityIdentifier("notes.task.edit.title")
                }
                .disabled(saving)
                Section {
                    LabeledContent(copy.scope, value: task.scope == .work ? copy.work : copy.personal)
                    Toggle(copy.dueDateEnabled, isOn: $dueDateEnabled)
                        .onChange(of: dueDateEnabled) { _, enabled in
                            if !enabled { dueTimeEnabled = false }
                        }
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
                }
                .disabled(saving)
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
                if !task.done {
                    Section {
                        JarvisLabelledButton(title: copy.complete) {
                            dismiss()
                            onComplete()
                        }
                        .disabled(saving)
                    }
                }
            }
            .navigationTitle(copy.tasks)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    JarvisSheetConfirmButton(
                        title: copy.save,
                        isWorking: saving,
                        isDisabled: client == nil || saving || !canSave || !hasChanges || saveBlocked
                    ) {
                        Task { await save() }
                    }
                    .accessibilityHint(client == nil ? copy.unavailable : "")
                }
                .sharedBackgroundVisibility(.hidden)
            }
        }
        .interactiveDismissDisabled(saving)
        .accessibilityIdentifier("notes.task.detail")
    }

    private func save() async {
        guard !saving, !saveBlocked, canSave, hasChanges, let client else { return }
        saving = true
        errorMessage = nil
        defer { saving = false }
        do {
            _ = try await client.editTask(
                task,
                text: editedTitle,
                due: editedDueDate,
                time: editedDueTime,
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
