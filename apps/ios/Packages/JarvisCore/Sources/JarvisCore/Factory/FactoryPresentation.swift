import Foundation

public enum JarvisFactoryLocalizationKey: String, CaseIterable, Sendable {
    case title = "factory.title"
    case refresh = "factory.refresh"
    case refreshing = "factory.refreshing"
    case board = "factory.board"
    case needsDan = "factory.needsDan"
    case releases = "factory.releases"
    case project = "factory.project"
    case filters = "factory.filters"
    case agent = "factory.agent"
    case state = "factory.state"
    case all = "factory.all"
    case search = "factory.search"
    case searchAccessibility = "factory.searchAccessibility"
    case searchReleases = "factory.searchReleases"
    case searchReleasesAccessibility = "factory.searchReleasesAccessibility"
    case clearSearch = "factory.clearSearch"
    case cached = "factory.cached"
    case reconnecting = "factory.reconnecting"
    case offline = "factory.offline"
    case retry = "factory.retry"
    case loading = "factory.loading"
    case loadingTasks = "factory.loadingTasks"
    case loadingReleases = "factory.loadingReleases"
    case emptyProjects = "factory.emptyProjects"
    case emptyBoard = "factory.emptyBoard"
    case emptyNeedsDan = "factory.emptyNeedsDan"
    case emptyReleases = "factory.emptyReleases"
    case noSearchResults = "factory.noSearchResults"
    case issueNumber = "factory.issueNumber"
    case blockedBy = "factory.blockedBy"
    case inProgress = "factory.inProgress"
    case inReview = "factory.inReview"
    case ready = "factory.ready"
    case backlog = "factory.backlog"
    case done = "factory.done"
    case running = "factory.running"
    case activityProgress = "factory.activityProgress"
    case open = "factory.open"
    case closed = "factory.closed"
    case pauseRequested = "factory.pauseRequested"
    case paused = "factory.paused"
    case needsAttention = "factory.needsAttention"
    case cancelled = "factory.cancelled"
    case codex = "factory.codex"
    case copilot = "factory.copilot"
    case taskDetail = "factory.taskDetail"
    case actions = "factory.actions"
    case steer = "factory.steer"
    case pause = "factory.pause"
    case resume = "factory.resume"
    case cancelTask = "factory.cancelTask"
    case recover = "factory.recover"
    case continueTask = "factory.continue"
    case openPullRequest = "factory.openPullRequest"
    case cancelConfirmationTitle = "factory.cancelConfirmationTitle"
    case cancelConfirmationMessage = "factory.cancelConfirmationMessage"
    case confirmationTitle = "factory.confirmationTitle"
    case confirm = "factory.confirm"
    case keepTask = "factory.keepTask"
    case confirmationIssueClosed = "factory.confirmation.issueClosed"
    case confirmationPullRequestMerged = "factory.confirmation.pullRequestMerged"
    case confirmationSuperseded = "factory.confirmation.superseded"
    case confirmationGeneric = "factory.confirmation.generic"
    case taskConflict = "factory.taskConflict"
    case actionFailed = "factory.actionFailed"
    case actionCompleted = "factory.actionCompleted"
    case steeringMessage = "factory.steeringMessage"
    case sendSteering = "factory.sendSteering"
    case request = "factory.request"
    case metadata = "factory.metadata"
    case timeline = "factory.timeline"
    case usage = "factory.usage"
    case disk = "factory.disk"
    case artifacts = "factory.artifacts"
    case noEvents = "factory.noEvents"
    case noUsage = "factory.noUsage"
    case noArtifacts = "factory.noArtifacts"
    case eventConnecting = "factory.eventConnecting"
    case eventReconnecting = "factory.eventReconnecting"
    case projectLabel = "factory.projectLabel"
    case agentLabel = "factory.agentLabel"
    case model = "factory.model"
    case reasoning = "factory.reasoning"
    case branch = "factory.branch"
    case pullRequest = "factory.pullRequest"
    case checks = "factory.checks"
    case prDraft = "factory.prDraft"
    case checksPending = "factory.checksPending"
    case checksNone = "factory.checksNone"
    case checksPassed = "factory.checksPassed"
    case checksFailed = "factory.checksFailed"
    case created = "factory.created"
    case started = "factory.started"
    case attempts = "factory.attempts"
    case newTask = "factory.newTask"
    case createTask = "factory.createTask"
    case titleField = "factory.titleField"
    case requestField = "factory.requestField"
    case modelOptional = "factory.modelOptional"
    case reasoningOptional = "factory.reasoningOptional"
    case completionPolicy = "factory.completionPolicy"
    case deliverPullRequest = "factory.deliverPullRequest"
    case completeWithoutDeployment = "factory.completeWithoutDeployment"
    case save = "factory.save"
    case cancel = "factory.cancel"
    case taskCreated = "factory.taskCreated"
    case createFailed = "factory.createFailed"
    case policySaving = "factory.policySaving"
    case policySaveFailed = "factory.policySaveFailed"
    case commit = "factory.commit"
    case commits = "factory.commits"
    case workflowRuns = "factory.workflowRuns"
    case deployments = "factory.deployments"
    case linkedTasks = "factory.linkedTasks"
    case building = "factory.building"
    case deploying = "factory.deploying"
    case released = "factory.released"
    case failed = "factory.failed"
    case queued = "factory.queued"
    case success = "factory.success"
    case failure = "factory.failure"
    case noCommits = "factory.noCommits"
    case noWorkflowRuns = "factory.noWorkflowRuns"
    case noDeployments = "factory.noDeployments"
    case noLinkedTasks = "factory.noLinkedTasks"
    case estimated = "factory.estimated"
    case minutes = "factory.minutes"
    case inputTokens = "factory.inputTokens"
    case outputTokens = "factory.outputTokens"
    case turns = "factory.turns"
    case premiumRequests = "factory.premiumRequests"
    case loadMore = "factory.loadMore"
    case eventPayload = "factory.eventPayload"
    case eventPayloadTruncated = "factory.eventPayloadTruncated"
    case voice = "factory.voice"
    case noDisk = "factory.noDisk"
    case freeDisk = "factory.freeDisk"
    case usedDisk = "factory.usedDisk"
    case totalDisk = "factory.totalDisk"
    case historyTruncated = "factory.historyTruncated"
    case sandbox = "factory.sandbox"
    case jarvisModel = "factory.jarvisModel"
}

