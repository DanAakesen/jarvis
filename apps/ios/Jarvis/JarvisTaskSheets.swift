import Foundation
import JarvisCore
import SwiftUI

enum JarvisTaskFormat {
    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = format
        return formatter
    }

    static func dateString(_ value: Date) -> String { formatter("yyyy-MM-dd").string(from: value) }
    static func timeString(_ value: Date) -> String { formatter("HH:mm").string(from: value) }
    static func date(_ value: String?) -> Date? { value.flatMap { formatter("yyyy-MM-dd").date(from: $0) } }
    static func time(_ value: String?) -> Date? { value.flatMap { formatter("HH:mm").date(from: $0) } }

    /// "Sun 15 Nov 2026" style day with the time when there is one; nil for a task without a date.
    static func due(date: String?, time: String?, today: String, language: JarvisAppLanguage) -> String? {
        let timeText = time.map { JarvisNotesLocalization.formattedDueTime($0, language: language) }
        guard let day = date else { return nil }
        if day == today { return timeText.map { "\(JarvisNotesLocalization.string(.today, language: language)) \($0)" } ?? JarvisNotesLocalization.string(.today, language: language) }
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.calendar = Calendar(identifier: .gregorian)
        input.timeZone = TimeZone(secondsFromGMT: 0)
        input.dateFormat = "yyyy-MM-dd"
        let text: String
        if let parsed = input.date(from: day) {
            let output = DateFormatter()
            output.locale = language.locale
            output.calendar = input.calendar
            output.timeZone = input.timeZone
            output.setLocalizedDateFormatFromTemplate(day.prefix(4) == today.prefix(4) ? "EEE d MMM" : "EEE d MMM yyyy")
            text = output.string(from: parsed)
        } else {
            text = day
        }
        return [text, timeText].compactMap { $0 }.joined(separator: ", ")
    }

    static func priority(_ value: VaultTask.Priority, copy: JarvisNotesCopy) -> String {
        switch value {
        case .high: copy.priorityHigh
        case .medium: copy.priorityMedium
        case .normal: copy.priorityNormal
        }
    }

    static func scope(_ value: VaultTaskScope, copy: JarvisNotesCopy) -> String {
        value == .work ? copy.work : copy.personal
    }

    static func sourceName(_ task: VaultTask) -> String { JarvisNoteTitle.fileTitle(path: task.path) }
}

/// A task row for the Tasks page and search: the open circle completes, the rest opens the task.
struct JarvisTaskRowContent: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let task: VaultTask
    let copy: JarvisNotesCopy
    let today: String
    var isPinned = false
    var isBusy = false
    let onComplete: () -> Void

    private var due: String? { JarvisTaskFormat.due(date: task.dueDate, time: task.dueTime, today: today, language: copy.language) }
    private var overdue: Bool { task.dueDate.map { $0 < today } ?? false }

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            JarvisTaskRing(
                title: task.done ? copy.completed : copy.complete, isDone: task.done, isBusy: isBusy,
                identifier: "notes.task.ring.\(task.id)", action: task.done ? nil : onComplete
            )
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                Text(JarvisTaskTitle.formatted(task.text))
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                if dynamicTypeSize.isAccessibilitySize {
                    source
                    dueLabel
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        source
                        Spacer(minLength: 8)
                        dueLabel
                    }
                }
                if task.priority != .normal {
                    Label(JarvisTaskFormat.priority(task.priority, copy: copy), systemImage: "flag")
                        .font(.footnote)
                        .foregroundStyle(task.priority == .high ? Color.red : JarvisDesignTokens.primaryAccent)
                }
            }
            .padding(.vertical, 10)
            if isPinned {
                Image(systemName: "pin.fill").foregroundStyle(.secondary).accessibilityHidden(true)
            }
        }
        .padding(.leading, 4)
        .padding(.trailing, JarvisPageHeaderMetrics.rowInset)
        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var source: some View {
        Label(JarvisTaskFormat.sourceName(task), systemImage: "doc.text")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }

    @ViewBuilder
    private var dueLabel: some View {
        if let due {
            Text(due)
                .font(.footnote)
                .foregroundStyle(overdue ? Color.red : Color.secondary)
        }
    }
}

