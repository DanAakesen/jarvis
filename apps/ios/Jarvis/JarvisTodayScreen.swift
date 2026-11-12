import JarvisCore
import SwiftUI

/// Home: the greeting, activity overview, quick actions and a native swipeable agenda.
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
    @State private var briefVersion = 0
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let fixtureMode: Bool
    let onChat: (JarvisChatHandoff) -> Void
    let onVoice: () -> Void
    var onSyncAppleHealth: (() async -> JarvisHealthSyncState?)? = nil

    @State private var healthSyncState: JarvisHealthSyncState?
    @State private var tab: Tab = .today
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
    @ScaledMetric(relativeTo: .largeTitle) private var greetingSize: CGFloat = 25
    @ScaledMetric(relativeTo: .body) private var agendaIconSize: CGFloat = 20
    @State private var composerFocused = false

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList(customRowBackgrounds: true) {
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                greeting
                JarvisHealthSyncIssue(state: healthSyncState, language: language)
                JarvisSectionHeadline(copy(.page))
                    .accessibilityIdentifier("today.section.home")
                JarvisTodayActivityCard(model: model, language: language, fixtureMode: fixtureMode)
                if model.isShowingOfflineCopy {
                    Label(copy(.offline), systemImage: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("today.offline")
                }
                JarvisSectionHeadline(copy(.quickActions))
                    .accessibilityIdentifier("today.section.quickActions")
                quickActions
                JarvisSectionHeadline(copy(.upcoming))
                    .accessibilityIdentifier("today.section.upcoming")
                agendaControls
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
            dayRows
        }
        .listStyle(.plain)
        .listRowSpacing(0)
        .contentMargins(.top, 0, for: .scrollContent)
        .contentMargins(.bottom, JarvisPageHeaderMetrics.spacing, for: .scrollContent)
        .scrollEdgeEffectHidden()
        .accessibilityIdentifier("today.list")
        .refreshable {
            healthSyncState = await onSyncAppleHealth?()
            guard !Task.isCancelled else { return }
            await model.refresh(force: true)
            briefVersion += 1
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .toolbar(.hidden, for: .navigationBar)
        .jarvisAmbientBackground()
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
        .task(id: "\(language.rawValue)-\(briefVersion)") {
            await model.refreshBrief(force: briefVersion > 0)
        }
        .onChange(of: model.taskData.value) { _, _ in briefVersion += 1 }
        .onChange(of: model.calendar.value) { _, _ in briefVersion += 1 }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh(); briefVersion += 1 } }
        }
        .task {
            guard !fixtureMode else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                guard scenePhase == .active else { continue }
                await model.refresh()
                briefVersion += 1
            }
        }
        .sheet(item: $sheet) { presented in
            sheetContent(presented)
        }
    }

    // MARK: Greeting

    private var greeting: some View {
        let value = model.greeting(language: language)
        return JarvisTodayShimmer(isAnimated: !fixtureMode && !reduceMotion) {
            Text(attributedGreeting(value))
                .font(.system(size: greetingSize, weight: .semibold))
                .lineSpacing(4)
                .lineLimit(model.briefMaxVisibleLines)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 12)
        .padding(.bottom, JarvisPageHeaderMetrics.rowLineSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(value.plainText)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("today.greeting")
    }

    private func attributedGreeting(_ greeting: JarvisTodayGreeting) -> AttributedString {
        var result = AttributedString()
        for segment in greeting.segments {
            var part = AttributedString(segment.text)
            part.foregroundColor = segment.isKey ? JarvisDesignTokens.primaryAccent : Color.primary
            result.append(part)
        }
        return result
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
            tabControl
            plusMenu
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: tab)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(.agendaAndTasks))
        .accessibilityIdentifier("today.agenda")
    }

    private var tabControl: some View {
        let today = taskLists?.today.count
        let due = taskLists?.upcoming.count
        return JarvisSegmentedBar(
            title: copy(.agendaAndTasks),
            identifierPrefix: "today.tab",
            items: [
                JarvisTabItem(tag: Tab.today, title: today.map { "\(copy(.tabToday)) \($0)" } ?? copy(.tabToday), identifier: "today.tab.today"),
                JarvisTabItem(
                    tag: Tab.due,
                    title: due.map { "\(copy(.tabDue)) \($0)" } ?? copy(.tabDue),
                    identifier: "today.tab.due"
                ),
            ],
            selection: $tab
        )
        .onChange(of: tab) { listExpanded = false }
    }

    private func rows(for value: Tab) -> [DayRow] {
        switch value {
        case .today:
            let entries = JarvisTodayAgenda.upcoming(calendarSection.value ?? [], now: model.now).map(DayRow.entry)
            return entries + (taskLists?.today ?? []).map(DayRow.task)
        case .due:
            return (taskLists?.upcoming ?? []).map(DayRow.task)
        }
    }

    @ViewBuilder
    private var dayRows: some View {
        let visibleRows = rows(for: tab)
        let expansion = JarvisTodayExpansion(total: visibleRows.count, isExpanded: listExpanded)
        if isLoadingRows || hasRowIssue {
            JarvisRowGroup {
                if tab == .today { calendarIssue }
                taskIssue
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(agendaInsets)
        }
        if visibleRows.isEmpty {
            if !isLoadingRows, !hasRowIssue {
                JarvisRowGroup {
                    statusRow(
                        copy(tab == .today ? .nothingToday : .nothingDue),
                        systemImage: tab == .today ? "calendar" : "checklist"
                    )
                    .jarvisListRow(separator: false)
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(agendaInsets)
            }
        } else {
            ForEach(Array(visibleRows.prefix(expansion.visible).enumerated()), id: \.element.id) { index, row in
                let shape = UnevenRoundedRectangle(
                    topLeadingRadius: index == 0 ? JarvisDesignTokens.surfaceRadius : 0,
                    bottomLeadingRadius: index == expansion.visible - 1 ? JarvisDesignTokens.surfaceRadius : 0,
                    bottomTrailingRadius: index == expansion.visible - 1 ? JarvisDesignTokens.surfaceRadius : 0,
                    topTrailingRadius: index == 0 ? JarvisDesignTokens.surfaceRadius : 0
                )
                Group {
                    switch row {
                    case .entry(let entry):
                        calendarRow(entry)
                            .jarvisListRow(separator: index < expansion.visible - 1)
                            .background(.regularMaterial, in: shape)
                            .clipShape(shape)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(agendaInsets)
                    case .task(let task):
                        taskRow(
                            task,
                            isFirst: index == 0,
                            isLast: index == expansion.visible - 1
                        )
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(agendaInsets)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    if case .task(let task) = row {
                        Button {
                            Task { await completeTask(task) }
                        } label: {
                            Label(copy(.markDone), systemImage: "checkmark")
                        }
                        .tint(JarvisDesignTokens.primaryAccent)
                        .disabled(pendingTaskIDs.contains(task.id))
                        .accessibilityIdentifier("today.task.done.\(task.id)")
                    }
                }
            }
            expandButton(
                expansion: expansion,
                isExpanded: listExpanded,
                identifier: "today.list.expand"
            ) { listExpanded.toggle() }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(agendaInsets)
        }
    }

    private var agendaInsets: EdgeInsets {
        EdgeInsets(top: 0, leading: JarvisDesignTokens.notesHorizontalInset,
                   bottom: 0, trailing: JarvisDesignTokens.notesHorizontalInset)
    }

    private func agendaIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: agendaIconSize, weight: .regular))
            .foregroundStyle(JarvisDesignTokens.primaryAccent)
            .frame(width: agendaIconSize + JarvisPageHeaderMetrics.rowLineSpacing,
                   height: agendaIconSize + JarvisPageHeaderMetrics.rowLineSpacing)
            .accessibilityHidden(true)
    }

    private var isLoadingRows: Bool {
        (tab == .today && calendarSection.value == nil && calendarSection.isLoading)
            || (model.taskData.value == nil && model.taskData.isLoading)
    }

    private var hasRowIssue: Bool {
        (tab == .today && calendarSection.value == nil && !calendarSection.isLoading)
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
        if model.taskData.value == nil, !(tab == .today && calendarSection.value == nil && calendarSection.isLoading) {
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

    private func calendarRow(_ entry: JarvisTodayCalendarEntry) -> some View {
        let notes = model.correlatedNotes(for: entry)
        return HStack(alignment: .center, spacing: JarvisPageHeaderMetrics.spacing) {
            agendaIcon("calendar")
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                Text(entry.title).font(.body).fixedSize(horizontal: false, vertical: true)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline) {
                        eventTime(entry)
                        Spacer(minLength: JarvisPageHeaderMetrics.actionSpacing)
                        Text(relativeStart(entry)).font(.footnote).foregroundStyle(.secondary)
                            .fixedSize()
                    }
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        eventTime(entry)
                        Text(relativeStart(entry)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let location = entry.location {
                    Text(location).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                ForEach(notes) { note in
                    Label(note.title, systemImage: "note.text")
                        .font(.footnote)
                        .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                        .lineLimit(1)
                }
            }
        }
        .frame(minHeight: JarvisDesignTokens.controlMinimumHeight, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(copy(.calendarEvent)): \(entry.title)")
        .accessibilityValue(([JarvisTodayGreeting.timeText(entry.start, language: language), relativeStart(entry)]
            + [entry.location].compactMap { $0 } + notes.map(\.title)).joined(separator: ", "))
        .accessibilityIdentifier("today.entry.\(entry.id)")
    }

    private func eventTime(_ entry: JarvisTodayCalendarEntry) -> some View {
        Text(JarvisTodayGreeting.timeText(entry.start, language: language))
            .font(.footnote.weight(.medium))
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .fixedSize()
    }

    private func relativeStart(_ entry: JarvisTodayCalendarEntry) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = language.locale
        formatter.unitsStyle = .short
        return formatter.localizedString(for: entry.start, relativeTo: model.now)
    }

    private var plusMenu: some View {
        JarvisMenuButton(title: copy(.add), systemImage: "plus", identifier: "today.plus") {
            Button(copy(.newTask), systemImage: "checklist") { present(.task) }
                .accessibilityIdentifier("today.plus.task")
            Button(copy(.newNote), systemImage: "note.text") { present(.note) }
                .accessibilityIdentifier("today.plus.note")
        }
    }

    private func present(_ value: Sheet) {
        Task { @MainActor in
            await Task.yield()
            sheet = value
        }
    }

    private func taskRow(_ task: VaultTask, isFirst: Bool, isLast: Bool) -> some View {
        JarvisTaskListRow(
            task: task,
            copy: JarvisNotesCopy(language: language),
            today: model.taskData.value?.today ?? "",
            isFirst: isFirst,
            isLast: isLast,
            accessibilityPrefix: "today.task",
            onOpen: { sheet = .taskDetail(task) }
        )
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

    private func expandButton(
        expansion: JarvisTodayExpansion,
        isExpanded: Bool,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Group {
            if expansion.hidden > 0 {
                JarvisLabelledButton(
                    title: isExpanded
                        ? copy(.showLess)
                        : JarvisTodayLocalization.string(.showMore, count: expansion.hidden, language: language),
                    trailingSystemImage: isExpanded ? "chevron.up" : "chevron.down",
                    identifier: identifier,
                    isFullWidth: true
                ) {
                    if reduceMotion {
                        action()
                    } else {
                        withAnimation(.snappy(duration: 0.3), action)
                    }
                }
                .padding(JarvisPageHeaderMetrics.rowInset)
            }
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

    // MARK: Quick actions

    private var quickActions: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: JarvisPageHeaderMetrics.spacing))
            : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            JarvisTileButton(
                title: copy(.logWorkout),
                subtitle: model.lastWorkoutText(language: language),
                systemImage: "figure.strengthtraining.traditional",
                identifier: "today.logWorkout"
            ) { sheet = .workout }
            JarvisTileButton(
                title: copy(.logLift),
                subtitle: model.lastLiftText(language: language),
                systemImage: "dumbbell",
                identifier: "today.logLift"
            ) { sheet = .lift }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(.quickActions))
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
                JarvisNewTaskSheet(
                    client: client,
                    copy: JarvisNotesCopy(language: language),
                    onCreated: {
                        sheet = nil
                        Task { await model.refreshTasks() }
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        case .taskDetail(let task):
            JarvisTaskDetailSheet(
                task: task,
                today: model.taskData.value?.today ?? "",
                copy: JarvisNotesCopy(language: language),
                client: model.notesClient,
                onComplete: { Task { await completeTask(task) } },
                onSaved: {
                    sheet = nil
                    successConfirmation = JarvisSuccessConfirmation(message: JarvisNotesCopy(language: language).saved)
                    Task { await model.refreshTasks() }
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        case .note:
            if let client = model.notesClient {
                JarvisNewNoteSheet(
                    client: client,
                    copy: JarvisNotesCopy(language: language),
                    initialFolder: "",
                    onCreated: { _ in
                        sheet = nil
                        successConfirmation = JarvisSuccessConfirmation(message: JarvisNotesCopy(language: language).saved)
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        case .workout, .lift:
            JarvisTodayGymSheet(
                model: model, language: language, kind: presented.id == "lift" ? .lift : .workout
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
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
