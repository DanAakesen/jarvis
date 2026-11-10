import JarvisCore
import SwiftUI

struct JarvisFactoryTaskDetailView: View {
    let client: JarvisFactoryClient
    let taskID: String
    let language: JarvisAppLanguage
    var liveUpdatesEnabled = true
    var showSteeringAtLaunch = false

    @State private var task: FactoryTaskRecord?
    @State private var history: FactoryTaskHistory?
    @State private var usage: [FactoryTaskUsage] = []
    @State private var loadFailed = false
    @State private var actionFailed = false
    @State private var taskConnection: FactoryTaskConnection = .catchingUp
    @State private var eventRetryCount = 0
    @State private var loadingMoreEvents = false
    @State private var historyFailed = false
    @State private var historyPresented = false
    @State private var busyAction: FactoryTaskControl?
    @State private var steeringPresented = false
    @State private var actionCompleted = false
    @State private var loadRequest = UUID()
    @State private var loadedTaskID: String?

    private var copy: JarvisFactoryCopy { JarvisFactoryCopy(language: language) }
    private var streamIdentity: String { loadedTaskID == taskID ? "ready-\(taskID)" : "waiting-\(taskID)" }
    private var events: [FactoryTaskEvent] { history?.taskID == taskID ? history?.events ?? [] : [] }
    private var timeline: [FactoryTimelineEntry] {
        FactoryTaskTimeline.entries(events: events, taskID: taskID, language: language)
    }