/// Task detail: one completion circle, title, source note, date, priority, scope and any task notes. Completing or
/// reopening is separate from editing and deleting, and a failure shows beside the circle it belongs to.
struct JarvisTaskDetailSheet: View {
    let today: String
    let copy: JarvisNotesCopy
    let client: JarvisNotesClient?
    let onOpenSource: ((String) -> Void)?
    let onChanged: () -> Void
    let onClose: () -> Void

    @State private var task: VaultTask
    @State private var completing = false
    @State private var deleting = false
    @State private var error: String?
    @State private var editing = false
    @State private var deletePresented = false

    init(
        task: VaultTask, today: String, copy: JarvisNotesCopy, client: JarvisNotesClient?,
        onOpenSource: ((String) -> Void)?, onChanged: @escaping () -> Void, onClose: @escaping () -> Void
    ) {
        self.today = today
        self.copy = copy
        self.client = client
        self.onOpenSource = onOpenSource
        self.onChanged = onChanged
        self.onClose = onClose
        _task = State(initialValue: task)
    }

    private var busy: Bool { completing || deleting }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(copy[.taskTitle]).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisMenuButton(title: copy[.more], systemImage: "ellipsis", identifier: "task.more", isDisabled: busy || client == nil) {
                    Button(role: .destructive) { deletePresented = true } label: {
                        Label(copy[.deleteTask], systemImage: "trash")
                    }
                }
                JarvisSheetCloseButton(title: copy[.close], isDisabled: busy, action: onClose)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                    HStack(alignment: .top, spacing: 4) {
                        JarvisTaskRing(
                            title: task.done ? copy[.reopen] : copy.complete, isDone: task.done, isBusy: completing,
                            isDisabled: client == nil || deleting, diameter: 30, identifier: "task.ring"
                        ) { Task { await toggleDone() } }
                        Text(JarvisTaskTitle.formatted(task.text))
                            .font(.title2)
                            .padding(.top, 6)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("task.title")
                    }
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("task.error")
                    }
                    JarvisRowGroup {
                        JarvisDetailRow(
                            title: copy[.sourceNote],
                            subtitle: [JarvisTaskFormat.sourceName(task), JarvisNoteTitle.location(path: task.path)]
                                .filter { !$0.isEmpty }.joined(separator: "\n"),
                            systemImage: "doc.text", identifier: "task.source",
                            action: onOpenSource.map { open in { open(task.path) } }
                        )
                        Divider().padding(.leading, JarvisPageHeaderMetrics.rowInset)
                        JarvisDetailRow(
                            title: copy.dueDate,
                            value: JarvisTaskFormat.due(date: task.dueDate, time: task.dueTime, today: today, language: copy.language) ?? copy.noDate,
                            systemImage: "calendar", identifier: "task.due"
                        )
                        Divider().padding(.leading, JarvisPageHeaderMetrics.rowInset)
                        JarvisDetailRow(
                            title: copy.priority, value: JarvisTaskFormat.priority(task.priority, copy: copy),
                            systemImage: "flag", identifier: "task.priority"
                        )
                        Divider().padding(.leading, JarvisPageHeaderMetrics.rowInset)
                        JarvisDetailRow(
                            title: copy.scope, value: JarvisTaskFormat.scope(task.scope, copy: copy),
                            systemImage: "folder", identifier: "task.scope"
                        )
                    }
                    if let notes = task.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.body)
                            .padding(JarvisDesignTokens.notesSectionSpacing)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
                            .accessibilityIdentifier("task.notes")
                    }
                }
            }
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                JarvisLabelledButton(title: copy[.close], identifier: "task.close", isDisabled: busy, isFullWidth: true, action: onClose)
                JarvisLabelledButton(
                    title: copy.edit, identifier: "task.edit", isDisabled: busy || client == nil || task.done,
                    isFullWidth: true, isEmphasised: true
                ) { editing = true }
            }
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(busy)
        .accessibilityIdentifier("task.detail")
        .sheet(isPresented: $editing) {
            if let client {
                JarvisTaskEditorSheet(client: client, copy: copy, mode: .edit(task)) {
                    onChanged()
                    onClose()
                }
            }
        }
        .confirmationDialog(copy[.deleteTaskTitle], isPresented: $deletePresented, titleVisibility: .visible) {
            Button(copy[.deleteTask], role: .destructive) { Task { await delete() } }
            Button(copy.cancel, role: .cancel) {}
        } message: {
            Text(copy[.deleteTaskMessage])
        }
    }

    @MainActor
    private func toggleDone() async {
        guard let client, !busy else { return }
        completing = true
        error = nil
        defer { completing = false }
        do {
            let write = try await client.setTaskDone(task, done: !task.done)
            task = VaultTask(
                id: task.id, text: task.text, done: write.done, dueDate: task.dueDate, dueTime: task.dueTime,
                dueAt: task.dueAt, priority: task.priority, path: task.path, line: task.line, heading: task.heading,
                version: write.version, notes: task.notes, timeZone: task.timeZone, remindAtDue: task.remindAtDue
            )
            await JarvisAppCache.invalidateAll(.tasks)
            onChanged()
        } catch {
            self.error = Self.message(error, copy: copy, fallback: copy[.taskCompleteFailed])
        }
    }

    @MainActor
    private func delete() async {
        guard let client, !busy else { return }
        deleting = true
        error = nil
        defer { deleting = false }
        do {
            try await client.deleteTask(task)
            await JarvisAppCache.invalidateAll(.tasks)
            onChanged()
            onClose()
        } catch {
            self.error = Self.message(error, copy: copy, fallback: copy[.deleteFailed])
        }
    }

    static func message(_ error: Error, copy: JarvisNotesCopy, fallback: String) -> String {
        if let error = error as? JarvisNotesClientError {
            switch error {
            case .taskConflict: return copy[.deleteChanged]
            case .writeOutcomeUnknown: return copy.unknownWrite
            default: return fallback
            }
        }
        if let error = error as? JarvisClientError {
            switch error {
            case .signInRequired: return copy.signIn
            case .notOwner: return copy.notOwner
            default: return fallback
            }
        }
        return fallback
    }
}

