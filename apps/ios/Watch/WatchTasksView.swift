import Foundation
import JarvisCore
import SwiftUI

struct WatchTasksView: View {
    private enum Tab: Hashable { case today, upcoming }
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = Tab.today
    @State private var tasks: [VaultTask] = []
    @State private var loading = true
    @State private var failure: String?
    @State private var showCreate = false
    @State private var previewDetail: VaultTask?
    @State private var readID = UUID()
    @State private var taskDay: String?
    @State private var taskPages = WatchTaskPageCollection()
    @State private var hasMore = false
    private var groups: JarvisTodayTaskLists {
        .init(tasks: tasks, today: taskDay ?? JarvisTodayTaskLists.dayKey(Date()))
    }
    private var visible: [VaultTask] { tab == .today ? groups.today : groups.upcoming }

    var body: some View {
        List {
            HStack {
                WatchChoiceBar(choices: [(.today, "Today"), (.upcoming, "Upcoming")], selection: $tab)
                WatchAddButton(title: "New task") { showCreate = true }
            }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            if loading { ProgressView("Loading tasks").listRowBackground(Color.clear) }
            if let failure {
                VStack(alignment: .leading, spacing: 8) {
                    Text(failure).font(.footnote)
                    Button("Retry") { Task { await load() } }
                }.listRowBackground(Color.clear)
            }
            if !loading && failure == nil && visible.isEmpty && !hasMore {
                Text(tab == .today ? "No open tasks due today" : "No upcoming tasks")
                    .foregroundStyle(.secondary).listRowBackground(Color.clear)
            }
            ForEach(visible) { task in
                NavigationLink {
                    WatchTaskDetailView(task: task, today: taskDay) { changed in
                        replace(changed)
                        Task { await load(); await connection.refresh() }
                    }
                } label: { WatchPersonalTaskRow(task: task, today: taskDay) }
                    .listRowBackground(Color.clear)
            }
            if hasMore {
                if visible.isEmpty {
                    Text("More tasks are available. Load more to continue.")
                        .font(.footnote).foregroundStyle(.secondary).listRowBackground(Color.clear)
                }
                Button("Load more tasks") { Task { await load(more: true) } }.disabled(loading)
            }
        }
        .navigationTitle(tab == .today ? "Today" : "Upcoming")
        .task(id: connection.reachable) { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .refreshable { await load() }
        .sheet(isPresented: $showCreate) {
            NavigationStack {
                WatchPersonalTaskEditor { task in
                    replace(task)
                    Task { await load(); await connection.refresh() }
                }
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { previewDetail != nil }, set: { if !$0 { previewDetail = nil } }
        )) {
            if let task = previewDetail { WatchTaskDetailView(task: task, today: taskDay) { replace($0) } }
        }
    }

    private func replace(_ task: VaultTask) {
        tasks.removeAll { $0.id == task.id }
        if !task.done { tasks.append(task) }
    }
    private func load(more: Bool = false) async {
        let read = UUID(); readID = read
        loading = true; failure = nil
        defer { if read == readID { loading = false } }
        guard connection.reachable else {
            failure = WatchFailure.unavailable.message
            return
        }
        do {
            let result = try await WatchPersonalTaskRead.load(connection, starting: more ? taskPages : .init())
            guard read == readID, !Task.isCancelled else { return }
            tasks = result.tasks.filter { !$0.done }
            taskPages = result; hasMore = result.nextOffset != nil
            if let date = result.dayStart, let zone = result.timeZoneID.flatMap(TimeZone.init(identifier:)) {
                var calendar = Calendar.current; calendar.timeZone = zone
                taskDay = JarvisTodayTaskLists.dayKey(date, calendar: calendar)
            }
            #if DEBUG
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("--watch-screen=personal-new-task") ||
                arguments.contains("--watch-screen=task-auto") || arguments.contains("--watch-screen=task-manual") {
                showCreate = true
            }
            if arguments.contains("--watch-screen=task-detail") || arguments.contains("--watch-screen=task-edit") {
                previewDetail = tasks.first
            }
            WatchPreview.captureReady("tasks")
            #endif
        } catch {
            guard read == readID, !Task.isCancelled else { return }
            failure = (error as? WatchFailure)?.message ?? "Tasks could not refresh. Try again on your iPhone."
        }
    }
}

struct WatchPersonalTaskRow: View {
    let task: VaultTask
    var today: String? = nil
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: task.done ? "checkmark.square" : "square")
                .foregroundStyle(WatchStyle.amber).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(task.text).font(.system(.body, design: .rounded, weight: .semibold)).lineLimit(2)
                Text(WatchTaskPresentation.due(task, today: today)).font(.caption).foregroundStyle(WatchStyle.stone)
            }
        }.padding(.vertical, 4)
            .accessibilityElement(children: .combine)
    }
}

