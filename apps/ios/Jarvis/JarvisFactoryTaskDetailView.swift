import JarvisCore
import SwiftUI

struct JarvisFactoryTaskDetailView: View {
    let client: JarvisFactoryClient
    let taskID: String
    let language: JarvisAppLanguage
    var liveUpdatesEnabled = true
    var showSteeringAtLaunch = false

    @State private var task: FactoryTaskRecord?
    @State private var events: [FactoryTaskEvent] = []
    @State private var usage: [FactoryTaskUsage] = []
    @State private var loading = true
    @State private var loadFailed = false
    @State private var actionFailed = false
    @State private var taskConnection: FactoryTaskConnection = .connected
    @State private var eventRetryCount = 0
    @State private var lastEventID: String?
    @State private var loadingMoreEvents = false
    @State private var hasMoreEvents = false
    @State private var busyAction: FactoryTaskControl?
    @State private var steeringPresented = false
    @State private var cancelPresented = false
    @State private var confirmationPresented = false
    @State private var pendingConfirmation: FactoryTaskControlRequest?
    @State private var pendingConfirmationReason = ""
    @State private var actionCompleted = false

    private var copy: JarvisFactoryCopy { JarvisFactoryCopy(language: language) }
    private var streamIdentity: String { task == nil ? "waiting" : "ready-\(taskID)" }

    var body: some View {
        Group {
            if loading && task == nil {
                FactoryLoadingView(copy: copy, releases: false)
            } else if loadFailed && task == nil {
                FactoryStateMessage(
                    title: copy.text(.actionFailed),
                    actionTitle: copy.text(.retry),
                    action: { Task { await loadTask() } }
                )
            } else if let task {
                detailContent(task)
            } else {
                FactoryStateMessage(title: copy.text(.taskDetail))
            }
        }
        .jarvisAmbientBackground()
        .navigationTitle(task?.title ?? copy.text(.taskDetail))
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
        .confirmationDialog(
            copy.text(.cancelConfirmationTitle),
            isPresented: $cancelPresented,
            titleVisibility: .visible
        ) {
            Button(copy.text(.cancelTask), role: .destructive) {
                guard let request = task.map({
                    FactoryTaskControlRequest(taskId: $0.id, action: .cancel)
                }) else { return }
                Task { await perform(request) }
            }
            Button(copy.text(.keepTask), role: .cancel) {}
        } message: {
            Text(copy.text(.cancelConfirmationMessage))
        }
        .confirmationDialog(
            copy.text(.confirmationTitle),
            isPresented: $confirmationPresented,
            titleVisibility: .visible
        ) {
            Button(copy.text(.confirm), role: .destructive) {
                guard let request = pendingConfirmation else { return }
                pendingConfirmation = nil
                Task { await perform(request, confirm: true) }
            }
            Button(copy.text(.keepTask), role: .cancel) {
                pendingConfirmation = nil
            }
        } message: {
            Text(confirmationMessage)
        }
        .accessibilityIdentifier("factory.taskDetail")
    }

    @ViewBuilder
    private func detailContent(_ task: FactoryTaskRecord) -> some View {
        JarvisList {
            Section(copy.text(.actions)) {
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
                        copy.text(taskConnection == .offline ? .offline : .eventReconnecting),
                        systemImage: taskConnection == .offline ? "wifi.slash" : "arrow.triangle.2.circlepath"
                    )
                    .foregroundStyle(.secondary)
                }
            }