/// New task and Edit task share this editor: a focused title, the scope or source, and compact date and priority
/// controls whose sheets return to the same draft.
struct JarvisTaskEditorSheet: View {
    enum Mode: Equatable {
        case create(scope: VaultTaskScope)
        case edit(VaultTask)
    }

    private enum Problem: Equatable {
        case changed, unknown, failed(String)
    }

    let client: JarvisNotesClient
    let copy: JarvisNotesCopy
    let mode: Mode
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleFocused: Bool
    @State private var title: String
    @State private var scope: VaultTaskScope
    @State private var priority: VaultTask.Priority
    @State private var dueDateEnabled: Bool
    @State private var dueTimeEnabled: Bool
    @State private var dueDate: Date
    @State private var dueTime: Date
    @State private var saving = false
    @State private var problem: Problem?
    @State private var scheduleOpen = false
    @State private var optionsOpen = false
    @State private var discardPresented = false

    init(client: JarvisNotesClient, copy: JarvisNotesCopy, mode: Mode, onSaved: @escaping () -> Void) {
        self.client = client
        self.copy = copy
        self.mode = mode
        self.onSaved = onSaved
        switch mode {
        case let .create(scope):
            _title = State(initialValue: "")
            _scope = State(initialValue: scope)
            _priority = State(initialValue: .normal)
            _dueDateEnabled = State(initialValue: false)
            _dueTimeEnabled = State(initialValue: false)
            _dueDate = State(initialValue: Date())
            _dueTime = State(initialValue: Date())
        case let .edit(task):
            _title = State(initialValue: JarvisTaskTitle.plain(task.text))
            _scope = State(initialValue: task.scope)
            _priority = State(initialValue: task.priority)
            _dueDateEnabled = State(initialValue: task.dueDate != nil)
            _dueTimeEnabled = State(initialValue: task.dueTime != nil)
            _dueDate = State(initialValue: JarvisTaskFormat.date(task.dueDate) ?? Date())
            _dueTime = State(initialValue: JarvisTaskFormat.time(task.dueTime) ?? Date())
        }
    }

