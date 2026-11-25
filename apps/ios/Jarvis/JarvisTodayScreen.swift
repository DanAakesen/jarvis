import JarvisCore
import SwiftUI

/// Home: next appointment, activity overview, quick actions and a native swipeable agenda.
/// The pinned composer carries the same draft into Chat and Voice.
struct JarvisTodayScreen: View {
    private enum Tab: Hashable { case today, due }

    private enum Sheet: Identifiable {
        case task, taskDetail(VaultTask), note, workout, lift

        var id: String {
            switch self {
            case .task: "task"
            case .taskDetail(let task): "task.detail.\(task.id)"
            case .note: "note"
            case .workout: "workout"
            case .lift: "lift"
            }
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let fixtureMode: Bool
    let onChat: (JarvisChatHandoff) -> Void
    let onVoice: () -> Void
    var onCalendar: () -> Void = {}
    var onSyncAppleHealth: (() async -> JarvisHealthSyncState?)? = nil

    @State private var healthSyncState: JarvisHealthSyncState?
    @State private var tab: Tab = .today
    @State private var nextDetailID: String?
    @State private var nextExpanded = false
    @State private var listExpanded = false
    @State private var sheet: Sheet?
    @State private var composerDraft = ComposerDraft()
    private var draft: String {
        get { composerDraft.text }
        nonmutating set { composerDraft.replace(with: newValue) }
    }
    @StateObject private var dictation = ChatDictation()
    @State private var dictationFailed = false
    @State private var flyingText: String?
    @State private var flightRisen = false
    @State private var successConfirmation: JarvisSuccessConfirmation?
    @State private var pendingTaskIDs = Set<String>()
    @State private var taskCompletionFailed = false
    @State private var taskCompletionError = ""
    @State private var composerFocused = false

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList(customRowBackgrounds: true) {
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                JarvisHealthSyncIssue(state: healthSyncState, language: language)
                upNext
                JarvisTodayActivityCard(model: model, language: language, fixtureMode: fixtureMode)
                if model.isShowingOfflineCopy {
                    Label(copy(.offline), systemImage: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("today.offline")
                }
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.bottom, JarvisPageHeaderMetrics.spacing)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { model.activity.clearSelection() }
                    .accessibilityHidden(true)
            }
        } content: {
            dayRows.environment(\.jarvisCardRole, "schedule")
        }
        .listStyle(.plain)
        .listRowSpacing(0)
        .contentMargins(.top, 0, for: .scrollContent)
        .contentMargins(.bottom, JarvisPageHeaderMetrics.spacing, for: .scrollContent)
        .jarvisPageHeader { JarvisPageHeader(title: JarvisDestination.today.localizedTitle(language: language), language: language) }
        .environment(\.timeZone, JarvisHealthSyncWindow.calendar.timeZone)
        .accessibilityIdentifier("today.list")
        .refreshable {
            healthSyncState = await onSyncAppleHealth?()
            guard !Task.isCancelled else { return }
            await model.refresh(force: true)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .toolbar(.hidden, for: .navigationBar)
        .jarvisPageBackground()
        .jarvisSuccessFeedback($successConfirmation)
        .alert(JarvisNotesCopy(language: language).tasks, isPresented: $taskCompletionFailed) {
            Button(JarvisNotesCopy(language: language).ok, role: .cancel) {}
        } message: {
            Text(taskCompletionError)
        }
        .onDisappear { dictation.stop() }
        .task {
            await model.refresh()
#if targetEnvironment(simulator)
            let arguments = ProcessInfo.processInfo.arguments
            if fixtureMode, sheet == nil {
                if arguments.contains("--screenshot-today-sheet=workout") { sheet = .workout }
                if arguments.contains("--screenshot-today-sheet=lift") { sheet = .lift }
            }
#endif
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
        .task {
            guard !fixtureMode else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                guard scenePhase == .active else { continue }
                await model.refresh()
            }
        }
        .sheet(item: $sheet) { presented in
            sheetContent(presented)
        }
    }

    // MARK: Day list and tasks

    private enum DayRow: Identifiable {
        case entry(JarvisTodayCalendarEntry)
        case task(VaultTask)