            Section(copy.text(.request)) {
                Text(task.request)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Section(copy.text(.metadata)) {
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
            }

            Section(copy.text(.timeline)) {
                if events.isEmpty {
                    Text(copy.text(.noEvents))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(events) { event in
                        FactoryTaskEventRow(event: event, copy: copy, language: language)
                    }
                }
                if hasMoreEvents {
                    Button {
                        Task { await loadMoreEvents() }
                    } label: {
                        if loadingMoreEvents {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text(copy.text(.loadMore))
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(loadingMoreEvents)
                }
            }

            Section(copy.text(.usage)) {
                if usage.isEmpty {
                    Text(copy.text(.noUsage))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(usage, id: \.stableID) { item in
                        FactoryUsageRow(item: item, copy: copy, language: language)
                    }
                }
            }

            Section(copy.text(.disk)) {
                if diskEvents.isEmpty {
                    Text(copy.text(.noDisk))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(diskEvents) { event in
                        FactoryDiskEventRow(event: event, copy: copy, language: language)
                    }
                }
            }

            Section(copy.text(.artifacts)) {
                if artifactEvents.isEmpty {
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
    private func actionButton(_ action: FactoryTaskControl, task: FactoryTaskRecord) -> some View {
        if action == .cancel {
            Button(role: .destructive) {
                cancelPresented = true
            } label: {
                Label(copy.text(.cancelTask), systemImage: "xmark.circle")
            }
            .disabled(busyAction != nil)
        } else if action == .steer {
            Button {
                steeringPresented = true
            } label: {
                Label(copy.text(.steer), systemImage: "text.bubble")
            }
            .disabled(busyAction != nil)
        } else {
            Button {
                Task {
                    await perform(FactoryTaskControlRequest(taskId: task.id, action: action))
                }
            } label: {
                HStack {
                    Label(actionTitle(action), systemImage: actionSymbol(action))
                    Spacer()
                    if busyAction == action { ProgressView() }
                }
            }
            .disabled(busyAction != nil)
        }
    }

    private func loadTask() async {
        loading = true
        loadFailed = false
        do {
            let detail = try await client.task(id: taskID)
            guard !Task.isCancelled else { return }
            task = detail.task
            events = detail.events.sorted { $0.at < $1.at }
            usage = detail.usage
            hasMoreEvents = detail.events.count == 100
            lastEventID = events.last?.id
            taskConnection = .connected
            await JarvisFactoryLiveActivityController.update(task: detail.task, language: language)
            if showSteeringAtLaunch {
                steeringPresented = true
            }
        } catch {
            guard !Task.isCancelled else { return }
            loadFailed = true
        }
        loading = false
    }

    private func loadMoreEvents() async {
        guard !loadingMoreEvents else { return }
        loadingMoreEvents = true
        defer { loadingMoreEvents = false }
        do {
            let detail = try await client.task(id: taskID, eventLimit: 100, eventOffset: events.count)
            let knownIDs = Set(events.map(\.id))
            events = (detail.events.filter { !knownIDs.contains($0.id) } + events).sorted { $0.at < $1.at }
            hasMoreEvents = detail.events.count == 100
        } catch {
            actionFailed = true
        }
    }

    private func listenForEvents() async {
        guard liveUpdatesEnabled, task != nil else { return }
        var retrySeconds = 1
        while !Task.isCancelled {
            do {
                try await client.listenForTaskEvents(taskId: taskID, after: lastEventID) { event in
                    let (stateChanged, currentTask) = await MainActor.run {
                        taskConnection = .connected
                        eventRetryCount = 0
                        lastEventID = event.id
                        if !events.contains(where: { $0.id == event.id }) {
                            events.append(event)
                            events.sort { $0.at < $1.at }
                        }
                        return (event.type == "state_changed", task)
                    }
                    if let currentTask {
                        await JarvisFactoryLiveActivityController.update(
                            task: currentTask,
                            activityText: event.summary,
                            language: language
                        )
                    }
                    if stateChanged {
                        do {
                            let detail = try await client.task(id: taskID)
                            await MainActor.run {
                                task = detail.task
                                usage = detail.usage
                                let knownIDs = Set(events.map(\.id))
                                events = (detail.events.filter { !knownIDs.contains($0.id) } + events)
                                    .sorted { $0.at < $1.at }
                            }
                            await JarvisFactoryLiveActivityController.update(
                                task: detail.task,
                                language: language
                            )
                        } catch {
                            await MainActor.run { actionFailed = true }
                        }
                    }
                }
                eventRetryCount += 1
                taskConnection = .reconnecting
            } catch {
                guard !Task.isCancelled else { return }
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

    private func perform(_ request: FactoryTaskControlRequest, confirm: Bool = false) async {
        guard busyAction == nil else { return }
        busyAction = request.action
        actionFailed = false
        actionCompleted = false
        defer { busyAction = nil }
        do {
            task = try await client.controlTask(request, confirm: confirm)
            actionCompleted = true
        } catch let error as JarvisFactoryClientError {
            switch error {
            case .confirmationRequired(let reason, _):
                pendingConfirmation = request
                pendingConfirmationReason = reason
                confirmationPresented = true
            case .taskConflict:
                actionFailed = true
            default:
                actionFailed = true
            }
        } catch {
            actionFailed = true
        }
    }

    private func sendSteering(_ message: String) async -> Bool {
        guard let task else { return false }
        await perform(FactoryTaskControlRequest(taskId: task.id, action: .steer, message: message))
        return !actionFailed
    }

    private var confirmationMessage: String {
        switch pendingConfirmationReason {
        case "issue_closed": copy.text(.confirmationIssueClosed)
        case "pull_request_merged": copy.text(.confirmationPullRequestMerged)
        case "superseded_legacy_task": copy.text(.confirmationSuperseded)
        default: copy.text(.confirmationGeneric)
        }
    }

    private var diskEvents: [FactoryTaskEvent] {
        events.filter { $0.type.localizedCaseInsensitiveContains("disk") }
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
    case connected
    case reconnecting
    case offline
}

private struct FactoryTaskEventRow: View {
    let event: FactoryTaskEvent
    let copy: JarvisFactoryCopy
    let language: JarvisAppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
            Text(event.summary ?? copy.text(.timeline))
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
            Text(JarvisFactoryLocalization.formattedDate(event.at, language: language))
                .font(.caption)
                .foregroundStyle(.secondary)
            if event.payloadTruncated {
                Text(copy.text(.eventPayloadTruncated))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                DisclosureGroup(copy.text(.eventPayload)) {
                    Text(payloadText)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(.caption)
            }
        }
        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
    }

    private var payloadText: String {
        guard let data = try? JSONEncoder().encode(event.payload) else { return "" }
        return String(decoding: data, as: UTF8.self)
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

private struct FactoryDiskEventRow: View {
    let event: FactoryTaskEvent
    let copy: JarvisFactoryCopy
    let language: JarvisAppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
            if let summary = event.summary {
                Text(summary)
            }
            ForEach(diskValues) { value in
                LabeledContent(copy.text(value.label), value: value.bytes.formatted(.byteCount(style: .file).locale(language.locale)))
            }
            Text(JarvisFactoryLocalization.formattedDate(event.at, language: language))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
    }

    private var diskValues: [FactoryDiskMeasurement] {
        guard case .object(let payload) = event.payload else { return [] }
        let value: [String: FactoryJSONValue]
        if case .object(let data)? = payload["data"] {
            value = data
        } else {
            value = payload
        }
        return [
            ("freeBytes", .freeDisk),
            ("usedBytes", .usedDisk),
            ("totalBytes", .totalDisk),
        ].compactMap { key, label in
            guard case .number(let number)? = value[key],
                  number.isFinite,
                  number >= 0,
                  number < Double(Int64.max) else { return nil }
            return FactoryDiskMeasurement(
                id: key,
                label: label,
                bytes: Int64(number)
            )
        }
    }
}

private struct FactoryDiskMeasurement: Identifiable {
    let id: String
    let label: JarvisFactoryLocalizationKey
    let bytes: Int64
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
                ToolbarItem(placement: .cancellationAction) {
                    Button(copy.text(.cancel)) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await send() }
                    } label: {
                        if sending {
                            ProgressView()
                        } else {
                            Text(copy.text(.sendSteering))
                        }
                    }
                    .disabled(sending || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
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