    var body: some View {
        detailContent(loadedTaskID == taskID ? task : nil)
        .jarvisAmbientBackground()
        .navigationTitle(loadedTaskID == taskID ? task?.title ?? copy.text(.taskDetail) : copy.text(.taskDetail))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .environment(\.locale, language.locale)
        .task(id: taskID) { await loadTask() }
        .task(id: streamIdentity) { await listenForEvents() }
        .sheet(isPresented: $steeringPresented) {
            JarvisFactorySteerSheet(copy: copy) { message in
                await sendSteering(message)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $historyPresented) {
            timelineHistory
                .environment(\.locale, language.locale)
        }
        .accessibilityIdentifier("factory.taskDetail")
    }

    @ViewBuilder
    private func detailContent(_ task: FactoryTaskRecord?) -> some View {
        let events = self.events
        let timeline = FactoryTaskTimeline.entries(events: events, taskID: taskID, language: language)
        JarvisList {
            JarvisTaskActivityNotice(language: language)
            if loadFailed {
                FactoryStateMessage(
                    title: copy.text(.actionFailed),
                    actionTitle: copy.text(.retry),
                    action: { Task { await loadTask() } }
                )
            }
            Section(copy.text(.actions)) {
                if let task {
                if JarvisFactoryPresentation.availableControls(
                    state: task.state,
                    latestSessionEndReason: task.latestSessionEndReason
                ).isEmpty {
                    if task.state == .pauseRequested {
                        Text(copy.state(task.state))
                            .foregroundStyle(.secondary)
                    } else {
                        Text(copy.state(task.state))
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(
                        JarvisFactoryPresentation.availableControls(
                            state: task.state,
                            latestSessionEndReason: task.latestSessionEndReason
                        ),
                        id: \.rawValue
                    ) { action in
                        actionButton(action, task: task)
                    }
                }
                if let pullRequestURL = safeGitHubURL(task.pullRequest?.url) {
                    Link(destination: pullRequestURL) {
                        Label(copy.text(.openPullRequest), systemImage: "arrow.up.right.square")
                    }
                }
                if actionFailed {
                    Label(copy.text(.actionFailed), systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
                if actionCompleted {
                    Label(copy.text(.actionCompleted), systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                }
                if liveUpdatesEnabled && taskConnection != .connected {
                    Label(
                        copy.text(taskConnection == .offline ? .offline :
                            taskConnection == .catchingUp ? .eventCatchingUp : .eventReconnecting),
                        systemImage: taskConnection == .offline ? "wifi.slash" : "arrow.triangle.2.circlepath"
                    )
                    .foregroundStyle(.secondary)
                }
                } else {
                    detailPlaceholder
                }
            }

            Section(copy.text(.metadata)) {
                if let task {
                LabeledContent(copy.text(.projectLabel), value: task.projectId)
                LabeledContent(copy.text(.agentLabel), value: copy.agent(task.agent))
                LabeledContent(copy.text(.state), value: copy.state(task.state))
                if let issueNumber = task.issueNumber {
                    Text(String(format: copy.text(.issueNumber), issueNumber))
                }
                if let branch = task.branch, !branch.isEmpty {
                    LabeledContent(copy.text(.branch), value: branch)
                }
                if let pullRequest = task.pullRequest {
                    LabeledContent(copy.text(.pullRequest), value: "#\(pullRequest.number)")
                }
                if let checkConclusion = task.checkConclusion ?? task.checks {
                    LabeledContent(copy.text(.checks), value: checkLabel(checkConclusion))
                }
                if let model = task.modelOverride, !model.isEmpty {
                    LabeledContent(copy.text(.model), value: model)
                }
                if let reasoning = task.reasoningOverride, !reasoning.isEmpty {
                    LabeledContent(copy.text(.reasoning), value: reasoning)
                }
                LabeledContent(
                    copy.text(.created),
                    value: JarvisFactoryLocalization.formattedDate(task.createdAt, language: language)
                )
                if let startedAt = task.startedAt {
                    LabeledContent(
                        copy.text(.started),
                        value: JarvisFactoryLocalization.formattedDate(startedAt, language: language)
                    )
                }
                LabeledContent(copy.text(.attempts), value: task.attemptCount.formatted(.number.locale(language.locale)))
                } else {
                    ForEach([JarvisFactoryLocalizationKey.projectLabel, .agentLabel, .state, .created, .attempts], id: \.self) { key in
                        LabeledContent(copy.text(key), value: "—")
                    }
                }
            }

            Section(copy.text(.request)) {
                if let task {
                    JarvisFactoryRequestView(request: task.request, copy: copy)
                        .id(task.id)
                } else {
                    detailPlaceholder
                }
            }

            Section(copy.text(.timeline)) {
                if task != nil, history?.hasMore == true {
                    incompleteHistoryNotice
                }
                if task == nil {
                    detailPlaceholder
                } else if events.isEmpty {
                    Text(copy.text(.noEvents))
                        .foregroundStyle(.secondary)
                } else {
                    Text(String(format: copy.text(.timelineCount), locale: language.locale, events.count, timeline.count))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if timeline.contains(where: \.needsAttention) {
                        Label(
                            String(
                                format: copy.text(.timelineAttentionCount), locale: language.locale,
                                timeline.filter(\.needsAttention).reduce(0) { $0 + $1.events.count }
                            ),
                            systemImage: "exclamationmark.triangle"
                        )
                        .accessibilityIdentifier("factory.timeline.attention")
                    }
                    ForEach(FactoryTaskTimeline.preview(timeline)) { entry in
                        FactoryTimelineRow(entry: entry, copy: copy)
                    }
                }
                if task != nil, !events.isEmpty || history?.canLoadMore == true {
                    JarvisLabelledButton(
                        title: copy.text(.timelineHistory),
                        identifier: "factory.timeline.history",
                        isFullWidth: true
                    ) { historyPresented = true }
                }
            }

            Section(copy.text(.usage)) {
                if task == nil {
                    detailPlaceholder
                } else if usage.isEmpty {
                    Text(copy.text(.noUsage))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(usage, id: \.stableID) { item in
                        FactoryUsageRow(item: item, copy: copy, language: language)
                    }
                }
            }

            Section(copy.text(.artifacts)) {
                if task == nil {
                    detailPlaceholder
                } else if artifactEvents.isEmpty {
                    Text(copy.text(.noArtifacts))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(artifactEvents) { event in
                        Label(event.summary ?? copy.text(.artifacts), systemImage: "doc")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await loadTask() }
    }

    @ViewBuilder
    private var detailPlaceholder: some View {
        if loadFailed {
            Text(copy.text(.actionFailed)).foregroundStyle(.secondary)
        } else {
            JarvisLoadingView(title: copy.text(.loadingTasks), size: .inline)
        }
    }

    private var incompleteHistoryNotice: some View {
        Label(copy.text(.historyIncomplete), systemImage: "clock.badge.exclamationmark")
            .font(.callout)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("factory.timeline.incomplete")
    }

    private var timelineHistory: some View {
        let timeline = self.timeline
        return JarvisPageScaffold(
            title: copy.text(.timeline),
            language: language,
            actions: {
                JarvisSheetCloseButton(title: copy.text(.showLess)) { historyPresented = false }
            },
            headline: { EmptyView() },
            hero: { EmptyView() }
        ) {
            LazyVStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
                if history?.hasMore == true {
                    incompleteHistoryNotice
                }
                ForEach(timeline) { entry in
                    FactoryTimelineRow(entry: entry, copy: copy)
                    Divider()
                }
                if historyFailed {
                    Label(copy.text(.historyLoadFailed), systemImage: "exclamationmark.triangle")
                }
                if history?.canLoadMore == true {
                    JarvisLabelledButton(
                        title: copy.text(historyFailed ? .retry : .loadMore),
                        identifier: "factory.timeline.loadMore",
                        isBusy: loadingMoreEvents,
                        isFullWidth: true
                    ) { Task { await loadMoreEvents() } }
                } else if history?.hasMore == true {
                    Text(copy.text(.historyTruncated)).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityIdentifier("factory.timeline.detail")
    }

    @ViewBuilder
    private func actionButton(_ action: FactoryTaskControl, task: FactoryTaskRecord) -> some View {
        if action == .cancel {
            JarvisLabelledButton(
                title: copy.text(.cancelTask),
                systemImage: "xmark.circle",
                isDisabled: busyAction != nil,
                isFullWidth: true,
                isLeading: true,
                isDestructive: true
            ) { Task { await perform(FactoryTaskControlRequest(taskId: task.id, action: .cancel)) } }
        } else if action == .steer {
            JarvisLabelledButton(
                title: copy.text(.steer),
                systemImage: "text.bubble",
                isDisabled: busyAction != nil,
                isFullWidth: true,
                isLeading: true
            ) { steeringPresented = true }
        } else {
            JarvisLabelledButton(
                title: actionTitle(action),
                systemImage: actionSymbol(action),
                isBusy: busyAction == action,
                isDisabled: busyAction != nil,
                isFullWidth: true,
                isLeading: true
            ) {
                Task {
                    await perform(FactoryTaskControlRequest(taskId: task.id, action: action))
                }
            }
        }
    }

    private func loadTask() async {
        let requestedTaskID = taskID
        let request = UUID()
        loadRequest = request
        if loadedTaskID != requestedTaskID {
            task = nil
            history = FactoryTaskHistory(taskID: requestedTaskID)
            usage = []
            historyFailed = false
            historyPresented = false
            steeringPresented = false
            actionFailed = false
            actionCompleted = false
            taskConnection = .catchingUp
            eventRetryCount = 0
        }
        loadFailed = false
        do {
            let detail = try await client.task(id: requestedTaskID)
            guard !Task.isCancelled, loadRequest == request, taskID == requestedTaskID else { return }
            let firstLoad = loadedTaskID != requestedTaskID
            task = detail.task
            loadedTaskID = requestedTaskID
            history?.mergePage(detail.events, offset: 0)
            usage = detail.usage
            await JarvisFactoryLiveActivityController.update(task: detail.task, language: language)
            if firstLoad && showSteeringAtLaunch {
                steeringPresented = true
            }
        } catch {
            guard !Task.isCancelled, loadRequest == request, taskID == requestedTaskID else { return }
            loadFailed = true
        }
    }

    private func loadMoreEvents() async {
        guard !loadingMoreEvents, let history, history.taskID == taskID, history.canLoadMore else { return }
        let requestedTaskID = taskID
        let offset = history.nextOffset
        loadingMoreEvents = true
        historyFailed = false
        defer { loadingMoreEvents = false }
        do {
            let detail = try await client.task(id: requestedTaskID, eventLimit: 100, eventOffset: offset)
            guard !Task.isCancelled, loadedTaskID == requestedTaskID, taskID == requestedTaskID else { return }
            self.history?.mergePage(detail.events, offset: offset)
        } catch {
            guard !Task.isCancelled, loadedTaskID == requestedTaskID, taskID == requestedTaskID else { return }
            historyFailed = true
        }
    }

    private func listenForEvents() async {
        guard liveUpdatesEnabled, task != nil, loadedTaskID == taskID else { return }
        let requestedTaskID = taskID
        var retrySeconds = 1
        while !Task.isCancelled {
            do {
                try await client.listenForTaskEventBatches(
                    taskId: requestedTaskID,
                    after: history?.streamCursor,
                    onReplayComplete: {
                        let current = await MainActor.run {
                            guard !Task.isCancelled, taskID == requestedTaskID,
                                  loadedTaskID == requestedTaskID else { return false }
                            taskConnection = .connected
                            eventRetryCount = 0
                            return true
                        }
                        if current { await refreshTaskAfterEvents(taskID: requestedTaskID) }
                    }
                ) { batch, replaying in
                    let (stateChanged, currentTask) = await MainActor.run {
                        guard !Task.isCancelled, taskID == requestedTaskID, loadedTaskID == requestedTaskID,
                              var updatedHistory = history else {
                            return (false, Optional<FactoryTaskRecord>.none)
                        }
                        var stateChanged = false
                        for event in batch {
                            let inserted = updatedHistory.receive(event)
                            stateChanged = stateChanged || (inserted && event.type == "state_changed")
                        }
                        history = updatedHistory
                        return (!replaying && stateChanged, replaying ? nil : task)
                    }
                    if let currentTask {
                        await JarvisFactoryLiveActivityController.update(
                            task: currentTask,
                            activityText: batch.last?.summary,
                            language: language
                        )
                    }
                    if stateChanged {
                        await refreshTaskAfterEvents(taskID: requestedTaskID)
                    }
                }
                guard !Task.isCancelled, taskID == requestedTaskID, loadedTaskID == requestedTaskID else { return }
                eventRetryCount += 1
                taskConnection = .reconnecting
            } catch {
                guard !Task.isCancelled, taskID == requestedTaskID, loadedTaskID == requestedTaskID else { return }
                eventRetryCount += 1
                taskConnection = eventRetryCount >= 3 ? .offline : .reconnecting
            }
            do {
                try await Task.sleep(for: .seconds(retrySeconds))
            } catch {
                return
            }
            retrySeconds = min(retrySeconds * 2, 15)
        }
    }

    private func refreshTaskAfterEvents(taskID requestedTaskID: String) async {
        let refreshRequest = loadRequest
        do {
            let detail = try await client.task(id: requestedTaskID)
            let applied = await MainActor.run {
                guard !Task.isCancelled, taskID == requestedTaskID,
                      loadedTaskID == requestedTaskID, loadRequest == refreshRequest else { return false }
                task = detail.task
                usage = detail.usage
                history?.mergePage(detail.events, offset: 0)
                return true
            }
            if applied {
                await JarvisFactoryLiveActivityController.update(task: detail.task, language: language)
            }
        } catch {
            await MainActor.run {
                guard !Task.isCancelled, taskID == requestedTaskID,
                      loadedTaskID == requestedTaskID, loadRequest == refreshRequest else { return }
                actionFailed = true
            }
        }
    }

    private func perform(_ request: FactoryTaskControlRequest) async {
        guard busyAction == nil, taskID == request.taskId, loadedTaskID == request.taskId else { return }
        loadRequest = UUID()
        busyAction = request.action
        actionFailed = false
        actionCompleted = false
        defer { busyAction = nil }
        do {
            let result = try await client.controlTask(request, confirm: false)
            guard !Task.isCancelled, taskID == request.taskId, loadedTaskID == request.taskId else { return }
            loadRequest = UUID()
            task = result
            actionCompleted = true
        } catch {
            guard !Task.isCancelled, taskID == request.taskId, loadedTaskID == request.taskId else { return }
            actionFailed = true
        }
    }

    private func sendSteering(_ message: String) async -> Bool {
        guard let task, task.id == taskID, loadedTaskID == taskID else { return false }
        await perform(FactoryTaskControlRequest(taskId: task.id, action: .steer, message: message))
        return !actionFailed
    }

    private var artifactEvents: [FactoryTaskEvent] {
        events.filter { $0.type.localizedCaseInsensitiveContains("artifact") }
    }

    private func actionTitle(_ action: FactoryTaskControl) -> String {
        switch action {
        case .steer: copy.text(.steer)
        case .pause: copy.text(.pause)
        case .resume: copy.text(.resume)
        case .cancel: copy.text(.cancelTask)
        case .recover:
            task?.latestSessionEndReason == .idleExpired
                ? copy.text(.continueTask)
                : copy.text(.recover)
        }
    }

    private func actionSymbol(_ action: FactoryTaskControl) -> String {
        switch action {
        case .steer: "text.bubble"
        case .pause: "pause.circle"
        case .resume: "play.circle"
        case .cancel: "xmark.circle"
        case .recover: "arrow.clockwise.circle"
        }
    }

    private func checkLabel(_ value: String) -> String {
        switch value.lowercased() {
        case "success", "successful", "passed", "passing", "completed": copy.text(.checksPassed)
        case "failure", "failed", "failing", "error": copy.text(.checksFailed)
        case "none": copy.text(.checksNone)
        default: copy.text(.checksPending)
        }
    }

    private func safeGitHubURL(_ value: String?) -> URL? {
        guard let value,
              let url = URL(string: value),
              url.scheme == "https",
              url.host == "github.com" else { return nil }
        return url
    }
}

private enum FactoryTaskConnection: Equatable {
    case catchingUp
    case connected
    case reconnecting
    case offline
}

private struct FactoryTimelineRow: View {
    let entry: FactoryTimelineEntry
    let copy: JarvisFactoryCopy
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
            DisclosureGroup(isExpanded: $expanded) {
                Text(verbatim: entry.text)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                DisclosureGroup(copy.text(.eventDiagnostics)) {
                    ForEach(entry.events) { event in
                        VStack(alignment: .leading) {
                            Text(verbatim: "#\(event.id) · \(event.type) · \(event.source.rawValue)")
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                            Text(timestamp(event.at))
                                .font(.caption)
                            if FactoryTaskTimeline.payloadUnavailable(event) {
                                Text(copy.text(.eventPayloadTruncated)).font(.caption)
                            }
                        }
                    }
                }
            } label: {
                Label {
                    Text(verbatim: entry.text)
                        .lineLimit(3)
                } icon: {
                    Image(systemName: entry.needsAttention ? "exclamationmark.triangle" : "text.bubble")
                }
                .font(.body)
            }
            .accessibilityIdentifier("factory.timeline.entry.\(entry.id)")
            Text(timestamp(entry.events.first?.at ?? ""))
                .font(.caption)
                .foregroundStyle(.secondary)
            if let last = entry.events.last, last.at != entry.events.first?.at {
                Text("– \(timestamp(last.at))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if entry.events.count > 1 {
                Text(String(format: copy.text(.eventCount), locale: copy.language.locale, entry.events.count))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
    }

    private func timestamp(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        return date?.formatted(
            .dateTime.year().month(.abbreviated).day().hour().minute().second().locale(copy.language.locale)
        ) ?? value
    }
}

private struct FactoryUsageRow: View {
    let item: FactoryTaskUsage
    let copy: JarvisFactoryCopy
    let language: JarvisAppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
            HStack {
                Text(sourceName)
                Spacer()
                Text(item.quantity.formatted(.number.precision(.fractionLength(0...2)).locale(language.locale)))
            }
            HStack {
                Text(metricName)
                Spacer()
                if let cost = item.costDkk {
                    Text(cost.formatted(.currency(code: "DKK").locale(language.locale)))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if item.estimated {
                Text(copy.text(.estimated))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
    }

    private var sourceName: String {
        switch item.source {
        case .sandbox: copy.text(.sandbox)
        case .jarvisModel: copy.text(.jarvisModel)
        case .voice: copy.text(.voice)
        case .codex: copy.text(.codex)
        case .copilot: copy.text(.copilot)
        }
    }

    private var metricName: String {
        switch item.metric {
        case .minutes: copy.text(.minutes)
        case .inputTokens: copy.text(.inputTokens)
        case .outputTokens: copy.text(.outputTokens)
        case .turns: copy.text(.turns)
        case .premiumRequests: copy.text(.premiumRequests)
        }
    }
}

private struct JarvisFactorySteerSheet: View {
    let copy: JarvisFactoryCopy
    let onSend: (String) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var sending = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section {
                    TextField(copy.text(.steeringMessage), text: $message, axis: .vertical)
                        .lineLimit(JarvisDesignTokens.factoryMultilineMinimumLines...JarvisDesignTokens.factoryMultilineMaximumLines)
                        .accessibilityLabel(copy.text(.steeringMessage))
                }
                if failed {
                    Text(copy.text(.actionFailed))
                        .foregroundStyle(.red)
                }
            }
            .navigationTitle(copy.text(.steer))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: copy.text(.sendSteering),
                    closeTitle: copy.text(.cancel),
                    isWorking: sending,
                    isConfirmDisabled: message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    onConfirm: { Task { await send() } },
                    onClose: { dismiss() }
                )
            }
            .environment(\.locale, copy.language.locale)
        }
    }

    private func send() async {
        guard !sending else { return }
        sending = true
        failed = false
        let succeeded = await onSend(message)
        sending = false
        if succeeded {
            dismiss()
        } else {
            failed = true
        }
    }
}
