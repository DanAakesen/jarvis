import JarvisCore
import SwiftUI

/// Home: the first screen on launch. Greeting, what is next, tasks, workouts and steps, quick log, and a composer
/// that carries over into Chat and Voice.
struct JarvisTodayScreen: View {
    private enum Tab: Hashable { case today, due }

    private enum Sheet: Identifiable {
        case task, note, gym(withLift: Bool)

        var id: String {
            switch self {
            case .task: "task"
            case .note: "note"
            case .gym(let withLift): withLift ? "lift" : "workout"
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
    @State private var nextExpanded = false
    @State private var listExpanded = false
    @State private var sheet: Sheet?
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                greeting
                if model.isShowingOfflineCopy {
                    Label(copy(.offline), systemImage: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("today.offline")
                }
                nextUp
                agenda
                JarvisTodayActivityCard(model: model, language: language, fixtureMode: fixtureMode)
                quickActions
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.top, 4)
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
        .navigationTitle(JarvisDestination.today.localizedTitle(language: language))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSidebarMenuButton(language: language)
            }
        }
        .jarvisAmbientBackground(transparentNavigationBar: true)
        .task { await model.refresh() }
        .sheet(item: $sheet) { presented in
            sheetContent(presented)
        }
        .onChange(of: draft) { old, new in
            guard old.isEmpty, !new.isEmpty else { return }
            let text = new
            draft = ""
            composerFocused = false
            onChat(JarvisChatHandoff(text: text))
        }
    }

    // MARK: Greeting