    private var existing: VaultTask? {
        if case let .edit(task) = mode { return task }
        return nil
    }

    private var trimmed: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var minimumLength: Int { existing == nil ? 2 : 1 }
    private var validTitle: Bool { (minimumLength...400).contains(trimmed.unicodeScalars.count) }

    private var editedTitle: String {
        guard let existing else { return trimmed }
        let original = JarvisTaskTitle.plain(existing.text)
        return title == original || trimmed == original ? existing.text : trimmed
    }

    private var editedDue: String? { dueDateEnabled ? JarvisTaskFormat.dateString(dueDate) : nil }
    private var editedTime: String? { dueDateEnabled && dueTimeEnabled ? JarvisTaskFormat.timeString(dueTime) : nil }

    private var isDirty: Bool {
        guard let existing else { return !trimmed.isEmpty || dueDateEnabled || priority != .normal }
        return editedTitle != existing.text || editedDue != existing.dueDate
            || editedTime != existing.dueTime || priority != existing.priority
    }

    private var blockedReason: String? {
        if problem == .changed || problem == .unknown { return copy.taskChanged }
        if !validTitle { return copy[.saveNeedsTitle] }
        if existing != nil, !isDirty { return copy[.saveNothingChanged] }
        return nil
    }

    private var dateChip: String {
        dueDateEnabled
            ? JarvisTaskFormat.due(date: editedDue, time: editedTime, today: "", language: copy.language) ?? copy[.addDate]
            : copy[.addDate]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(existing == nil ? copy.newTask : copy[.editTask]).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy.cancel, isDisabled: saving) { cancel() }
            }
            TextField(copy.titleField, text: $title, axis: .vertical)
                .font(.title3)
                .lineLimit(1...4)
                .focused($titleFocused)
                .submitLabel(.done)
                .disabled(saving)
                .padding(JarvisDesignTokens.notesSectionSpacing)
                .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
                .accessibilityIdentifier("taskeditor.title")
            JarvisRowGroup {
                if let existing {
                    JarvisDetailRow(
                        title: JarvisTaskFormat.sourceName(existing),
                        subtitle: JarvisNoteTitle.location(path: existing.path), systemImage: "doc.text",
                        identifier: "taskeditor.source"
                    )
                    Divider().padding(.leading, JarvisPageHeaderMetrics.rowInset)
                    JarvisDetailRow(
                        title: copy.scope, value: JarvisTaskFormat.scope(scope, copy: copy), systemImage: "folder",
                        identifier: "taskeditor.scope"
                    )
                } else {
                    JarvisDetailRow(
                        title: copy.scope, value: JarvisTaskFormat.scope(scope, copy: copy), systemImage: "folder",
                        identifier: "taskeditor.scope", isDisabled: saving, action: { optionsOpen = true }
                    )
                }
            }
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                JarvisLabelledButton(
                    title: dateChip, systemImage: "calendar", trailingSystemImage: "chevron.right",
                    identifier: "taskeditor.date", isDisabled: saving, isEmphasised: dueDateEnabled
                ) { titleFocused = false; scheduleOpen = true }
                JarvisLabelledButton(
                    title: JarvisTaskFormat.priority(priority, copy: copy), systemImage: "flag",
                    trailingSystemImage: "chevron.right", identifier: "taskeditor.priority", isDisabled: saving
                ) { titleFocused = false; optionsOpen = true }
            }
            if let blockedReason {
                Text(blockedReason).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("taskeditor.blocked")
            }
            if let problem { banner(problem) }
            Spacer(minLength: 0)
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            JarvisEditorAccessory(
                cancelTitle: copy.cancel, saveTitle: copy.save, isSaveDisabled: blockedReason != nil, isSaving: saving,
                isCancelDisabled: saving, saveHint: blockedReason ?? "",
                onCancel: cancel, onSave: { Task { await save() } }
            ) { EmptyView() }
        }
        .jarvisAmbientBackground()
        .presentationDetents([.large])
        .interactiveDismissDisabled(isDirty || saving)
        .confirmationDialog(copy.discardTitle, isPresented: $discardPresented, titleVisibility: .visible) {
            Button(copy.discard, role: .destructive) { dismiss() }
            Button(copy[.keepEditing], role: .cancel) {}
        }
        .sheet(isPresented: $scheduleOpen) {
            JarvisTaskScheduleSheet(
                copy: copy, priority: priority, dateEnabled: $dueDateEnabled, date: $dueDate,
                timeEnabled: $dueTimeEnabled, time: $dueTime, onDone: { scheduleOpen = false }
            )
        }
        .sheet(isPresented: $optionsOpen) {
            JarvisTaskOptionsSheet(
                copy: copy, scopeEditable: existing == nil, scope: $scope, priority: $priority, onDone: { optionsOpen = false }
            )
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            titleFocused = true
        }
        .accessibilityIdentifier("taskeditor.sheet")
    }

    @ViewBuilder
    private func banner(_ current: Problem) -> some View {
        switch current {
        // A changed or unconfirmed write blocks Save for good: sending it again could duplicate a task that
        // already landed, so the owner cancels, refreshes and checks the list first.
        case .changed:
            JarvisInlineBanner(message: copy.taskChanged, identifier: "taskeditor.failure") { EmptyView() }
        case .unknown:
            JarvisInlineBanner(message: copy.unknownWrite, identifier: "taskeditor.failure") { EmptyView() }
        case let .failed(message):
            JarvisInlineBanner(message: message, identifier: "taskeditor.failure") {
                JarvisLabelledButton(title: copy[.continueEditing], isCompact: true) { problem = nil }
                JarvisLabelledButton(title: copy.retry, identifier: "taskeditor.retry", isEmphasised: true, isCompact: true) {
                    Task { await save() }
                }
            }
        }
    }

    private func cancel() {
        guard !saving else { return }
        if isDirty { discardPresented = true } else { dismiss() }
    }

    @MainActor
    private func save() async {
        guard !saving, validTitle, problem != .changed, problem != .unknown else { return }
        saving = true
        problem = nil
        titleFocused = false
        defer { saving = false }
        do {
            if let existing {
                _ = try await client.editTask(existing, text: editedTitle, due: editedDue, time: editedTime, priority: priority)
            } else {
                _ = try await client.createTask(text: editedTitle, scope: scope, due: editedDue, time: editedTime, priority: priority)
            }
            await JarvisAppCache.invalidateAll(.tasks)
            onSaved()
            dismiss()
        } catch {
            guard !Task.isCancelled else { return }
            if let error = error as? JarvisNotesClientError {
                switch error {
                case .taskConflict: problem = .changed
                case .writeOutcomeUnknown: problem = .unknown
                default: problem = .failed(copy[.saveFailed])
                }
            } else {
                problem = .failed(JarvisTaskDetailSheet.message(error, copy: copy, fallback: copy[.saveFailed]))
            }
        }
    }
}