        var id: String {
            switch self {
            case .entry(let entry): "entry.\(entry.id)"
            case .task(let task): "task.\(task.id)"
            }
        }
    }

    private var calendarSection: JarvisTodaySection<[JarvisTodayCalendarEntry]> { model.calendar }

    private var taskLists: JarvisTodayTaskLists? { model.taskData.value?.lists }

    private var agendaControls: some View {
        HStack(spacing: JarvisDesignTokens.segmentedBarSpacing) {
            Text("Schedule").font(.headline).accessibilityAddTraits(.isHeader).accessibilityIdentifier("today.section.upcoming")
            Spacer(minLength: 0)
            tabControl
            JarvisIconButton(title: "Calendar", systemImage: "calendar", identifier: "today.calendar",
                             tint: JarvisDesignTokens.primaryAccent, action: onCalendar)
            plusMenu
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: tab)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(.agendaAndTasks))
        .accessibilityIdentifier("today.agenda")
    }

    private var tabControl: some View {
        JarvisPeriodSelector(
            title: copy(.agendaAndTasks),
            identifierPrefix: "today.tab",
            items: [
                JarvisTabItem(tag: Tab.today, title: "Today", identifier: "today.tab.today"),
                JarvisTabItem(tag: Tab.due, title: "Later", identifier: "today.tab.due"),
            ],
            selection: $tab
        )
        .onChange(of: tab) { listExpanded = false }
    }