struct WatchTaskDetailView: View {
    @State var task: VaultTask
    var today: String? = nil
    var saved: (VaultTask) -> Void
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.dismiss) private var dismiss
    @State private var showEdit = false
    @State private var busy = false
    @State private var failure: String?
    @State private var needsRefresh = false

    var body: some View {
        List {
            HStack {
                Spacer(minLength: 0)
                Button("Edit") { showEdit = true }
                    .buttonStyle(.plain).foregroundStyle(WatchStyle.amber)
                    .frame(minHeight: 40).disabled(busy || needsRefresh)
            }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            Text(task.text).font(.system(.title3, design: .rounded, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true).listRowBackground(Color.clear)
            LabeledContent("Due", value: WatchTaskPresentation.due(task, today: today)).listRowBackground(Color.clear)
            LabeledContent("Priority", value: task.priority.watchLabel).listRowBackground(Color.clear)
            LabeledContent("List", value: task.scope == .personal ? "Personal" : "Work").listRowBackground(Color.clear)
            if let heading = task.heading, !heading.isEmpty {
                LabeledContent("Heading", value: heading).listRowBackground(Color.clear)
            }
            if let notes = task.notes, !notes.isEmpty {
                Text(notes).fixedSize(horizontal: false, vertical: true).listRowBackground(Color.clear)
            }
            LabeledContent("Status", value: task.done ? "Completed" : "Open").listRowBackground(Color.clear)
            if let reminder = task.watchReminderLabel {
                LabeledContent("Reminder", value: reminder).listRowBackground(Color.clear)
            }
            if let timeZone = task.timeZone {
                LabeledContent("Time zone", value: timeZone).listRowBackground(Color.clear)
            }
            NavigationLink("Vault source") {
                List {
                    sourceField("Path", task.path)
                    sourceField("Line", String(task.line))
                    if let dueAt = task.dueAt { sourceField("Due instant", dueAt) }
                    sourceField("Task ID", task.id)
                    sourceField("Version", task.version)
                }.navigationTitle("Vault source")
            }.listRowBackground(Color.clear)
            if let failure {
                Text(failure).font(.footnote).listRowBackground(Color.clear)
                if needsRefresh {
                    Button("Refresh task") { Task { await refreshTask() } }.disabled(busy || !connection.reachable)
                }
            }
            if !connection.reachable {
                Text(WatchFailure.unavailable.message).font(.footnote).listRowBackground(Color.clear)
            }
            Button { Task { await complete() } } label: {
                Label(busy ? "Saving…" : task.done ? "Completed" : "Mark complete",
                      systemImage: task.done ? "checkmark.square" : "square")
            }.foregroundStyle(WatchStyle.amber)
                .disabled(busy || task.done || needsRefresh || !connection.reachable)
                .listRowBackground(Color.clear)
        }.navigationTitle("Task")
        .sheet(isPresented: $showEdit) {
            NavigationStack {
                WatchPersonalTaskEditor(task: task) { changed in task = changed; saved(changed) }
            }
        }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
                if ProcessInfo.processInfo.arguments.contains("--watch-screen=task-edit") {
                    showEdit = true
                }
                if ProcessInfo.processInfo.arguments.contains("--watch-screen=task-detail") {
                    WatchPreview.captureReady("task-detail")
                }
            }
            #endif
        }
    }

    private func sourceField(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.footnote).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func refreshTask() async {
        guard !busy, connection.reachable else { return }
        busy = true; defer { busy = false }
        do {
            guard let fresh = try await WatchPersonalTaskRead.task(task.id, connection: connection) else {
                failure = "This task is no longer in the open list. Return to Tasks to see the latest."
                return
            }
            task = fresh; failure = nil; needsRefresh = false
        } catch { failure = "The task could not refresh. \(WatchTaskPresentation.failure(error))" }
    }
    private func complete() async {
        guard !busy, !needsRefresh, !task.done, connection.reachable else { return }
        busy = true; failure = nil; defer { busy = false }
        do {
            let reply = try await connection.request(.init(action: .completeWatchTask,
                itemID: task.id, data: WatchCodec.encode(task), flag: true))
            if let detail = reply.taskError { throw detail }
            guard let data = reply.data,
                  let write = try? JSONDecoder().decode(VaultTaskWrite.self, from: data),
                  write.id == task.id, write.path == task.path, write.line == task.line,
                  write.done else { throw WatchTaskMutationFailure.unknown }
            saved(VaultTask(id: task.id, text: task.text, done: true,
                dueDate: task.dueDate, dueTime: task.dueTime, dueAt: task.dueAt,
                priority: task.priority, path: task.path, line: task.line, heading: task.heading,
                version: write.version, notes: task.notes, timeZone: task.timeZone, remindAtDue: task.remindAtDue))
            dismiss()
        } catch {
            failure = WatchTaskPresentation.failure(error)
            needsRefresh = true
        }
    }
}

