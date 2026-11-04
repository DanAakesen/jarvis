import JarvisCore
import SwiftUI

/// The Proactive page: when Jarvis last checked and will next check, the suggestions it found, which sources it
/// reads and the monthly budget. Status and open items refresh every 10 seconds while the page is on screen
/// and the app is active, and stop otherwise.
/// HIG: Disclosure controls, Segmented controls, Sheets, Loading, Notifications. API: Task, ScenePhase, ProgressView.
struct JarvisProactiveArea: View {
    let client: JarvisProactiveClient?
    let language: JarvisAppLanguage
    let onRetryConfiguration: () -> Void
    /// Turns a suggestion into a task through the Notes client; the backend has no proactive route for it.
    let addTask: (JarvisProactiveItem) async throws -> Void
    var liveUpdates = true
    /// A fixed clock for fixtures; `nil` follows the real time.
    var fixedNow: Date?

    private enum Tab: String, CaseIterable, Identifiable {
        case open
        case earlier

        var id: String { rawValue }
    }

    private struct PollKey: Hashable {
        let active: Bool
        let token: Int
    }

    private struct EditorRequest: Identifiable {
        let id = UUID()
        let focus: JarvisProactiveSettingsSheet.Focus
    }

    private enum CheckMessage {
        case started
        case failed
    }

    @Environment(\.scenePhase) private var scenePhase
    @State private var status: JarvisInsightsLoad<JarvisProactiveStatus> = .loading
    @State private var openItems: [JarvisProactiveItem] = []
    @State private var itemsFailure: JarvisInsightsFailure?
    @State private var earlierItems: JarvisInsightsLoad<[JarvisProactiveItem]> = .loading
    @State private var runs: [JarvisProactiveRun] = []
    @State private var tab = Tab.open
    @State private var expandedID: String?
    @State private var busyIDs: Set<String> = []
    @State private var addedTaskIDs: Set<String> = []
    @State private var actionFailed = false
    @State private var checkingNow = false
    @State private var checkMessage: CheckMessage?
    @State private var editorRequest: EditorRequest?
    @State private var reloadToken = 0

    private var now: Date { fixedNow ?? Date() }

