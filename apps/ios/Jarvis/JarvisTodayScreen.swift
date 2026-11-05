import JarvisCore
import SwiftUI

/// Home: the first screen on launch. No title: the data-phrase headline sits at the top, then the activity hero
/// (workouts and steps), what is next, tasks, quick log, and the Chat composer that carries over into Chat and Voice.
struct JarvisTodayScreen: View {
    private enum Tab: Hashable { case today, due }

    private enum Sheet: Identifiable {
        case task, note, workout, lift

        var id: String {
            switch self {
            case .task: "task"
            case .note: "note"
            case .workout: "workout"
            case .lift: "lift"
            }
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let fixtureMode: Bool
    let onChat: (JarvisChatHandoff) -> Void
    let onVoice: () -> Void

    @State private var tab: Tab = .today
    @State private var listExpanded = false
    @State private var sheet: Sheet?
    @State private var draft = ""
    @StateObject private var dictation = ChatDictation()
    @State private var dictationFailed = false
    @State private var flyingText: String?
    @State private var flightRisen = false
    @ScaledMetric(relativeTo: .largeTitle) private var greetingSize: CGFloat = 25
    @FocusState private var composerFocused: Bool

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                greeting
                JarvisTodayActivityCard(model: model, language: language, fixtureMode: fixtureMode)
                if model.isShowingOfflineCopy {
                    Label(copy(.offline), systemImage: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("today.offline")
                }
                quickActions
                agenda
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { model.activity.clearSelection() }
                    .accessibilityHidden(true)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .toolbar(.hidden, for: .navigationBar)
        .jarvisAmbientBackground()
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
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 12)
        .padding(.bottom, 16)
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

    private var agenda: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: JarvisDesignTokens.segmentedBarSpacing) {
                tabControl
                plusMenu
            }
            dayCard
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: tab)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(.agendaAndTasks))
        .accessibilityIdentifier("today.agenda")
    }

    private var tabControl: some View {
        let today = rows(for: .today).count
        let due = taskLists?.due.count
        return JarvisSegmentedBar(
            title: copy(.agendaAndTasks),
            identifierPrefix: "today.tab",
            items: [
                JarvisTabItem(tag: Tab.today, title: "\(copy(.tabToday)) \(today)", identifier: "today.tab.today"),
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
            return (taskLists?.due ?? []).map(DayRow.task)
        }
    }

    private var dayCard: some View {
        let visibleRows = rows(for: tab)
        let expansion = JarvisTodayExpansion(total: visibleRows.count, isExpanded: listExpanded)
        return JarvisRowGroup {
            if tab == .today { calendarIssue }
            taskIssue
            if visibleRows.isEmpty {
                if !isLoadingRows, !hasRowIssue {
                    statusRow(
                        copy(tab == .today ? .nothingToday : .nothingDue),
                        systemImage: tab == .today ? "calendar" : "checklist"
                    )
                    .jarvisListRow(separator: false)
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(visibleRows.prefix(expansion.visible).enumerated()), id: \.element.id) { index, row in
                        Group {
                            switch row {
                            case .entry(let entry): calendarRow(entry)
                            case .task(let task): taskRow(task)
                            }
                        }
                        .jarvisListRow(separator: index < expansion.visible - 1)
                    }
                }
                expandButton(
                    expansion: expansion,
                    isExpanded: listExpanded,
                    identifier: "today.list.expand"
                ) { listExpanded.toggle() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.nextUp")
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
        return VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(JarvisTodayGreeting.timeText(entry.start, language: language))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    .frame(minWidth: 48, alignment: .leading)
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    Text(entry.title).font(.body).lineLimit(2)
                    if let location = entry.location {
                        Text(location).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(relativeStart(entry))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            ForEach(notes) { note in
                Label(note.title, systemImage: "note.text")
                    .font(.footnote)
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                    .lineLimit(1)
                    .padding(.leading, 58)
            }
        }
        .frame(minHeight: JarvisDesignTokens.controlMinimumHeight, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("today.entry.\(entry.id)")
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

    private func taskRow(_ task: VaultTask) -> some View {
        HStack(spacing: 4) {
            JarvisCheckButton(
                title: "\(copy(.markDone)): \(task.text)",
                identifier: "today.task.done.\(task.id)"
            ) { Task { await model.complete(task) } }
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                Text(task.text).font(.body).lineLimit(2)
                if let due = dueText(task) {
                    Text(due)
                        .font(.footnote)
                        .foregroundStyle(isOverdue(task) ? JarvisDesignTokens.primaryAccent : Color.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.task.\(task.id)")
    }

    private func isOverdue(_ task: VaultTask) -> Bool {
        guard let due = task.dueDate, let today = model.taskData.value?.today else { return false }
        return due < today
    }

    private func dueText(_ task: VaultTask) -> String? {
        guard let due = task.dueDate else { return nil }
        if isOverdue(task) { return copy(.overdue) + " · " + due }
        if let time = task.dueTime { return due + " " + time }
        return tab == .due ? due : task.dueTime
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
        HStack(spacing: 10) {
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
        let text = draft
        draft = ""
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
        let text = draft
        draft = ""
        composerFocused = false
        onChat(JarvisChatHandoff(text: text, action: action))
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
                    locale: Locale(identifier: language == .da ? "da-DK" : "en-GB"),
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
                text: $draft,
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
                        languageDisabled: fixtureMode,
                        screenShareDisabled: fixtureMode,
                        videoDisabled: fixtureMode,
                        attachDisabled: fixtureMode,
                        cameraDisabled: fixtureMode,
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
        case .note:
            if let client = model.notesClient {
                JarvisNewNoteSheet(
                    client: client,
                    copy: JarvisNotesCopy(language: language),
                    initialFolder: "",
                    onCreated: { _ in sheet = nil }
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