public enum JarvisFactoryLocalization {
    public static func string(_ key: JarvisFactoryLocalizationKey, language: JarvisAppLanguage) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return key.rawValue
        }
        return bundle.localizedString(forKey: key.rawValue, value: key.rawValue, table: "JarvisFactory")
    }

    public static func formattedDate(_ value: String, language: JarvisAppLanguage) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: value) ?? {
            formatter.formatOptions.insert(.withFractionalSeconds)
            return formatter.date(from: value)
        }() else {
            return value
        }
        return date.formatted(.dateTime.year().month(.abbreviated).day().locale(language.locale))
    }
}

public enum FactorySegment: String, CaseIterable, Identifiable, Sendable {
    case board
    case needsDan
    case releases

    public var id: String { rawValue }
}

public enum FactoryTaskControl: String, CaseIterable, Codable, Sendable {
    case steer
    case pause
    case resume
    case cancel
    case recover
}

public struct FactoryTaskSubmission: Codable, Equatable, Sendable {
    public let projectId: String
    public let submissionId: String
    public let title: String
    public let request: String
    public let agent: FactoryAgent
    public let modelOverride: String?
    public let reasoningOverride: String?

    public init(
        projectId: String,
        title: String,
        request: String,
        agent: FactoryAgent,
        modelOverride: String? = nil,
        reasoningOverride: String? = nil,
        submissionId: String = UUID().uuidString.lowercased()
    ) {
        self.projectId = projectId
        self.submissionId = submissionId
        self.title = title
        self.request = request
        self.agent = agent
        self.modelOverride = modelOverride
        self.reasoningOverride = reasoningOverride
    }

    public var isValid: Bool {
        isValidFactoryID(projectId) &&
            isValidSubmissionID(submissionId) &&
            !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            title.utf16.count <= 200 &&
            !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            request.utf16.count <= 50_000 &&
            (modelOverride?.utf16.count ?? 0) <= 100 &&
            (reasoningOverride?.utf16.count ?? 0) <= 32
    }
}