/// Date & time: a native date selector, an optional time and a clear Remove date action. The reminder line only
/// appears where the backend really sends one: high priority tasks with a time.
struct JarvisTaskScheduleSheet: View {
    let copy: JarvisNotesCopy
    let priority: VaultTask.Priority
    @Binding var dateEnabled: Bool
    @Binding var date: Date
    @Binding var timeEnabled: Bool
    @Binding var time: Date
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(copy[.dateAndTime]).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy.done, action: onDone)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                    DatePicker(copy.dueDate, selection: Binding(get: { date }, set: { date = $0; dateEnabled = true }), displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .accessibilityIdentifier("schedule.date")
                    Toggle(copy[.time], isOn: Binding(get: { timeEnabled }, set: { timeEnabled = $0; if $0 { dateEnabled = true } }))
                        .accessibilityIdentifier("schedule.timeToggle")
                    if timeEnabled {
                        DatePicker(copy.dueTime, selection: $time, displayedComponents: .hourAndMinute)
                            .datePickerStyle(.wheel)
                            .labelsHidden()
                            .accessibilityLabel(copy.dueTime)
                    }
                    if timeEnabled && priority == .high {
                        JarvisRowGroup {
                            JarvisDetailRow(
                                title: copy[.reminderAuto], subtitle: copy[.reminderAutoHint], systemImage: "bell",
                                identifier: "schedule.reminder"
                            )
                        }
                    }
                }
            }
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                JarvisLabelledButton(
                    title: copy[.removeDate], identifier: "schedule.remove", isDisabled: !dateEnabled, isFullWidth: true
                ) {
                    dateEnabled = false
                    timeEnabled = false
                    onDone()
                }
                JarvisLabelledButton(title: copy.done, identifier: "schedule.done", isFullWidth: true, isEmphasised: true) {
                    dateEnabled = true
                    onDone()
                }
            }
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("schedule.sheet")
    }
}