    private func text(_ key: JarvisInsightsLocalizationKey) -> String {
        jarvisInsightsText(key, language)
    }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.healthRowSpacing) {
            JarvisPageHeader(
                title: JarvisDestination.proactive.localizedTitle(language: language),
                language: language
            ) {
                JarvisIconButton(
                    title: text(.proactiveSettings),
                    systemImage: "gearshape",
                    identifier: "proactive.settings",
                    isDisabled: client == nil
                ) { editorRequest = EditorRequest(focus: .top) }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                    if case .loaded(let loaded) = status {
                        JarvisPageHeadline(
                            phrase: JarvisProactivePagePhrase.make(status: loaded, openItems: openItems.count, language: language)
                        )
                    }
                    content
                }
                    .padding(.horizontal)
                    .padding(.bottom, JarvisDesignTokens.healthSectionSpacing)
            }
            .accessibilityIdentifier("proactive.scroll")
        }
        .jarvisAmbientBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: PollKey(active: scenePhase == .active, token: reloadToken)) { await poll() }
        .task(id: tab) { await loadEarlierIfNeeded() }
        .sheet(item: $editorRequest) { request in
            JarvisProactiveSettingsSheet(
                client: client,
                language: language,
                focus: request.focus,
                onSaved: { Task { await settingsSaved() } }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: Loading

    private func poll() async {
        guard scenePhase == .active else { return }
        await refresh(initial: true)
        guard liveUpdates else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: JarvisProactiveLogic.refreshInterval)
            if Task.isCancelled { return }
            await refresh(initial: false)
        }
    }

    private func capture<Value>(_ work: () async throws -> Value) async -> Result<Value, Error> {
        do { return .success(try await work()) } catch { return .failure(error) }
    }

    private func refresh(initial: Bool) async {
        guard let client else {
            status = .failed(.notConfigured)
            return
        }
        var previous: JarvisProactiveStatus?
        if case .loaded(let value) = status { previous = value } else { status = .loading }
        async let statusResult = capture { try await client.status() }
        async let itemsResult = capture { try await client.items(all: false) }
        let (loadedStatus, loadedItems) = await (statusResult, itemsResult)
        if Task.isCancelled { return }
        switch loadedStatus {
        case .success(let value):
            status = .loaded(value)
            if initial || previous?.lastRun != value.lastRun { await loadRuns(client) }
            if checkMessage == .started, value.lastRun?.status != .running { checkMessage = nil }
        case .failure(let error):
            let failure = JarvisInsightsFailure(error)
            if previous == nil || failure == .unavailable || failure == .signInRequired {
                status = .failed(failure)
            } else if let previous {
                status = .loaded(previous)
            }
        }
        switch loadedItems {
        case .success(let value):
            openItems = value
            itemsFailure = nil
        case .failure(let error):
            itemsFailure = JarvisInsightsFailure(error)
        }
    }

    private func loadRuns(_ client: JarvisProactiveClient) async {
        if let loaded = try? await client.runs(limit: 10) { runs = loaded }
    }

    private func loadEarlierIfNeeded() async {
        guard tab == .earlier, let client else { return }
        if case .loaded = earlierItems { return }
        earlierItems = .loading
        do {
            let all = try await client.items(all: true)
            if Task.isCancelled { return }
            earlierItems = .loaded(JarvisProactiveLogic.earlier(all: all, open: openItems))
        } catch {
            if Task.isCancelled { return }
            earlierItems = .failed(JarvisInsightsFailure(error))
        }
    }

    private func settingsSaved() async {
        earlierItems = .loading
        await refresh(initial: false)
        if tab == .earlier { await loadEarlierIfNeeded() }
    }

    private func checkNow() async {
        guard let client else { return }
        checkingNow = true
        defer { checkingNow = false }
        do {
            try await client.checkNow()
            checkMessage = .started
        } catch {
            checkMessage = .failed
        }
        await refresh(initial: false)
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        switch status {
        case .loading:
            JarvisInsightsStateView(kind: .loading, language: language, identifier: "proactive.loading")
        case .failed(let failure):
            JarvisInsightsStateView(
                kind: .failure(failure),
                message: failureMessage(failure),
                language: language,
                identifier: "proactive.error"
            ) {
                if client == nil { onRetryConfiguration() }
                reloadToken += 1
            }
        case .loaded(let loaded):
            VStack(spacing: JarvisDesignTokens.healthSectionSpacing) {
                nextCheckCard(loaded)
                itemsCard
                sourcesCard(loaded)
                budgetCard(loaded.budget)
                runsCard
            }
        }
    }

    private func failureMessage(_ failure: JarvisInsightsFailure) -> String? {
        switch failure {
        case .unavailable: text(.proactiveUnavailable)
        case .signInRequired: text(.proactiveSignIn)
        default: nil
        }
    }

    // MARK: Next check

    private func dateTime(_ date: Date) -> String {
        let sameDay = JarvisInsightsDates.dayKey(date) == JarvisInsightsDates.dayKey(now)
        return JarvisInsightsDates.format(date, language: language, dateStyle: sameDay ? .none : .short, timeStyle: .short)
    }

    private func sentence(_ status: JarvisProactiveStatus) -> String {
        switch JarvisProactiveLogic.statusLine(status) {
        case .checking:
            return text(.proactiveSentenceChecking)
        case .paused:
            return text(.proactiveSentencePaused)
        case .quietHours(let next):
            guard let next else { return text(.proactiveSentenceQuietNoSlot) }
            return JarvisInsightsLocalization.format(.proactiveSentenceQuiet, language: language, dateTime(next))
        case .nextCheck(let date):
            return JarvisInsightsLocalization.format(.proactiveSentenceNext, language: language, dateTime(date))
        case .none:
            return text(.proactiveSentenceNone)
        }
    }

    private func lastCheckLine(_ status: JarvisProactiveStatus) -> String {
        guard let run = status.lastRun,
              let when = JarvisInsightsDates.parse(run.occurredAt) else { return text(.proactiveNoCheckYet) }
        let elapsed = JarvisInsightsDates.elapsed(from: when, now: now, language: language)
        var line = JarvisInsightsLocalization.format(.proactiveLastCheck, language: language, elapsed)
        if run.status == .done {
            line += " · " + findings(run.findingCount)
        } else {
            line += " · " + text(run.status.localizationKey)
        }
        return line
    }

    private func findings(_ count: Int) -> String {
        count == 1
            ? text(.proactiveFinding)
            : JarvisInsightsLocalization.format(.proactiveFindings, language: language, count)
    }

    private func nextCheckCard(_ loaded: JarvisProactiveStatus) -> some View {
        JarvisInsightsCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(sentence(loaded))
                    .font(.subheadline.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("proactive.sentence")
                Text(lastCheckLine(loaded))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("proactive.lastCheck")
                HStack(spacing: 8) {
                    JarvisLabelledButton(
                        title: checkingNow ? text(.proactiveChecking) : text(.proactiveCheckNow),
                        systemImage: "sparkle.magnifyingglass",
                        identifier: "proactive.checkNow",
                        isBusy: checkingNow,
                        isDisabled: !JarvisProactiveLogic.canCheckNow(loaded)
                    ) {
                        Task { await checkNow() }
                    }
                    if loaded.paused {
                        JarvisInsightsBadge(title: text(.proactivePausedBanner), systemImage: "pause.circle")
                            .accessibilityIdentifier("proactive.paused")
                    } else if loaded.quietNow {
                        JarvisInsightsBadge(title: text(.proactiveQuietBanner), systemImage: "moon.zzz")
                            .accessibilityIdentifier("proactive.quiet")
                    }
                    Spacer(minLength: 0)
                }
                if let checkMessage {
                    Text(checkMessage == .started ? text(.proactiveCheckStarted) : text(.proactiveCheckFailed))
                        .font(.caption)
                        .foregroundStyle(checkMessage == .started ? Color.secondary : Color.red)
                        .accessibilityIdentifier("proactive.checkMessage")
                }
            }
        }
    }

    // MARK: Items

    private var itemsCard: some View {
        JarvisInsightsCard {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
                JarvisTabStrip(
                    title: text(.proactiveTabs),
                    identifierPrefix: "proactive.tabs",
                    items: [
                        JarvisTabItem(tag: Tab.open, title: text(.proactiveTabOpen)),
                        JarvisTabItem(tag: Tab.earlier, title: text(.proactiveTabEarlier)),
                    ],
                    selection: $tab
                )
                if actionFailed {
                    JarvisInsightsBadge(
                        title: text(.proactiveActionFailed),
                        systemImage: "exclamationmark.triangle",
                        tint: .red
                    )
                    .accessibilityIdentifier("proactive.actionFailed")
                }
                if tab == .open {
                    openList
                } else {
                    earlierList
                }
            }
        }
    }

    @ViewBuilder private var openList: some View {
        if openItems.isEmpty, let itemsFailure {
            JarvisInsightsStateView(kind: .failure(itemsFailure), language: language, identifier: "proactive.items.error") {
                reloadToken += 1
            }
        } else if openItems.isEmpty {
            JarvisInsightsStateView(
                kind: .empty,
                emptyTitle: text(.proactiveEmpty),
                language: language,
                identifier: "proactive.empty"
            )
        } else {
            VStack(spacing: 0) {
                ForEach(openItems) { item in itemRow(item, actionable: true) }
            }
            .accessibilityIdentifier("proactive.items")
        }
    }

    @ViewBuilder private var earlierList: some View {
        switch earlierItems {
        case .loading:
            JarvisInsightsStateView(kind: .loading, language: language, identifier: "proactive.earlier.loading")
        case .failed(let failure):
            JarvisInsightsStateView(kind: .failure(failure), language: language, identifier: "proactive.earlier.error") {
                earlierItems = .loading
                Task { await loadEarlierIfNeeded() }
            }
        case .loaded(let items):
            if items.isEmpty {
                JarvisInsightsStateView(
                    kind: .empty,
                    emptyTitle: text(.proactiveEmptyEarlier),
                    language: language,
                    identifier: "proactive.earlier.empty"
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(items) { item in itemRow(item, actionable: false) }
                }
                .accessibilityIdentifier("proactive.earlier")
            }
        }
    }

    private func meta(_ item: JarvisProactiveItem, actionable: Bool) -> String {
        var parts: [String] = []
        if actionable, item.state == .new { parts.append(text(.proactiveNew)) }
        parts.append(text(item.urgency.localizationKey))
        if let category = item.category { parts.append(text(category.localizationKey)) }
        if let due = item.dueAt.flatMap(JarvisInsightsDates.parse) {
            parts.append(JarvisInsightsLocalization.format(.proactiveDue, language: language, dateTime(due)))
        }
        if !actionable, item.state == .snoozed, let until = item.snoozedUntil.flatMap(JarvisInsightsDates.parse) {
            parts.append(JarvisInsightsLocalization.format(.proactiveSnoozedUntil, language: language, dateTime(until)))
        }
        return parts.joined(separator: " · ")
    }

    private func urgencySymbol(_ urgency: JarvisProactiveUrgency) -> (name: String, tint: Color) {
        switch urgency {
        case .timeCritical: ("exclamationmark.circle.fill", JarvisDesignTokens.primaryAccent)
        case .normal: ("circle", JarvisDesignTokens.secondaryAccent)
        case .fyi: ("info.circle", JarvisDesignTokens.secondaryAccent)
        }
    }

    private func itemRow(_ item: JarvisProactiveItem, actionable: Bool) -> some View {
        let isExpanded = expandedID == item.id
        let symbol = urgencySymbol(item.urgency)
        let summary = meta(item, actionable: actionable)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                toggle(item, actionable: actionable)
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: symbol.name)
                        .foregroundStyle(symbol.tint)
                        .frame(width: 24, height: 24)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(isExpanded ? nil : 2)
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        .frame(height: 24)
                        .accessibilityHidden(true)
                }
                .padding(.vertical, 6)
                .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(item.title + ", " + summary)
            .accessibilityValue(isExpanded ? "1" : "0")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("proactive.item.\(item.id)")
            if isExpanded {
                expanded(item, actionable: actionable)
                    .padding(.leading, 34)
                    .padding(.bottom, 10)
            }
        }
    }

    private func expanded(_ item: JarvisProactiveItem, actionable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.body)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("proactive.body.\(item.id)")
            ForEach(Array(item.evidence.prefix(3).enumerated()), id: \.offset) { _, evidence in
                Text(evidence.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if actionable {
                let added = item.todoAdded || addedTaskIDs.contains(item.id)
                let busy = busyIDs.contains(item.id)
                HStack(spacing: 8) {
                    JarvisIconButton(
                        title: added ? text(.proactiveTodoAdded) : text(.proactiveAddToTasks),
                        systemImage: added ? "checkmark.circle" : "checklist",
                        identifier: "proactive.addTask.\(item.id)",
                        isDisabled: added || busy
                    ) { Task { await addToTasks(item) } }
                    JarvisIconButton(
                        title: text(.proactiveSnooze),
                        systemImage: "moon.zzz",
                        identifier: "proactive.snooze.\(item.id)",
                        isDisabled: busy
                    ) {
                        Task {
                            await perform(.snooze(until: JarvisProactiveLogic.snoozeTimestamp(now: now)), on: item)
                        }
                    }
                    JarvisIconButton(
                        title: text(.proactiveDismiss),
                        systemImage: "xmark",
                        identifier: "proactive.dismiss.\(item.id)",
                        isDisabled: busy
                    ) { Task { await perform(.dismiss, on: item) } }
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func toggle(_ item: JarvisProactiveItem, actionable: Bool) {
        if expandedID == item.id {
            expandedID = nil
            return
        }
        expandedID = item.id
        if actionable, item.state == .new {
            Task { await perform(.seen, on: item) }
        }
    }

    private func perform(_ action: JarvisProactiveItemAction, on item: JarvisProactiveItem) async {
        guard let client, !busyIDs.contains(item.id) else { return }
        busyIDs.insert(item.id)
        defer { busyIDs.remove(item.id) }
        do {
            let updated = try await client.apply(action, to: item.id)
            if case .seen = action {
                if let index = openItems.firstIndex(where: { $0.id == item.id }) { openItems[index] = updated }
            } else {
                openItems.removeAll { $0.id == item.id }
                if expandedID == item.id { expandedID = nil }
                earlierItems = .loading
            }
            actionFailed = false
        } catch {
            actionFailed = true
        }
    }

    private func addToTasks(_ item: JarvisProactiveItem) async {
        guard !busyIDs.contains(item.id) else { return }
        busyIDs.insert(item.id)
        defer { busyIDs.remove(item.id) }
        do {
            try await addTask(item)
            addedTaskIDs.insert(item.id)
            actionFailed = false
        } catch {
            actionFailed = true
        }
    }

    // MARK: Sources, budget and runs

    private func sourcesCard(_ loaded: JarvisProactiveStatus) -> some View {
        JarvisInsightsCard(
            title: text(.proactiveSources),
            accessory: AnyView(
                JarvisIconButton(
                    title: text(.editorEditSources),
                    systemImage: "pencil",
                    identifier: "proactive.editSources"
                ) { editorRequest = EditorRequest(focus: .sources) }
            )
        ) {
            VStack(spacing: 0) {
                ForEach(loaded.sources) { source in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(text(source.id.localizationKey))
                            .font(.subheadline)
                            .layoutPriority(1)
                        Spacer(minLength: 8)
                        Text(sourceLine(source))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(2)
                    }
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("proactive.source.\(source.id.rawValue)")
                }
            }
        }
    }

    private func sourceLine(_ source: JarvisProactiveSourceStatus) -> String {
        let observed = source.observedAt.flatMap(JarvisInsightsDates.parse)
            .map { JarvisInsightsDates.elapsed(from: $0, now: now, language: language) }
        switch source.state {
        case "disabled":
            return text(.proactiveSourceOff)
        case "not_run":
            return text(.proactiveSourceNotRun)
        case "unavailable":
            return JarvisInsightsLocalization.format(
                .proactiveSourceUnavailable,
                language: language,
                text(JarvisProactiveLogic.sourceReason(source.reason))
            )
        case "stale":
            return observed.map { JarvisInsightsLocalization.format(.proactiveSourceStale, language: language, $0) }
                ?? text(.proactiveSourceStale).replacingOccurrences(of: "%@", with: "")
        case "ok":
            return observed.map { JarvisInsightsLocalization.format(.proactiveSourceRead, language: language, $0) }
                ?? text(.proactiveSourceReadRecently)
        default:
            return text(.proactiveReasonUnknown)
        }
    }

    private func money(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).locale(language.locale)) + " " + text(.currencyUnit)
    }

    private func budgetCard(_ budget: JarvisProactiveBudget) -> some View {
        let tint: Color = budget.state == .exhausted ? .red : JarvisDesignTokens.primaryAccent
        return JarvisInsightsCard(
            title: text(.proactiveBudget),
            accessory: AnyView(
                JarvisIconButton(
                    title: text(.editorEditBudget),
                    systemImage: "pencil",
                    identifier: "proactive.editBudget"
                ) { editorRequest = EditorRequest(focus: .budget) }
            )
        ) {
            VStack(alignment: .leading, spacing: 8) {
                ProgressView(value: budget.usedFraction)
                    .tint(tint)
                    .accessibilityHidden(true)
                Text(
                    JarvisInsightsLocalization.format(
                        .proactiveBudgetSpend,
                        language: language,
                        money(budget.estimatedSpendDkk),
                        money(budget.monthlyLimitDkk)
                    )
                )
                .font(.subheadline.weight(.medium))
                .accessibilityIdentifier("proactive.budget.spend")
                Text(text(budget.state.localizationKey))
                    .font(.caption)
                    .foregroundStyle(budget.state == .exhausted ? Color.red : Color.secondary)
                    .accessibilityIdentifier("proactive.budget.state")
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("proactive.budget")
        }
    }

    private var runsCard: some View {
        JarvisInsightsCard(title: text(.proactiveRecentChecks)) {
            if runs.isEmpty {
                Text(text(.proactiveNoRuns))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(runs.prefix(5)) { run in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 8) {
                                Text(runTrigger(run))
                                    .font(.subheadline)
                                    .layoutPriority(1)
                                Spacer(minLength: 8)
                                Text(text(run.status.localizationKey))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Text(runDetail(run))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityElement(children: .combine)
                    }
                }
                .accessibilityIdentifier("proactive.runs")
            }
        }
    }

    private func runTrigger(_ run: JarvisProactiveRun) -> String {
        switch run.trigger {
        case "manual": text(.proactiveRunManual)
        case "catchup": text(.proactiveRunCatchup)
        default: text(.proactiveRunScheduled)
        }
    }

    private func runDetail(_ run: JarvisProactiveRun) -> String {
        var parts: [String] = []
        if let when = JarvisInsightsDates.parse(run.occurredAt) {
            parts.append(JarvisInsightsDates.elapsed(from: when, now: now, language: language))
        }
        if run.status == .done { parts.append(findings(run.findingCount)) }
        return parts.joined(separator: " · ")
    }
}