    private func rows(for value: Tab) -> [DayRow] {
        let calendar = JarvisHealthSyncWindow.calendar
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: model.now))!
        let entries = JarvisTodayAgenda.upcoming(calendarSection.value ?? [], now: model.now)
            .filter { value == .today ? $0.start < tomorrow : $0.start >= tomorrow }
        let tasks = value == .today ? taskLists?.today : taskLists?.upcoming
        return (entries.map(DayRow.entry) + (tasks ?? []).map(DayRow.task)).sorted {
            (rowDate($0), $0.id) < (rowDate($1), $1.id)
        }
    }

    private func rowDate(_ row: DayRow) -> Date {
        switch row {
        case .entry(let entry): return entry.start
        case .task(let task):
            if let due = task.dueAt.flatMap(parseDate) { return due }
            guard let day = task.dueDate else { return .distantFuture }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = JarvisHealthSyncWindow.calendar.timeZone
            formatter.dateFormat = "yyyy-MM-dd HH:mm"
            return formatter.date(from: day + " " + (task.dueTime ?? "23:59")) ?? .distantFuture
        }
    }

    @ViewBuilder private var upNext: some View {
        let upcoming = (rows(for: .today) + rows(for: .due)).filter { row in
            switch row {
            case .entry(let entry): return entry.end > model.now
            case .task: return rowDate(row) >= model.now && rowDate(row) != .distantFuture
            }
        }
        if let first = upcoming.first {
            let next = rowDate(first)
            let rest = upcoming.dropFirst().filter { JarvisHealthSyncWindow.calendar.isDate(rowDate($0), inSameDayAs: max(model.now, next)) }
            let following = upcoming.dropFirst().first { rowDate($0) != .distantFuture && !JarvisHealthSyncWindow.calendar.isDate(rowDate($0), inSameDayAs: max(model.now, next)) }
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Up Next").font(.headline)
                    Spacer()
                    if next <= model.now {
                        Text("Now").font(.caption).foregroundStyle(JarvisDesignTokens.primaryAccent)
                    } else {
                        Text(countdown(next)).font(.caption).foregroundStyle(JarvisDesignTokens.primaryAccent)
                    }
                }
                nextRow(first)
                if !rest.isEmpty || following != nil {
                    if nextExpanded {
                        if !rest.isEmpty {
                            Divider()
                            Text("Later that day").font(.subheadline.weight(.semibold))
                            ForEach(rest) { nextRow($0) }
                        }
                        if let following {
                            Divider()
                            Text("Next up").font(.subheadline.weight(.semibold))
                            nextRow(following)
                        }
                    }
                    Divider()
                    JarvisDashboardDisclosure(title: nextExpanded ? "Show less" : "Show more", expanded: nextExpanded) { nextExpanded.toggle() }
                }
            }.padding(JarvisPageHeaderMetrics.heroInset).jarvisDashboardSurface().environment(\.jarvisCardRole, "next")
        }
    }

    private func countdown(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = language.locale
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: model.now)
    }

    private func open(_ row: DayRow) {
        switch row {
        case .entry: onCalendar()
        case .task(let task): present(.taskDetail(task))
        }
    }

    private func title(_ row: DayRow) -> String {
        switch row {
        case .entry(let event): event.title
        case .task(let task): JarvisTaskTitle.plain(task.text)
        }
    }

    private func time(_ row: DayRow) -> String {
        switch row {
        case .entry(let event):
            if event.allDay == true { return "All day" }
            return [event.start, event.end].map { JarvisTodayGreeting.timeText($0, language: language, calendar: JarvisHealthSyncWindow.calendar) }.joined(separator: " – ")
        case .task(let task):
            if let value = task.dueTime { return JarvisNotesLocalization.formattedDueTime(value, language: language) }
            if task.dueAt != nil, rowDate(row) != .distantFuture {
                return JarvisTodayGreeting.timeText(rowDate(row), language: language, calendar: JarvisHealthSyncWindow.calendar)
            }
            return task.dueDate == nil ? "—" : "Any time"
        }
    }

    private func nextRow(_ row: DayRow) -> some View {
        let date = rowDate(row)
        return VStack(alignment: .leading, spacing: 4) {
            Button {
                if case .entry = row { nextDetailID = nextDetailID == row.id ? nil : row.id }
                else { open(row) }
            } label: {
                HStack(spacing: 12) {
                    VStack(spacing: 0) {
                        Text(date, format: .dateTime.month(.abbreviated)).textCase(.uppercase).font(.caption2.bold())
                        Text(date, format: .dateTime.day()).font(.title2.bold())
                    }.frame(minWidth: 46, minHeight: 52)
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .background(JarvisDesignTokens.primaryAccent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title(row)).font(.headline)
                        Text(time(row)).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: nextDetailID == row.id ? "chevron.down" : "chevron.right").font(.caption).foregroundStyle(.secondary)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            if nextDetailID == row.id, case .entry(let event) = row {
                Text([event.start.formatted(.dateTime.weekday(.wide).day().month(.wide)), event.location].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    /// Slices of one card keep the list's native swipe and accessibility actions on each task.
    private func scheduleSlice<Content: View>(first: Bool = false, last: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        let radius = JarvisDesignTokens.surfaceRadius
        let shape = UnevenRoundedRectangle(topLeadingRadius: first ? radius : 0, bottomLeadingRadius: last ? radius : 0,
                                           bottomTrailingRadius: last ? radius : 0, topTrailingRadius: first ? radius : 0)
        return VStack(alignment: .leading, spacing: 0) { content() }.padding(.horizontal, JarvisPageHeaderMetrics.heroInset)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background { JarvisDashboardCardFill(shape: shape, horizontal: true) }
            .listRowBackground(Color.clear).listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: JarvisDesignTokens.notesHorizontalInset, bottom: 0, trailing: JarvisDesignTokens.notesHorizontalInset))
    }

    @ViewBuilder
    private var dayRows: some View {
        let all = rows(for: tab)
        let expansion = JarvisTodayExpansion(total: all.count, isExpanded: listExpanded)
        scheduleSlice(first: true) { agendaControls.padding(.top, 8).padding(.bottom, 4) }
        if isLoadingRows || hasRowIssue {
            scheduleSlice(last: all.isEmpty) { VStack { calendarIssue; taskIssue } }
        }
        if all.isEmpty && !isLoadingRows && !hasRowIssue {
            scheduleSlice(last: true) {
                statusRow(copy(tab == .today ? .nothingToday : .nothingDue), systemImage: "calendar").padding(.vertical, 8)
            }
        }
        ForEach(Array(all.prefix(expansion.visible).enumerated()), id: \.element.id) { index, row in
            scheduleSlice(last: expansion.hidden == 0 && index == expansion.visible - 1) {
                Divider()
                Button { open(row) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            if case .entry(let event) = row, event.allDay != true {
                                Text(JarvisTodayGreeting.timeText(event.start, language: language, calendar: JarvisHealthSyncWindow.calendar))
                            } else { Text(time(row)) }
                            if rowDate(row) != .distantFuture && !JarvisHealthSyncWindow.calendar.isDate(rowDate(row), inSameDayAs: model.now) {
                                Text(rowDate(row), format: .dateTime.month(.abbreviated).day()).font(.caption2)
                            }
                        }.font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .frame(minWidth: 48, alignment: .leading)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(title(row)).font(.body.weight(.semibold))
                            switch row {
                            case .entry(let event):
                                Text(event.location ?? copy(.calendarEvent)).font(.caption).foregroundStyle(.secondary)
                                ForEach(model.correlatedNotes(for: event)) { note in
                                    Label(note.title, systemImage: "note.text").font(.caption).foregroundStyle(.secondary)
                                }
                            case .task(let task):
                                let strings = JarvisNotesCopy(language: language)
                                let scope = task.scope == .work ? strings.work : strings.personal
                                let priority = task.priority == .high ? strings.priorityHigh : task.priority == .medium ? strings.priorityMedium : nil
                                Text([scope, priority].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }.padding(.vertical, 8).frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("today." + row.id)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                if case .task(let task) = row {
                    Button { Task { await completeTask(task) } } label: { Label(copy(.markDone), systemImage: "checkmark") }
                        .tint(JarvisDesignTokens.primaryAccent).disabled(pendingTaskIDs.contains(task.id))
                        .accessibilityIdentifier("today.task.done.\(task.id)")
                }
            }
        }
        if expansion.hidden > 0 {
            scheduleSlice(last: true) {
                Divider()
                JarvisDashboardDisclosure(title: listExpanded ? copy(.showLess) : "Show more", expanded: listExpanded) { listExpanded.toggle() }
                    .accessibilityIdentifier("today.list.expand")
            }
        }
    }

    private var isLoadingRows: Bool {
        (calendarSection.value == nil && calendarSection.isLoading)
            || (model.taskData.value == nil && model.taskData.isLoading)
    }

    private var hasRowIssue: Bool {
        (calendarSection.value == nil && !calendarSection.isLoading)
            || (model.taskData.value == nil && !model.taskData.isLoading)
    }

    @ViewBuilder
    private var calendarIssue: some View {
        if calendarSection.value == nil {
            if calendarSection.isLoading {
                loadingRow.jarvisListRow(separator: false)
            } else {
                statusRow(
                    copy(calendarSection.failure == .unavailable ? .calendarUnavailable : .loadFailed),
                    systemImage: "calendar.badge.exclamationmark",
                    retry: calendarSection.failure != .unavailable
                ).jarvisListRow(separator: false)
            }
        }
    }

    @ViewBuilder
    private var taskIssue: some View {
        if model.taskData.value == nil, !(calendarSection.value == nil && calendarSection.isLoading) {
            if model.taskData.isLoading {
                loadingRow.jarvisListRow(separator: false)
            } else {
                statusRow(
                    copy(model.taskData.failure == .unavailable ? .tasksUnavailable : .loadFailed),
                    systemImage: "exclamationmark.triangle",
                    retry: model.taskData.failure != .unavailable
                ).jarvisListRow(separator: false)
            }
        }
    }

    private var plusMenu: some View {
        JarvisMenuButton(title: copy(.add), systemImage: "plus", identifier: "today.plus", tint: JarvisDesignTokens.primaryAccent) {
            Button(copy(.newTask), systemImage: "checklist") { present(.task) }
                .accessibilityIdentifier("today.plus.task")
            Button(copy(.newNote), systemImage: "note.text") { present(.note) }
                .accessibilityIdentifier("today.plus.note")
            Divider()
            Button(copy(.logWorkout), systemImage: "figure.strengthtraining.traditional") { present(.workout) }
                .accessibilityIdentifier("today.plus.workout")
            Button(copy(.logLift), systemImage: "dumbbell") { present(.lift) }
                .accessibilityIdentifier("today.plus.lift")
        }
    }

    private func present(_ value: Sheet) {
        Task { @MainActor in
            await Task.yield()
            sheet = value
        }
    }

    private func completeTask(_ task: VaultTask) async {
        guard !pendingTaskIDs.contains(task.id) else { return }
        pendingTaskIDs.insert(task.id)
        defer { pendingTaskIDs.remove(task.id) }
        do {
            try await model.complete(task)
            successConfirmation = JarvisSuccessConfirmation(message: JarvisNotesCopy(language: language).completed)
        } catch {
            guard !Task.isCancelled else { return }
            let notesCopy = JarvisNotesCopy(language: language)
            switch error {
            case JarvisNotesClientError.writeOutcomeUnknown: taskCompletionError = notesCopy.unknownWrite
            case JarvisNotesClientError.taskConflict: taskCompletionError = notesCopy.taskChanged
            case JarvisClientError.signInRequired: taskCompletionError = notesCopy.signIn
            case JarvisClientError.notOwner: taskCompletionError = notesCopy.notOwner
            default: taskCompletionError = copy(.saveFailed)
            }
            taskCompletionFailed = true
        }
    }

    // MARK: States

    private var loadingRow: some View {
        HStack(spacing: 8) {
            JarvisLoadingView()
            Text(copy(.loading)).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
        .accessibilityElement(children: .combine)
    }

    private func statusRow(_ text: String, systemImage: String, retry: Bool = false) -> some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                .accessibilityHidden(true)
            Text(text).font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if retry {
                JarvisIconButton(
                    title: copy(.retry),
                    systemImage: "arrow.clockwise",
                    identifier: "today.retry"
                ) { Task { await model.refresh(force: true) } }
            }
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
        .accessibilityElement(children: .contain)
    }

    // MARK: Composer

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func sendDraft() {
        guard canSend else { return }
        dictation.stop()
        let text = composerDraft.consume()
        composerFocused = false
        guard !reduceMotion else {
            onChat(JarvisChatHandoff(text: text))
            return
        }
        flightRisen = false
        flyingText = text
        withAnimation(.easeOut(duration: 0.45)) { flightRisen = true }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(450))
            flyingText = nil
            onChat(JarvisChatHandoff(text: text))
        }
    }

    /// The message lifts off the composer and fades while Chat opens, so sending reads as sending.
    @ViewBuilder
    private var flyingBubble: some View {
        if let flyingText {
            Text(flyingText)
                .font(.body)
                .lineLimit(2)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(JarvisDesignTokens.secondaryAccent.opacity(0.28), in: Capsule())
                .offset(y: flightRisen ? -240 : 0)
                .opacity(flightRisen ? 0 : 1)
                .scaleEffect(flightRisen ? 0.92 : 1)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func handOffPlusAction(_ action: JarvisComposerPlusAction) {
        let text = composerDraft.consume()
        composerFocused = false
        onChat(JarvisChatHandoff(text: text, action: action))
    }

    private var usesCameraStub: Bool {
#if targetEnvironment(simulator)
        fixtureMode && ProcessInfo.processInfo.arguments.contains("--ui-test-camera-sheet")
#else
        false
#endif
    }

    private func chatCopy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: language)
    }

    private func toggleDictation() {
        if dictation.isListening {
            dictation.stop()
            return
        }
        Task {
            guard await ChatDictation.requestAccess() else {
                dictationFailed = true
                return
            }
            do {
                try dictation.start(
                    locale: .current,
                    base: draft
                ) { draft = $0 }
                dictationFailed = false
            } catch {
                dictationFailed = true
            }
        }
    }

    /// The Chat composer itself (`JarvisComposerBar`): plus on the left, dictation and voice on the right, voice
    /// becoming send while typing.
    private var composer: some View {
        VStack(spacing: JarvisDesignTokens.chatComposerSpacing) {
            if dictationFailed {
                Label(chatCopy(.dictationUnavailable), systemImage: "mic.slash")
                    .font(.footnote)
                    .foregroundStyle(Color.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
                    .accessibilityIdentifier("today.dictation.error")
            }
            JarvisComposerBar(
                placeholder: chatCopy(.messagePlaceholder),
                draft: $composerDraft,
                isFocused: $composerFocused,
                inputIdentifier: "today.input",
                collapsesWhenUnfocused: true,
                rimState: dictation.isListening ? .listening : (canSend ? .typing : .idle),
                isRimAnimated: !fixtureMode,
                waveformLevels: dictation.isListening ? dictation.levels : nil,
                onSubmit: sendDraft,
                header: { EmptyView() },
                leading: {
                    JarvisComposerPlusMenu(
                        title: chatCopy(.plusMenuLabel),
                        hint: chatCopy(.plusMenuHint),
                        identifier: "today.composer.plus",
                        copy: chatCopy,
                        screenShareDisabled: fixtureMode,
                        videoDisabled: fixtureMode,
                        attachDisabled: fixtureMode,
                        cameraDisabled: fixtureMode && !usesCameraStub,
                        onAction: handOffPlusAction
                    )
                },
                actions: {
                    JarvisComposerIconButton(
                        title: chatCopy(dictation.isListening ? .stopDictation : .dictate),
                        systemImage: dictation.isListening ? "stop.circle.fill" : "mic",
                        identifier: "today.dictate",
                        isDisabled: fixtureMode,
                        action: toggleDictation
                    )
                    if canSend {
                        JarvisComposerIconButton(
                            title: chatCopy(.sendMessage),
                            systemImage: "paperplane.fill",
                            identifier: "today.send",
                            action: {
                                dictation.stop()
                                sendDraft()
                            }
                        )
                    } else {
                        JarvisComposerIconButton(
                            title: chatCopy(.voiceMode),
                            systemImage: "waveform",
                            identifier: "today.voice",
                            action: {
                                dictation.stop()
                                onVoice()
                            }
                        )
                    }
                }
            )
        }
        .overlay(alignment: .top) { flyingBubble }
    }

    // MARK: Sheets

    @ViewBuilder
    private func sheetContent(_ presented: Sheet) -> some View {
        switch presented {
        case .task:
            if let client = model.notesClient {
                JarvisTaskEditorSheet(client: client, copy: JarvisNotesCopy(language: language), mode: .create(scope: .work)) {
                    sheet = nil
                    Task { await model.refreshTasks() }
                }
            }
        case .taskDetail(let task):
            JarvisTaskDetailSheet(
                task: task,
                today: model.taskData.value?.today ?? "",
                copy: JarvisNotesCopy(language: language),
                client: model.notesClient,
                onOpenSource: nil,
                onChanged: { Task { await model.refreshTasks() } },
                onClose: { sheet = nil }
            )
        case .note:
            if let client = model.notesClient {
                JarvisNoteEditorSheet(
                    client: client, copy: JarvisNotesCopy(language: language),
                    mode: .create(folder: "", staged: [])
                ) { _ in
                    sheet = nil
                    successConfirmation = JarvisSuccessConfirmation(message: JarvisNotesCopy(language: language).saved)
                }
            }
        case .workout, .lift:
            JarvisTodayGymSheet(
                model: model, language: language, kind: presented.id == "lift" ? .lift : .workout
            )
        }
    }
}

/// A slow, quiet highlight that drifts across the greeting. It is static with Reduce Motion and in UI tests.
private struct JarvisTodayShimmer<Content: View>: View {
    let isAnimated: Bool
    let content: Content
    @State private var phase: CGFloat = 0

    init(isAnimated: Bool, @ViewBuilder content: () -> Content) {
        self.isAnimated = isAnimated
        self.content = content()
    }

    var body: some View {
        content
            .overlay {
                if isAnimated {
                    GeometryReader { geometry in
                        LinearGradient(
                            colors: [.clear, Color.white.opacity(0.45), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geometry.size.width * 0.5)
                        .offset(x: -geometry.size.width * 0.5 + phase * geometry.size.width * 1.5)
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
            .onAppear {
                guard isAnimated else { return }
                withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}