struct WatchPersonalTaskEditor: View {
    let task: VaultTask?
    var saved: (VaultTask) -> Void
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.dismiss) private var dismiss
    @State private var draft = WatchTaskDraft()
    @State private var submissions = WatchTaskSubmissionState()
    @State private var update: WatchTaskUpdateRequest?
    @State private var source: VaultTask?
    @State private var refreshedSource: VaultTask?
    @State private var reapplying = false
    @State private var busy = false
    @State private var failure: String?
    @State private var requiresRefresh = false
    @State private var selectedDue = Date().addingTimeInterval(3_600)
    @State private var customDue = false
    @State private var includeTime = true
    @State private var remindAtDue = false
    @State private var store: WatchTaskDraftStore?
    @State private var storagePrepared = false
    @State private var storageAvailable = false
    @State private var storageFailure: String?
    @State private var savedResult: VaultTask?
    private var locked: Bool {
        busy || !storageAvailable || submissions.request != nil || update != nil
    }
    private var editingTimeZone: TimeZone {
        source?.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
    }
    private var validationMessage: String? {
        if task != nil, remindAtDue,
           draft.fields.due == nil || draft.fields.time == nil || draft.fields.priority != .high {
            return "A due-time reminder needs a date, time and High priority. Change those fields or turn the reminder off."
        }
        return draft.validationMessage
    }

    init(task: VaultTask? = nil, saved: @escaping (VaultTask) -> Void) {
        self.task = task; self.saved = saved
        _source = State(initialValue: task)
        if let task {
            var value = WatchTaskDraft(); value.mode = .manual
            value.fields = .init(text: task.text, scope: task.scope, due: task.dueDate,
                                 time: task.dueTime, priority: task.priority, notes: task.notes ?? "")
            _draft = State(initialValue: value)
            _customDue = State(initialValue: task.dueDate != nil)
            _includeTime = State(initialValue: task.dueTime != nil)
            _remindAtDue = State(initialValue: task.remindAtDue == true)
            if let date = WatchTaskPresentation.date(task) { _selectedDue = State(initialValue: date) }
        }
    }

    var body: some View {
        Form {
            if let savedResult {
                Label(task == nil ? "Task saved" : "Changes saved", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(WatchStyle.amber)
                Text(savedResult.text).fixedSize(horizontal: false, vertical: true)
                Button(task == nil ? "Create another task" : "Done") {
                    if task == nil { startAnother() }
                    else { saved(savedResult); dismiss() }
                }.disabled(!storageAvailable)
            } else {
                if task == nil {
                    WatchChoiceBar(
                        choices: [(.auto, "Auto"), (.manual, "Manual")], selection: modeBinding
                    )
                    .disabled(locked).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
                if task == nil && draft.mode == .auto {
                    WatchTextInput(title: "Describe your task…", text: inputBinding, multiline: true)
                        .disabled(locked)
                    Text("English or Danish. Missing due date/time defaults to one hour after Save; priority defaults to Low.")
                        .font(.caption).foregroundStyle(.secondary).listRowBackground(Color.clear)
                } else {
                    manualFields
                }
                if !connection.reachable {
                    Text(WatchFailure.unavailable.message).font(.footnote).listRowBackground(Color.clear)
                }
                if let failure {
                    Text(failure).font(.footnote).listRowBackground(Color.clear)
                    if submissions.canRevise {
                        Button("Edit draft") { reviseRejectedCreate() }
                    }
                    if requiresRefresh {
                        Button("Refresh task") { Task { await refreshSource() } }
                            .disabled(busy || !storageAvailable || !connection.reachable)
                    }
                }
                if let refreshedSource {
                    NavigationLink("Current saved task") {
                        List {
                            Text(refreshedSource.text).fixedSize(horizontal: false, vertical: true)
                            LabeledContent("Due", value: WatchTaskPresentation.due(refreshedSource))
                            LabeledContent("Priority", value: refreshedSource.priority.watchLabel)
                            if let notes = refreshedSource.notes, !notes.isEmpty {
                                Text(notes).fixedSize(horizontal: false, vertical: true)
                            }
                            LabeledContent("Reminder", value: refreshedSource.watchReminderLabel ?? "Not recorded")
                        }.navigationTitle("Current saved task")
                    }
                }
                if let validation = validationMessage, hasEnteredContent, !locked {
                    Text(validation).font(.caption).listRowBackground(Color.clear)
                }
                if submissions.request != nil && !submissions.canRevise {
                    Text("Retry keeps the original task, submission time and time zone. Check Tasks before starting another task.")
                        .font(.caption).foregroundStyle(.secondary).listRowBackground(Color.clear)
                }
                Button(busy ? "Saving…" : reapplying ? "Save my edits" :
                        submissions.request != nil || update != nil ? "Retry save" : "Save") {
                    Task { await save() }
                }
                .tint(WatchStyle.amber)
                .disabled(busy || !storageAvailable || requiresRefresh ||
                          !connection.reachable || validationMessage != nil)
                if requiresRefresh {
                    Text("Refresh the saved task before trying again. Your entered details are kept.")
                        .font(.caption).listRowBackground(Color.clear)
                }
            }
            if let storageFailure {
                Text(storageFailure).font(.footnote).listRowBackground(Color.clear)
            }
        }.navigationTitle(task == nil ? "New task" : "Edit task")
            .interactiveDismissDisabled(busy)
            .task {
                prepareStorage()
            }
    }

    @ViewBuilder private var manualFields: some View {
        WatchTextInput(title: "Title", text: fieldTextBinding).disabled(locked)
        Toggle(task == nil ? "Choose due date" : "Due date", isOn: customDueBinding)
            .disabled(locked)
        if customDue {
            DatePicker("Due", selection: selectedDueBinding,
                       displayedComponents: includeTime ? [.date, .hourAndMinute] : [.date])
                .environment(\.timeZone, editingTimeZone)
                .disabled(locked)
            if task != nil {
                Toggle("Include time", isOn: includeTimeBinding).disabled(locked)
            }
        } else if task == nil {
            Text("No due date").font(.caption).foregroundStyle(.secondary)
        }
        Picker("Priority", selection: priorityBinding) {
            Text("Low").tag(VaultTask.Priority.normal)
            Text("Medium").tag(VaultTask.Priority.medium)
            Text("High").tag(VaultTask.Priority.high)
        }.disabled(locked)
        if task == nil {
            Picker("List", selection: scopeBinding) {
                Text("Personal").tag(VaultTaskScope.personal)
                Text("Work").tag(VaultTaskScope.work)
            }.disabled(locked)
        } else {
            LabeledContent("List", value: draft.fields.scope == .personal ? "Personal" : "Work")
            Text("Edits stay in the existing vault source.").font(.caption).foregroundStyle(.secondary)
        }
        if task != nil {
            Toggle("Remind at due time", isOn: remindAtDueBinding).disabled(locked)
        }
        WatchTextInput(title: "Notes", text: notesBinding, multiline: true).disabled(locked)
    }
    private var modeBinding: Binding<WatchTaskMode> {
        Binding(get: { draft.mode }, set: { draft.mode = $0; persistEditing() })
    }
    private var inputBinding: Binding<String> {
        Binding(get: { draft.input }, set: { draft.input = $0; persistEditing() })
    }
    private var fieldTextBinding: Binding<String> {
        Binding(get: { draft.fields.text }, set: { draft.fields.text = $0; persistEditing() })
    }
    private var notesBinding: Binding<String> {
        Binding(get: { draft.fields.notes }, set: { draft.fields.notes = $0; persistEditing() })
    }
    private var priorityBinding: Binding<VaultTask.Priority> {
        Binding(get: { draft.fields.priority }, set: { draft.fields.priority = $0; persistEditing() })
    }
    private var scopeBinding: Binding<VaultTaskScope> {
        Binding(get: { draft.fields.scope }, set: { draft.fields.scope = $0; persistEditing() })
    }
    private var selectedDueBinding: Binding<Date> {
        Binding(get: { selectedDue }, set: {
            selectedDue = $0
            setDue($0)
            persistEditing()
        })
    }
    private var customDueBinding: Binding<Bool> {
        Binding(get: { customDue }, set: {
            customDue = $0
            if $0 { setDue(selectedDue) }
            else { draft.fields.due = nil; draft.fields.time = nil }
            persistEditing()
        })
    }
    private var includeTimeBinding: Binding<Bool> {
        Binding(get: { includeTime }, set: {
            includeTime = $0
            setDue(selectedDue)
            persistEditing()
        })
    }
    private var remindAtDueBinding: Binding<Bool> {
        Binding(get: { remindAtDue }, set: { remindAtDue = $0; persistEditing() })
    }
    private var hasEnteredContent: Bool {
        draft.mode == .auto ? !draft.input.isEmpty : !draft.fields.text.isEmpty || !draft.fields.notes.isEmpty
    }
    private func setDue(_ date: Date) {
        var calendar = Calendar.current; calendar.timeZone = editingTimeZone
        draft.fields.due = JarvisTodayTaskLists.dayKey(date, calendar: calendar)
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        draft.fields.time = includeTime ? String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0) : nil
    }
    private var isFixture: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--watch-fixture")
        #else
        false
        #endif
    }
    private func prepareStorage() {
        guard !storagePrepared else { return }
        storagePrepared = true
        if isFixture {
            storageAvailable = true
            #if DEBUG
            guard task == nil else {
                WatchPreview.captureReady("task-edit")
                return
            }
            let arguments = ProcessInfo.processInfo.arguments
            let manual = arguments.contains("--watch-screen=task-manual") ||
                (arguments.contains("--watch-screen=personal-new-task") &&
                 arguments.contains("--watch-task-mode=manual"))
            if manual {
                draft.mode = .manual
                draft.fields.text = "Call dentist"
                draft.fields.notes = "Ask about the next check-up."
            }
            if arguments.contains("--watch-screen=task-auto") ||
                (arguments.contains("--watch-screen=personal-new-task") && !manual) {
                draft.input = "Call the dentist tomorrow at 9. Ask about the next check-up."
            }
            for screen in ["personal-new-task", "task-auto", "task-manual"]
            where arguments.contains("--watch-screen=\(screen)") {
                WatchPreview.captureReady(screen)
                break
            }
            #endif
            return
        }
        do {
            let directory = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true
            )
            let value: WatchTaskDraftStore
            if let task {
                value = try WatchTaskDraftStore(
                    fileURL: directory.appendingPathComponent("watch-task-edit-\(task.id).json"),
                    editing: task
                )
            } else {
                value = try WatchTaskDraftStore(
                    fileURL: directory.appendingPathComponent("watch-task-create.json"),
                    createSelectedDue: selectedDue
                )
            }
            store = value
            storageAvailable = true
            apply(value.record)
        } catch {
            storageUnavailable()
        }
    }
    private func apply(_ record: WatchTaskEditorRecord) {
        draft = record.draft
        submissions = record.submissions
        update = record.update
        source = record.source
        selectedDue = record.selectedDue
        customDue = record.customDue
        includeTime = record.includeTime
        remindAtDue = record.remindAtDue
        reapplying = record.reapplying
        refreshedSource = record.reapplying ? record.source : nil
        requiresRefresh = record.phase == .requiresRefresh
        savedResult = record.savedTask
        switch record.phase {
        case .uncertain:
            failure = "Could not confirm the save. Retry keeps the exact original task."
        case .rejected:
            failure = "The task was not saved. Choose Edit draft to revise it, or retry the exact request."
        case .requiresRefresh:
            failure = "The previous edit may have been saved. Refresh the task before reviewing or retrying your edits."
        default:
            break
        }
    }
    private func persistEditing() {
        guard storageAvailable, !isFixture else { return }
        do {
            try store?.update(
                draft: draft, selectedDue: selectedDue, customDue: customDue,
                includeTime: includeTime, remindAtDue: remindAtDue
            )
        } catch {
            storageUnavailable()
        }
    }
    private func storageUnavailable() {
        storageAvailable = false
        storageFailure = "Could not preserve this task draft safely. Restart Jarvis on your Watch before saving. The stored draft has not been replaced."
    }
    private func reviseRejectedCreate() {
        if isFixture {
            submissions.reviseRejectedDraft()
            failure = nil
            return
        }
        do {
            try store?.reviseRejectedCreate()
            if let store { apply(store.record) }
            failure = nil
        } catch {
            storageUnavailable()
        }
    }
    private func startAnother() {
        guard task == nil else { return }
        if isFixture {
            draft = .init()
            submissions = .init()
            savedResult = nil
            return
        }
        do {
            try store?.startAnotherCreate()
            if let store { apply(store.record) }
            failure = nil
        } catch {
            storageUnavailable()
        }
    }
    private func save() async {
        guard !busy, storageAvailable, !requiresRefresh,
              connection.reachable, validationMessage == nil else { return }
        busy = true; failure = nil; defer { busy = false }
        var requestDispatched = false
        do {
            let request: WatchRequest
            if let task = source {
                let scheduleChanged = draft.fields.due != task.dueDate || draft.fields.time != task.dueTime
                let zone = scheduleChanged ? editingTimeZone : task.timeZone.flatMap(TimeZone.init(identifier:))
                let reminderOverride = remindAtDue != (task.remindAtDue == true) ? remindAtDue : nil
                let value = update ?? WatchTaskUpdateRequest(task: task, fields: draft.fields,
                                                           timeZone: zone, remindAtDue: reminderOverride)
                if isFixture {
                   update = value
                } else {
                   do {
                       guard let store else { throw WatchFailure.failed }
                       try store.beginEdit(value)
                       apply(store.record)
                   } catch {
                       storageUnavailable()
                       return
                   }
                }
                request = .init(action: .updateWatchTask, itemID: task.id, data: try WatchCodec.encode(value))
            } else {
                let value: WatchTaskCreateRequest
                if isFixture {
                   value = try submissions.begin(draft)
                } else {
                   do {
                       guard let store else { throw WatchFailure.failed }
                       value = try store.beginCreate()
                       apply(store.record)
                   } catch {
                       storageUnavailable()
                       return
                   }
                }
                guard let id = UUID(uuidString: value.submissionId) else { throw WatchFailure.invalidRequest }
                request = .init(action: .createWatchTask, data: try WatchCodec.encode(value),
                               id: id)
            }
            requestDispatched = true
            let reply = try await connection.request(request)
            if let detail = reply.taskError { throw detail }
            guard let data = reply.data, let value = try? JSONDecoder().decode(VaultTask.self, from: data),
                  WatchTaskValidation.task(value) else { throw WatchTaskMutationFailure.unknown }
            let result = VaultTask(id: value.id, text: value.text, done: value.done,
                dueDate: value.dueDate, dueTime: value.dueTime, dueAt: value.dueAt,
                priority: value.priority, path: value.path, line: value.line,
                heading: value.heading ?? source?.heading, version: value.version,
                notes: value.notes, timeZone: value.timeZone, remindAtDue: value.remindAtDue)
            if isFixture {
                submissions.finish()
            } else {
                do {
                   try store?.saveResult(result)
                   if let store { apply(store.record) }
                } catch {
                   storageUnavailable()
                   return
                }
            }
            saved(result); dismiss()
        } catch {
            let detail = error as? WatchTaskMutationFailure
            let definitelyRejected = !requestDispatched || detail?.outcomeUnknown == false
            if isFixture {
                if task == nil { submissions.finish(rejectedWithoutSaving: definitelyRejected) }
                if task != nil {
                   requiresRefresh = !definitelyRejected || detail?.code == "task_conflict" ||
                       detail?.code == "http_409"
                   if !requiresRefresh { update = nil }
                }
            } else if store?.record.phase == .submitting {
                do {
                   let editConflict = task != nil &&
                       (detail?.code == "task_conflict" || detail?.code == "http_409")
                   try store?.finishFailure(
                       rejectedWithoutSaving: definitelyRejected,
                       editRequiresRefresh: editConflict
                   )
                   if let store { apply(store.record) }
                } catch {
                   storageUnavailable()
                   return
                }
            }
            failure = WatchTaskPresentation.failure(error)
        }
    }
    private func refreshSource() async {
        guard !busy, storageAvailable, let source, connection.reachable else { return }
        busy = true; defer { busy = false }
        do {
            guard let fresh = try await WatchPersonalTaskRead.task(source.id, connection: connection) else {
                failure = "This task is no longer in the open list. Your edits are kept; return to Tasks to check its status."
                return
            }
            if isFixture {
                if fresh.text == draft.fields.text, fresh.dueDate == draft.fields.due,
                   fresh.dueTime == draft.fields.time, fresh.priority == draft.fields.priority,
                   (fresh.notes ?? "") == draft.fields.notes, (fresh.remindAtDue == true) == remindAtDue {
                    saved(fresh); dismiss()
                    return
                }
                self.source = fresh
                refreshedSource = fresh
                update = nil
                requiresRefresh = false
                reapplying = true
            } else {
                do {
                    guard let store else { throw WatchFailure.failed }
                    let alreadySaved = try store.refreshEdit(with: fresh)
                    apply(store.record)
                    if alreadySaved {
                        saved(fresh)
                        dismiss()
                        return
                    }
                } catch {
                    storageUnavailable()
                    return
                }
            }
            refreshedSource = fresh
            failure = "Latest task loaded. Your edits are kept. Review the current saved task before saving your edits."
        } catch { failure = "The saved task could not refresh. " + WatchTaskPresentation.failure(error) }
    }
}