/// Task options: scope (explicit for a new task, set by the source note for an existing one) and priority by name.
struct JarvisTaskOptionsSheet: View {
    let copy: JarvisNotesCopy
    let scopeEditable: Bool
    @Binding var scope: VaultTaskScope
    @Binding var priority: VaultTask.Priority
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(copy[.taskOptions]).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy.done, action: onDone)
            }
            Text(copy.scope).font(.headline).accessibilityAddTraits(.isHeader)
            JarvisRowGroup {
                JarvisChoiceRow(
                    title: copy.work, systemImage: "briefcase", isSelected: scope == .work, isDisabled: !scopeEditable,
                    identifier: "options.scope.work"
                ) { scope = .work }
                Divider().padding(.leading, JarvisPageHeaderMetrics.rowInset)
                JarvisChoiceRow(
                    title: copy.personal, systemImage: "person", isSelected: scope == .personal, isDisabled: !scopeEditable,
                    identifier: "options.scope.personal"
                ) { scope = .personal }
            }
            if !scopeEditable {
                Text(copy[.scopeFromSource]).font(.footnote).foregroundStyle(.secondary)
            }
            Text(copy.priority).font(.headline).accessibilityAddTraits(.isHeader)
            JarvisRowGroup {
                JarvisChoiceRow(title: copy.priorityNormal, isSelected: priority == .normal, identifier: "options.priority.normal") { priority = .normal }
                Divider().padding(.leading, JarvisPageHeaderMetrics.rowInset)
                JarvisChoiceRow(title: copy.priorityMedium, systemImage: "flag", isSelected: priority == .medium, identifier: "options.priority.medium") { priority = .medium }
                Divider().padding(.leading, JarvisPageHeaderMetrics.rowInset)
                JarvisChoiceRow(title: copy.priorityHigh, systemImage: "flag.fill", isSelected: priority == .high, identifier: "options.priority.high") { priority = .high }
            }
            Spacer(minLength: 0)
            JarvisLabelledButton(title: copy.done, identifier: "options.done", isFullWidth: true, isEmphasised: true, action: onDone)
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("options.sheet")
    }
}