public struct FactoryTaskControlRequest: Equatable, Sendable {
    public let taskId: String
    public let action: FactoryTaskControl
    public let message: String?

    public init(taskId: String, action: FactoryTaskControl, message: String? = nil) {
        self.taskId = taskId
        self.action = action
        self.message = message
    }

    public var isValid: Bool {
        guard isValidFactoryID(taskId) else { return false }
        if action == .steer {
            guard let message else { return false }
            return !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                message.utf16.count <= 65_536
        }
        return message == nil
    }
}

public enum JarvisFactoryPresentation {
    public static let boardColumnOrder: [FactoryBoardColumnID] = [
        .inProgress, .inReview, .ready, .backlog, .done,
    ]

    public static func cards(
        from board: FactoryBoard,
        segment: FactorySegment,
        search: String = "",
        agent: FactoryAgent? = nil,
        state: FactoryTaskState? = nil
    ) -> [(column: FactoryBoardColumnID, card: FactoryBoardCard)] {
        let columns = board.columns.filter { column in
            switch segment {
            case .board:
                column.id != .needsDan
            case .needsDan:
                column.id == .needsDan
            case .releases:
                false
            }
        }
        let normalizedSearch = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let issueNumber = normalizedSearch.hasPrefix("#")
            ? Int(normalizedSearch.dropFirst())
            : nil
        return columns
            .sorted { order(of: $0.id) < order(of: $1.id) }
            .flatMap { column in
                column.cards.compactMap { card -> (FactoryBoardColumnID, FactoryBoardCard)? in
                    if segment == .needsDan && card.task?.state != .needsAttention { return nil }
                    if let agent {
                        let taskAgent = card.task?.agent
                        let workerAgent = FactoryAgent(rawValue: card.issue.worker?.lowercased() ?? "")
                        if taskAgent != agent && workerAgent != agent { return nil }
                    }
                    if let state, card.task?.state != state { return nil }
                    if !normalizedSearch.isEmpty {
                        if normalizedSearch.hasPrefix("#") {
                            guard issueNumber == card.issue.number else { return nil }
                        } else if !card.issue.title.localizedCaseInsensitiveContains(normalizedSearch) {
                            return nil
                        }
                    }
                    return (column.id, card)
                }
            }
    }

    public static func defaultCollapsedColumns() -> Set<FactoryBoardColumnID> {
        [.done]
    }

    public static func availableControls(
        state: FactoryTaskState,
        latestSessionEndReason: FactorySessionEndReason?
    ) -> [FactoryTaskControl] {
        switch state {
        case .ready:
            return [.cancel]
        case .running:
            return [
                .steer,
                .pause,
            ] + (latestSessionEndReason == .idleExpired ? [.recover] : []) + [.cancel]
        case .paused:
            return [.resume, .cancel]
        case .needsAttention:
            let canRecover = latestSessionEndReason == .crashed || latestSessionEndReason == .idleExpired
            return (canRecover ? [.recover, .cancel] : [.cancel])
        case .pauseRequested, .done, .cancelled:
            return []
        }
    }

    public static func linkedTaskIDs(for release: FactoryRelease, in view: FactoryReleaseView) -> [String] {
        let runs = view.workflowRuns.filter { $0.releaseId == release.id }
        let linkedPullRequests = Set(runs.compactMap(\.pullRequestNumber))
        let pullRequestTasks = view.pullRequests
            .filter { $0.headSha.caseInsensitiveCompare(release.sha) == .orderedSame || linkedPullRequests.contains($0.number) }
            .compactMap(\.taskId)
        let runTasks = runs.compactMap(\.taskId)
        return Array(Set(pullRequestTasks + runTasks)).sorted()
    }

    private static func order(of id: FactoryBoardColumnID) -> Int {
        boardColumnOrder.firstIndex(of: id) ?? boardColumnOrder.count
    }
}

func isValidFactoryID(_ value: String) -> Bool {
    value.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil &&
        Int64(value) != nil
}

private func isValidSubmissionID(_ value: String) -> Bool {
    value.range(
        of: #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#,
        options: .regularExpression
    ) != nil
}