private enum WatchPersonalTaskRead {
    @MainActor static func load(
        _ connection: WatchConnection, starting: WatchTaskPageCollection = .init()
    ) async throws -> WatchTaskPageCollection {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(45))
        var result = starting
        // Keep each explicit load short; the list exposes remaining pages rather than silently dropping them.
        for _ in 0..<3 {
            guard let offset = result.nextOffset else { break }
            try Task.checkCancellation()
            guard clock.now < deadline else { throw WatchFailure.unavailable }
            let reply = try await connection.request(.init(action: .tasks,
                data: WatchCodec.encode(WatchPageRequest(offset: offset))))
            guard let data = reply.data, data.count <= WatchLimits.payloadBytes,
                  let page = try? JSONDecoder().decode(WatchTaskPage.self, from: data) else { throw WatchFailure.failed }
            try result.append(page)
        }
        return result
    }

    @MainActor static func task(_ id: String, connection: WatchConnection) async throws -> VaultTask? {
        let reply = try await connection.request(.init(action: .tasks, itemID: id))
        guard let data = reply.data, data.count <= WatchTaskValidation.responseBytes else { throw WatchFailure.failed }
        let task = try JSONDecoder().decode(VaultTask?.self, from: data)
        if let task {
            guard task.id == id, WatchTaskValidation.task(task) else { throw WatchFailure.failed }
        }
        return task
    }
}

enum WatchTaskPresentation {
    static func due(_ task: VaultTask, now: Date = Date(), calendar: Calendar = .current, today: String? = nil) -> String {
        guard let due = task.dueDate else { return "No due date" }
        let day = today ?? JarvisTodayTaskLists.dayKey(now, calendar: calendar)
        let label = due == day ? "Today" : JarvisNotesLocalization.formattedDueDate(due, language: .en)
        let time = task.dueTime.map { ", " + $0 } ?? ""
        return (due < day ? "Overdue · " : "") + label + time
    }
    static func date(_ task: VaultTask) -> Date? {
        guard let due = task.dueDate else { return nil }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = task.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm"; formatter.isLenient = false
        return formatter.date(from: due + " " + (task.dueTime ?? "12:00"))
    }
    static func failure(_ error: Error) -> String {
        if let detail = error as? WatchTaskMutationFailure { return detail.message }
        if let failure = error as? WatchFailure { return failure.message }
        if error is WatchTaskSubmissionError { return "The original submission is kept. Retry it without changing the task." }
        return WatchTaskMutationFailure.unknown.message
    }
}