    private var greeting: some View {
        let value = model.greeting(language: language)
        return JarvisTodayShimmer(isAnimated: !fixtureMode && !reduceMotion) {
            Text(attributedGreeting(value))
            .font(.title2.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
        }
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

    // MARK: Next up

    private var nextUp: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(copy(.nextUp))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            if calendarSection.value == nil, calendarSection.isLoading {
                loadingRow
            } else if let entries = calendarSection.value {
                if entries.isEmpty {
                    statusRow(copy(.nothingPlanned), systemImage: "calendar")
                } else {
                    let expansion = JarvisTodayExpansion(total: entries.count, isExpanded: nextExpanded)
                    VStack(spacing: 0) {
                        ForEach(Array(entries.prefix(expansion.visible))) { entry in
                            calendarRow(entry)
                        }
                    }
                    expandButton(
                        expansion: expansion,
                        isExpanded: nextExpanded,
                        identifier: "today.next.expand"
                    ) { nextExpanded.toggle() }
                }
            } else {
                statusRow(
                    copy(calendarSection.failure == .unavailable ? .calendarUnavailable : .loadFailed),
                    systemImage: "calendar.badge.exclamationmark",
                    retry: calendarSection.failure != .unavailable
                )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.nextUp")
    }

    private var calendarSection: JarvisTodaySection<[JarvisTodayCalendarEntry]> { model.calendar }

    private func calendarRow(_ entry: JarvisTodayCalendarEntry) -> some View {
        let notes = model.correlatedNotes(for: entry)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(JarvisTodayGreeting.timeText(entry.start, language: language))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    .frame(minWidth: 48, alignment: .leading)
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.title).font(.body).lineLimit(2)
                    if let location = entry.location {
                        Text(location).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            ForEach(notes) { note in
                Label(note.title, systemImage: "note.text")
                    .font(.footnote)
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                    .lineLimit(1)
                    .padding(.leading, 58)
            }
        }
        .frame(minHeight: 36, alignment: .leading)
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("today.entry.\(entry.id)")
    }

    // MARK: Agenda

    private var taskLists: JarvisTodayTaskLists? { model.taskData.value?.lists }

    private var visibleTasks: [VaultTask] {
        guard let lists = taskLists else { return [] }
        return tab == .today ? lists.today : lists.due
    }

    private var agenda: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                tabButton(.today, title: copy(.tabToday), count: taskLists?.today.count)
                tabButton(.due, title: copy(.tabDue), count: taskLists?.due.count)
                Spacer(minLength: 0)
                plusMenu
            }
            if model.taskData.value == nil, model.taskData.isLoading {
                loadingRow
            } else if taskLists != nil {
                let tasks = visibleTasks
                if tasks.isEmpty {
                    statusRow(copy(tab == .today ? .nothingToday : .nothingDue), systemImage: "checklist")
                } else {
                    let expansion = JarvisTodayExpansion(total: tasks.count, isExpanded: listExpanded)
                    VStack(spacing: 0) {
                        ForEach(Array(tasks.prefix(expansion.visible))) { task in
                            taskRow(task)
                        }
                    }
                    expandButton(
                        expansion: expansion,
                        isExpanded: listExpanded,
                        identifier: "today.list.expand"
                    ) { listExpanded.toggle() }
                }
            } else {
                statusRow(
                    copy(model.taskData.failure == .unavailable ? .tasksUnavailable : .loadFailed),
                    systemImage: "exclamationmark.triangle",
                    retry: model.taskData.failure != .unavailable
                )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: tab)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(.agendaAndTasks))
        .accessibilityIdentifier("today.agenda")
    }

    private func tabButton(_ value: Tab, title: String, count: Int?) -> some View {
        let label = count.map { "\(title) \($0)" } ?? title
        return Button {
            tab = value
            listExpanded = false
        } label: {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 12)
                .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                .foregroundStyle(tab == value ? JarvisDesignTokens.primaryAccent : Color.secondary)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(tab == value ? .isSelected : [])
        .accessibilityIdentifier(value == .today ? "today.tab.today" : "today.tab.due")
    }

    private var plusMenu: some View {
        Menu {
            Button(copy(.newTask), systemImage: "checklist") { present(.task) }
                .accessibilityIdentifier("today.plus.task")
            Button(copy(.newNote), systemImage: "note.text") { present(.note) }
                .accessibilityIdentifier("today.plus.note")
        } label: {
            Image(systemName: "plus")
                .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .regular))
                .foregroundStyle(JarvisDesignTokens.primaryAccent)
                .frame(
                    width: JarvisDesignTokens.chatMinimumTapTarget,
                    height: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .tint(JarvisDesignTokens.secondaryAccent)
        .menuOrder(.fixed)
        .accessibilityLabel(copy(.add))
        .accessibilityIdentifier("today.plus")
    }

    private func present(_ value: Sheet) {
        Task { @MainActor in
            await Task.yield()
            sheet = value
        }
    }

    private func taskRow(_ task: VaultTask) -> some View {
        HStack(spacing: 4) {
            Button {
                Task { await model.complete(task) }
            } label: {
                Image(systemName: "circle")
                    .font(.system(size: JarvisDesignTokens.chatComposerIconSize))
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                    .frame(
                        width: JarvisDesignTokens.chatMinimumTapTarget,
                        height: JarvisDesignTokens.chatMinimumTapTarget
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(copy(.markDone)): \(task.text)")
            .accessibilityIdentifier("today.task.done.\(task.id)")
            VStack(alignment: .leading, spacing: 0) {
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
                Button {
                    if reduceMotion {
                        action()
                    } else {
                        withAnimation(.snappy(duration: 0.3), action)
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(isExpanded
                             ? copy(.showLess)
                             : JarvisTodayLocalization.string(.showMore, count: expansion.hidden, language: language))
                        Image(systemName: "chevron.down")
                            .rotationEffect(.degrees(isExpanded ? 180 : 0))
                            .accessibilityHidden(true)
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                    .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(identifier)
            }
        }
    }

    // MARK: States

    private var loadingRow: some View {
        HStack(spacing: 8) {
            ProgressView()
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
                Button {
                    Task { await model.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .frame(
                            width: JarvisDesignTokens.chatMinimumTapTarget,
                            height: JarvisDesignTokens.chatMinimumTapTarget
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copy(.retry))
                .accessibilityIdentifier("today.retry")
            }
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
        .accessibilityElement(children: .contain)
    }

    // MARK: Quick actions

    private var quickActions: some View {
        HStack(spacing: 10) {
            quickAction(
                title: copy(.logWorkout),
                subtitle: model.lastWorkoutText(language: language),
                systemImage: "figure.strengthtraining.traditional",
                identifier: "today.logWorkout"
            ) { sheet = .gym(withLift: false) }
            quickAction(
                title: copy(.logLift),
                subtitle: nil,
                systemImage: "dumbbell",
                identifier: "today.logLift"
            ) { sheet = .gym(withLift: true) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(.quickActions))
    }

    private func quickAction(
        title: String,
        subtitle: String?,
        systemImage: String,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let subtitle {
                        Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.glass)
        .accessibilityLabel(subtitle.map { "\(title). \($0)" } ?? title)
        .accessibilityIdentifier(identifier)
    }

    // MARK: Composer

    private var composer: some View {
        HStack(spacing: 0) {
            TextField(
                JarvisChatLocalization.string(.messagePlaceholder, language: language),
                text: $draft,
                axis: .vertical
            )
            .font(.body)
            .lineLimit(1...3)
            .focused($composerFocused)
            .submitLabel(.send)
            .padding(.leading, JarvisDesignTokens.chatComposerTextInset)
            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            .accessibilityLabel(JarvisChatLocalization.string(.messagePlaceholder, language: language))
            .accessibilityIdentifier("today.input")
            Button(action: onVoice) {
                JarvisOrbView(activity: .calm, diameter: 28, usesStaticFilaments: true)
                    .jarvisCarryOver(.orb)
                    .frame(
                        width: JarvisDesignTokens.chatMinimumTapTarget,
                        height: JarvisDesignTokens.chatMinimumTapTarget
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(JarvisChatLocalization.string(.voiceMode, language: language))
            .accessibilityIdentifier("today.voice")
        }
        .padding(.horizontal, JarvisDesignTokens.chatComposerSpacing / 2)
        .background {
            Color.clear
                .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
                .jarvisRim(
                    cornerRadius: JarvisDesignTokens.surfaceRadius,
                    state: .idle,
                    isAnimated: !fixtureMode && !reduceMotion
                )
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .jarvisCarryOver(.composer)
        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
        .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
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
        case .gym(let withLift):
            JarvisTodayGymSheet(model: model, language: language, startsWithLift: withLift)
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
