import Foundation
import JarvisCore
import SwiftUI

struct JarvisChatRow: Identifiable, Equatable {
    let id: String
    let sessionID: String
    let channel: ConversationChannel
    let role: ConversationRole
    var text: String
    let at: String
    var interrupted: Bool
    var toolCalls: [ChatHistoryToolCall]
    let attachments: [ChatHistoryAttachment]

    init(_ message: ChatHistoryMessage) {
        id = message.id
        sessionID = message.sessionId
        channel = message.channel
        role = message.role
        text = message.text
        at = message.at
        interrupted = message.interrupted
        toolCalls = message.toolCalls
        attachments = message.attachments.filter { !Self.isLiveFrame($0) }
    }

    /// Frames from older live sessions were stored as attachments; they are never shown in the history.
    private static func isLiveFrame(_ attachment: ChatHistoryAttachment) -> Bool {
        attachment.name == "Screen.jpg" || attachment.name == "Video.jpg"
    }

    init(id: String, role: ConversationRole, text: String, at: String) {
        self.id = id
        sessionID = "local"
        channel = .chat
        self.role = role
        self.text = text
        self.at = at
        interrupted = false
        toolCalls = []
        attachments = []
    }

    init(_ message: ChatMessage, attachments: [ChatHistoryAttachment] = []) {
        id = message.id
        sessionID = message.sessionId
        channel = .chat
        role = message.role
        text = message.text
        at = message.at
        interrupted = false
        toolCalls = []
        self.attachments = attachments
    }
}

/// A live screen-share or camera frame sent with a turn. It reaches the model as labelled live input, not a file.
struct PendingVisualFrame {
    let source: VoiceScreenSource
    let jpeg: Data
}

struct PendingChatAttachment: Identifiable {
    let id: UUID
    let name: String
    let contentType: String
    let data: Data

    init(name: String, contentType: String, data: Data) {
        id = UUID()
        self.name = name
        self.contentType = contentType
        self.data = data
    }

    var upload: ChatAttachmentUpload {
        ChatAttachmentUpload(fileName: name, contentType: contentType, data: data)
    }
}

@MainActor
final class JarvisChatModel: ObservableObject {
    @Published var messages: [JarvisChatRow] = []
    @Published var composerDraft = ComposerDraft()
    var draft: String {
        get { composerDraft.text }
        set { composerDraft.replace(with: newValue) }
    }
    @Published var pendingAttachments: [PendingChatAttachment] = []
    @Published var isLoading = true
    @Published private(set) var isReadyForHandoff = false
    @Published var isLoadingOlder = false
    @Published var isSending = false
    private var optimisticMessageID: String?
    private var steeringMessageIDs: [String] = []
    private var thinkingPhrase = ""
    @Published var isCancelling = false
    @Published var resolvingConfirmationDecisions = [String: ConfirmationDecision]()
    @Published var dismissingActivityIDs = Set<String>()
    @Published var dismissingBackgroundTaskIDs = Set<String>()
    @Published var historyError: String?
    @Published var actionError: String?
    @Published var statusLine: String?
    @Published var streamingText = ""
    @Published private(set) var acknowledgment: String?
    @Published private(set) var progressUpdates: [String] = []
    @Published private(set) var turnStartedAt: Date?
    @Published private(set) var isReconnecting = false
    @Published private var toolActivities: [ChatToolActivity] = []
    private var turnMessageIDs = Set<String>()

    var liveTools: [ChatToolActivity] { toolActivities.filter { turnMessageIDs.contains($0.messageId) } }
    @Published var nowFeed: JarvisNowFeed?
    @Published private(set) var backgroundTasks: [BackgroundTaskRecord] = []
    @Published var activityError: String?
    @Published var activityMessage: String?
    @Published private(set) var chatLanguage: ChatLanguage = .da

    private let client: JarvisChatClient?
    private let nowClient: JarvisNowFeedClient?
    private let updatesClient: JarvisWorkspaceClient?
    private let settingsClient: JarvisSettingsClient?
    private let factoryClient: JarvisFactoryClient?
    private let deviceLocation = JarvisDeviceLocation()
    private let watchClient: VisionWatchClient?
    private var liveStreamTask: Task<Void, Never>?
    private var historyPaging = ChatHistoryPagingState()
    private var sessionID: String?
    private var language: ChatLanguage
    private var activeMessageID: String?
    private var uploadedAttachmentIDs: [UUID: String] = [:]
    private var sentTurnAttachments: [ChatHistoryAttachment] = []
    private let photoLoader = JarvisChatPhotoLoader()
    private var locallyResolvedConfirmationIDs = Set<String>()
    private var sendTask: Task<Void, Never>?
    private var observationSuspended = false
    private var didLoad = false
    private var fixtureTurnUsed = false
    private var activityRefreshID = UUID()
    let fixtureMode: Bool
    let startupError: String?

    private func chatCopy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: appLanguage)
    }

    private var appLanguage: JarvisAppLanguage {
        JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
    }

    init(client: JarvisClient?, fixtureMode: Bool = false, startupError: String? = nil) {
        self.client = client.map { JarvisChatClient(client: $0) }
        nowClient = client.map { JarvisNowFeedClient(client: $0) }
        updatesClient = client.map { JarvisWorkspaceClient(client: $0) }
        settingsClient = client.map { JarvisSettingsClient(client: $0) }
        factoryClient = client.map { JarvisFactoryClient(client: $0) }
        watchClient = client.map { VisionWatchClient(client: $0) }
        if let client { JarvisFactoryLiveActivityController.configure(client: client) }
        self.fixtureMode = fixtureMode
        self.startupError = startupError
        language = .da
        if fixtureMode && JarvisChatPhotoFixture.isEnabled {
            pendingAttachments = JarvisChatPhotoFixture.pending
            draft = "Synthetic photo draft"
        }
    }

    var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            (!fixtureMode || JarvisChatFeedbackFixtureTransport.isEnabled || !fixtureTurnUsed)
    }

    var fixtureTurnUnavailable: Bool { fixtureMode && !JarvisChatFeedbackFixtureTransport.isEnabled && fixtureTurnUsed }
    var canCancel: Bool { activeMessageID != nil }
    var hasOlderMessages: Bool { historyPaging.nextCursor != nil }

    var shouldShowNowBar: Bool {
        !backgroundPresentation.isEmpty || nowFeed.map {
            !$0.running.isEmpty || !$0.items.isEmpty
        } == true
    }

    var backgroundPresentation: BackgroundTaskPresentation {
        BackgroundTaskPresentation(tasks: backgroundTasks)
    }

    var needsYouCount: Int {
        guard let nowFeed else { return backgroundPresentation.needsYouCount }
        return backgroundPresentation.needsYouCount
            + nowFeed.items.filter {
            $0.category == .attention || $0.category == .credential || $0.category == .alert
        }.count
    }

    var nowTitle: String {
        if let task = nowFeed?.running.first {
            return task.activity.isEmpty ? task.title : task.activity
        }
        if let task = backgroundTasks.first(where: { $0.status == .running }) {
            return task.detail ?? task.title
        }
        return nowFeed?.items.first?.title ?? "Background activity"
    }

    func load() async {
        guard !didLoad else { return }
        didLoad = true
        defer { isReadyForHandoff = true }
        guard let client else {
            historyError = startupError ?? "Chat is unavailable."
            isLoading = false
            return
        }

        do {
            let page = try await client.history()
            apply(page, replacing: true)
            historyPaging.replaceHistory(nextCursor: page.nextCursor)
            historyError = nil
        } catch {
            historyError = message(for: error)
        }
        isLoading = false
        await loadChatLanguage()
        if !fixtureMode, let settingsClient { _ = await deviceLocation.sync(using: settingsClient) }
        await refreshActivity()

        await reattachActiveTurnIfNeeded()
    }

    func retryHistory() async {
        guard let client else { return }
        isLoading = true
        historyError = nil
        do {
            let page = try await client.history()
            apply(page, replacing: true)
            historyPaging.replaceHistory(nextCursor: page.nextCursor)
        } catch {
            historyError = message(for: error)
        }
        isLoading = false
    }

    func loadOlder() async {
        guard let client, let cursor = historyPaging.nextCursor, !isLoadingOlder else { return }
        isLoadingOlder = true
        do {
            let page = try await client.history(before: cursor)
            apply(page, replacing: false)
            historyPaging.appendOlderPage(nextCursor: page.nextCursor)
        } catch {
            actionError = message(for: error)
        }
        isLoadingOlder = false
    }

    func addAttachment(name: String, contentType: String, data: Data) {
        guard pendingAttachments.count < ChatAttachmentLimits.maximumCount else {
            actionError = chatCopy(.errTooMany)
            return
        }
        guard !data.isEmpty, data.count <= ChatAttachmentLimits.maximumFileBytes else {
            actionError = "Each attachment must be 20 MB or smaller."
            return
        }
        if contentType.hasPrefix("image/"), data.count > ChatAttachmentLimits.maximumImageBytes {
            actionError = "Images must be 10 MB or smaller."
            return
        }
        pendingAttachments.append(PendingChatAttachment(
            name: name,
            contentType: contentType,
            data: data
        ))
        actionError = nil
    }

    func removeAttachment(_ attachment: PendingChatAttachment) {
        pendingAttachments.removeAll { $0.id == attachment.id }
        uploadedAttachmentIDs[attachment.id] = nil
    }

    func attachmentImageData(_ attachment: ChatHistoryAttachment) async throws -> Data {
        if fixtureMode && JarvisChatPhotoFixture.isEnabled {
            return try JarvisChatPhotoFixture.imageData(id: attachment.id)
        }
        guard let client else { throw JarvisClientError.invalidRequest }
        let url = try await client.attachmentURL(id: attachment.id)
        try Task.checkCancellation()
        return try await photoLoader.data(from: url)
    }

    func setChatLanguage(_ language: ChatLanguage) async {
        guard !fixtureMode, !isSending, language != chatLanguage, let settingsClient else { return }
        do {
            _ = try await settingsClient.saveSettings(
                JarvisSettingsPatch(
                    area: "voice",
                    key: "defaultLanguage",
                    value: .string(language.rawValue)
                )
            )
            chatLanguage = language
            self.language = language
            sessionID = nil
            actionError = nil
        } catch {
            actionError = JarvisChatLocalization.string(.chatLanguageUpdateFailed, language: appLanguage)
        }
    }

    /// Creates the chat session on demand so a live stream can start before the first message.
    private func liveSessionID() async -> String? {
        if let sessionID { return sessionID }
        guard let client, !fixtureMode,
              let session = try? await client.createSession(language: language) else { return nil }
        if sessionID == nil {
            sessionID = session.id
            language = session.language
        }
        return sessionID
    }

    /// Keeps sending sampled frames of a live screen share or camera while it lasts, so Jarvis receives a
    /// continuous stream and `watch_for` has a real source. Rate and size are bounded by `LiveFrameStreamer`.
    func startLiveStream(source: VoiceScreenSource, capture: @escaping @Sendable () async -> Data?) {
        stopLiveStream()
        guard let watchClient, !fixtureMode else { return }
        liveStreamTask = Task { [weak self] in
            guard let sessionID = await self?.liveSessionID(), !Task.isCancelled else { return }
            let feedId = UUID().uuidString
            await LiveFrameStreamer(
                source: source,
                capture: capture,
                post: { try await watchClient.post(sessionId: sessionID, source: source, jpeg: $0, feedId: feedId) }
            ).run()
            await Task { await watchClient.stop(sessionId: sessionID, source: source, feedId: feedId) }.value
        }
    }

    func stopLiveStream() {
        liveStreamTask?.cancel()
        liveStreamTask = nil
    }

    func send(visualFrame: PendingVisualFrame? = nil) {
        guard canSend else { return }
        if isSending {
            steer()
            return
        }
        if fixtureMode { fixtureTurnUsed = true }
        isSending = true
        turnStartedAt = Date()
        progressUpdates = []
        isCancelling = false
        actionError = nil
        streamingText = ""
        acknowledgment = nil
        isReconnecting = false
        toolActivities = []
        turnMessageIDs = []
        let text = composerDraft.consume()
        let attachments = pendingAttachments
        sentTurnAttachments = []
        thinkingPhrase = ChatThinkingPhrase.phrase(
            forRequest: text,
            hasImage: visualFrame != nil || attachments.contains { $0.contentType.hasPrefix("image/") },
            language: appLanguage
        )
        statusLine = thinkingPhrase
        let optimisticID = "local-\(UUID().uuidString)"
        optimisticMessageID = optimisticID
        addOrReplace(JarvisChatRow(
            id: optimisticID,
            role: .dan,
            text: text,
            at: ISO8601DateFormatter().string(from: Date())
        ))
        sendTask = Task { await sendTurn(text: text, attachments: attachments, visualFrame: visualFrame) }
    }

    /// The composer stays active while Jarvis answers: a follow-up joins the running turn instead of waiting for it.
    private func steer() {
        guard let client, let sessionID, activeMessageID != nil else {
            actionError = JarvisChatLocalization.string(.followUpUnavailable, language: appLanguage)
            return
        }
        let text = composerDraft.consume()
        let followUpID = "local-\(UUID().uuidString)"
        addOrReplace(JarvisChatRow(
            id: followUpID, role: .dan, text: text, at: ISO8601DateFormatter().string(from: Date())
        ))
        steeringMessageIDs.append(followUpID)
        Task {
            do {
                if let saved = try await client.steerTurn(sessionId: sessionID, text: text, language: language) {
                    turnMessageIDs.insert(saved.id)
                    messages.removeAll { $0.id == followUpID }
                    steeringMessageIDs.removeAll { $0 == followUpID }
                    addOrReplace(JarvisChatRow(saved))
                    return
                }
                actionError = JarvisChatLocalization.string(.followUpUnavailable, language: appLanguage)
            } catch {
                actionError = message(for: error)
            }
            steeringMessageIDs.removeAll { $0 == followUpID }
            messages.removeAll { $0.id == followUpID }
            if draft.isEmpty { draft = text }
        }
    }

    func cancel() async {
        guard let client, let sessionID, let activeMessageID, !isCancelling else { return }
        isCancelling = true
        do {
            let cancelled = try await client.cancelTurn(sessionId: sessionID, messageId: activeMessageID)
            sendTask?.cancel()
            isCancelling = false
            if !cancelled {
                actionError = "The turn already finished."
            }
            await refreshHistory()
        } catch {
            isCancelling = false
            actionError = message(for: error)
        }
    }

    func refreshActivity() async {
        if fixtureMode, nowFeed != nil { return }
        guard let nowClient else {
            activityError = startupError ?? chatCopy(.activityUnavailableMessage)
            return
        }
        let requestID = UUID()
        activityRefreshID = requestID
        async let feedError = refreshNowFeed(nowClient, requestID: requestID)
        async let jobsError = refreshBackgroundTasks(nowClient, requestID: requestID)
        let errors = await (feedError, jobsError)
        guard !Task.isCancelled, activityRefreshID == requestID else { return }
        activityError = errors.0 ?? errors.1
        await JarvisFactoryLiveActivityController.synchronize(
            nowFeed?.running ?? [], backgroundTasks: backgroundTasks,
            factoryClient: factoryClient, language: appLanguage
        )
        guard !Task.isCancelled, activityRefreshID == requestID else { return }
        await JarvisApprovalNotificationCoordinator.shared.synchronize(
            nowFeed?.confirmations ?? [], language: appLanguage
        )
        consumeLockScreenApprovalResult()
    }

    private func refreshNowFeed(_ client: JarvisNowFeedClient, requestID: UUID) async -> String? {
        do {
            let feed = try await client.load()
            guard !Task.isCancelled, activityRefreshID == requestID else { return nil }
            replaceNowFeed(feed)
            return nil
        } catch {
            guard !Task.isCancelled, activityRefreshID == requestID else { return nil }
            activityError = message(for: error)
            return activityError
        }
    }

    private func refreshBackgroundTasks(_ client: JarvisNowFeedClient, requestID: UUID) async -> String? {
        do {
            let tasks = try await client.backgroundTasks()
            guard !Task.isCancelled, activityRefreshID == requestID else { return nil }
            backgroundTasks = tasks
            return nil
        } catch {
            guard !Task.isCancelled, activityRefreshID == requestID else { return nil }
            activityError = message(for: error)
            return activityError
        }
    }

    func resumeIfSuspended() async {
        guard observationSuspended else { return }
        await resume()
    }

    func resume() async {
        guard !fixtureMode else { return }
        if observationSuspended {
            await sendTask?.value
            observationSuspended = false
        }
        await refreshHistory()
        await refreshActivity()
        await reattachActiveTurnIfNeeded()
    }

    func suspendObservation() {
        guard isSending else { return }
        observationSuspended = true
        // This only detaches the transport; cancelTurn is an explicit user action.
        sendTask?.cancel()
    }

    func watchActivity() async {
        guard !fixtureMode || JarvisChatFeedbackFixtureTransport.isEnabled else { return }
        guard let updatesClient else { return }
        do {
            for try await event in updatesClient.events() {
                try Task.checkCancellation()
                switch event {
                case .chatToolActivity(let tool):
                    guard isSending else { continue }
                    recordToolActivity(tool)
                case .pendingConfirmationsChanged:
                    await refreshActivity()
                    if !isSending { await refreshHistory() }
                case .activityChanged:
                    await refreshActivity()
                    // Replies that finish while the user is in voice or screen sharing must show up without a message.
                    if !isSending { await refreshHistory() }
                case .factoryBoardChanged:
                    await refreshActivity()
                case .workspaceReady:
                    await refreshActivity()
                    await reattachActiveTurnIfNeeded()
                default:
                    break
                }
            }
        } catch is CancellationError {
        } catch {
            if nowFeed == nil {
                activityError = message(for: error)
            }
        }
    }

    func dismissActivity(_ item: NowFeedActivityItem) async {
        guard !fixtureMode, let nowClient, !dismissingActivityIDs.contains(item.id) else { return }
        dismissingActivityIDs.insert(item.id)
        activityMessage = nil
        defer { dismissingActivityIDs.remove(item.id) }
        do {
            try await nowClient.dismissActivity(id: item.id)
            activityMessage = chatCopy(.activityDismissed)
            nowFeed = try await nowClient.load()
            activityError = nil
        } catch {
            activityError = message(for: error)
        }
    }

    /// Dismisses every item of a group one after another (the backend has one dismiss route per item), then
    /// reloads once. An item that is already gone counts as dismissed; any other error stops the run and is shown.
    func dismissActivities(_ items: [NowFeedActivityItem]) async {
        guard !fixtureMode, let nowClient else { return }
        let pending = items.filter { !dismissingActivityIDs.contains($0.id) }
        guard !pending.isEmpty else { return }
        activityMessage = nil
        dismissingActivityIDs.formUnion(pending.map(\.id))
        defer { dismissingActivityIDs.subtract(pending.map(\.id)) }
        do {
            for item in pending {
                do {
                    try await nowClient.dismissActivity(id: item.id)
                } catch JarvisNowFeedClientError.activityUnavailable {
                    continue
                }
            }
            activityMessage = chatCopy(.activityDismissed)
            activityError = nil
        } catch {
            activityError = message(for: error)
        }
        if let feed = try? await nowClient.load() { nowFeed = feed }
    }

    func dismissBackgroundTask(_ task: BackgroundTaskRecord) async {
        guard !fixtureMode, let nowClient, !dismissingBackgroundTaskIDs.contains(task.id) else { return }
        dismissingBackgroundTaskIDs.insert(task.id)
        activityMessage = nil
        defer { dismissingBackgroundTaskIDs.remove(task.id) }
        do {
            try await nowClient.dismissBackgroundTask(id: task.id)
            backgroundTasks.removeAll { $0.id == task.id }
            activityError = nil
        } catch JarvisNowFeedClientError.activityUnavailable {
            backgroundTasks.removeAll { $0.id == task.id }
        } catch {
            activityError = message(for: error)
        }
    }

    func resolve(_ confirmation: PendingConfirmation, decision: ConfirmationDecision) async {
        guard !fixtureMode, let nowClient,
              resolvingConfirmationDecisions[confirmation.id] == nil else { return }
        resolvingConfirmationDecisions[confirmation.id] = decision
        activityMessage = nil
        defer { resolvingConfirmationDecisions.removeValue(forKey: confirmation.id) }
        do {
            try await nowClient.resolveConfirmation(id: confirmation.id, decision: decision)
            await JarvisAppCache.invalidate(.notifications)
            locallyResolvedConfirmationIDs.insert(confirmation.id)
            let result: JarvisApprovalLocalizationKey = decision == .approve ? .recorded : .declinedInApp
            activityMessage = JarvisApprovalLocalization.string(result, language: appLanguage)
            activityError = nil
            await JarvisApprovalNotificationCoordinator.shared.dismissNotification(
                confirmationID: confirmation.id
            )
            do {
                replaceNowFeed(try await nowClient.load())
            } catch {
                activityError = message(for: error)
            }
        } catch {
            activityError = JarvisApprovalLocalization.string(.resolutionFailed, language: appLanguage)
        }
    }

    private func replaceNowFeed(_ feed: JarvisNowFeed) {
        nowFeed = feed
        let currentIDs = Set(feed.confirmations.map(\.id))
        locallyResolvedConfirmationIDs.formIntersection(currentIDs)
    }

    func isResolving(_ confirmation: PendingConfirmation, decision: ConfirmationDecision) -> Bool {
        resolvingConfirmationDecisions[confirmation.id] == decision
    }

    func isResolving(_ confirmation: PendingConfirmation) -> Bool {
        resolvingConfirmationDecisions[confirmation.id] != nil
    }

    private func consumeLockScreenApprovalResult() {
        guard let result = UserDefaults.standard.string(
            forKey: JarvisApprovalNotificationCoordinator.actionResultKey
        ) else { return }
        let key: JarvisApprovalLocalizationKey
        switch result {
        case ConfirmationDecision.approve.rawValue: key = .approvedFromLockScreen
        case ConfirmationDecision.reject.rawValue: key = .declinedFromLockScreen
        default: key = .actionFailed
        }
        activityMessage = JarvisApprovalLocalization.string(
            key,
            language: JarvisAppLanguage(
                rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
            ) ?? .default
        )
        UserDefaults.standard.removeObject(
            forKey: JarvisApprovalNotificationCoordinator.actionResultKey
        )
    }

    private func sendTurn(
        text: String,
        attachments: [PendingChatAttachment],
        visualFrame: PendingVisualFrame?
    ) async {
        defer { sentTurnAttachments = [] }
        guard let client else {
            isSending = false
            discardOptimisticMessage()
            actionError = startupError ?? "Chat is unavailable."
            return
        }

        do {
            var attachmentIDs: [String] = []
            if !attachments.isEmpty { statusLine = JarvisChatLocalization.string(.thinkingAttachments, language: appLanguage) }
            for attachment in attachments {
                if let uploaded = uploadedAttachmentIDs[attachment.id] {
                    attachmentIDs.append(uploaded)
                } else {
                    let descriptor = try await client.uploadAttachment(attachment.upload)
                    uploadedAttachmentIDs[attachment.id] = descriptor.id
                    attachmentIDs.append(descriptor.id)
                }
            }
            sentTurnAttachments = zip(attachments, attachmentIDs).map { attachment, id in
                ChatHistoryAttachment(
                    id: id, name: attachment.name, contentType: attachment.contentType, size: attachment.data.count
                )
            }
            if sessionID == nil {
                statusLine = thinkingPhrase
                let session = try await client.createSession(language: language)
                sessionID = session.id
                language = session.language
            }
            statusLine = thinkingPhrase
            guard let sessionID else { throw JarvisClientError.invalidRequest }
            var visualContext: ChatVisualContext?
            if let visualFrame {
                visualContext = try await client.uploadVisualFrame(
                    sessionId: sessionID, source: visualFrame.source, jpeg: visualFrame.jpeg, question: text
                )
            }
            let events = try await client.sendTurn(
                sessionId: sessionID,
                text: text,
                attachmentIds: attachmentIDs,
                visualContext: visualContext
            )
            pendingAttachments = []
            uploadedAttachmentIDs = [:]
            try await consume(events)
            discardOptimisticMessage()
            discardSteeringPlaceholders()
            await refreshHistory()
            isSending = false
        } catch is CancellationError {
            isSending = false
            activeMessageID = nil
            statusLine = nil
            streamingText = ""
            discardOptimisticMessage()
        } catch {
            isSending = false
            activeMessageID = nil
            statusLine = nil
            discardOptimisticMessage()
            if !Task.isCancelled { actionError = message(for: error) }
            // Keep any partial reply readable beside the failure; it is not a completed response.
        }
        sendTask = nil
    }

    /// Removes the local placeholder once the server's copy arrived or the turn failed.
    /// A sent message is never put back in the composer.
    private func discardSteeringPlaceholders() {
        guard !steeringMessageIDs.isEmpty else { return }
        let ids = Set(steeringMessageIDs)
        steeringMessageIDs = []
        messages.removeAll { ids.contains($0.id) }
    }

    private func discardOptimisticMessage() {
        guard let id = optimisticMessageID else { return }
        optimisticMessageID = nil
        messages.removeAll { $0.id == id }
    }

    private func loadChatLanguage() async {
        guard !fixtureMode, let settingsClient else { return }
        do {
            let settings = try await settingsClient.loadSettings()
            let rawLanguage: String
            if let value = settings.value(area: "voice", key: "defaultLanguage") {
                guard let parsedLanguage = value.stringValue else {
                    throw JarvisSettingsClientError.invalidResponse
                }
                rawLanguage = parsedLanguage
            } else {
                rawLanguage = ChatLanguage.da.rawValue
            }
            guard let language = ChatLanguage(rawValue: rawLanguage) else {
                throw JarvisSettingsClientError.invalidResponse
            }
            chatLanguage = language
            if sessionID == nil { self.language = language }
        } catch {
            chatLanguage = .da
            if sessionID == nil { language = .da }
            actionError = JarvisChatLocalization.string(.chatLanguageLoadFailed, language: appLanguage)
        }
    }

    private func reattach(_ turn: ActiveChatTurn) async {
        defer { sendTask = nil }
        guard let client else { return }
        do {
            try await consume(client.reattachTurn(sessionId: turn.sessionId, messageId: turn.messageId))
            await refreshHistory()
            isSending = false
        } catch is CancellationError {
            isSending = false
            activeMessageID = nil
            statusLine = nil
        } catch {
            isSending = false
            activeMessageID = nil
            statusLine = nil
            if !Task.isCancelled { actionError = message(for: error) }
        }
    }

    private func reattachActiveTurnIfNeeded() async {
        guard let client, activeMessageID == nil, !isSending else { return }
        do {
            let activeTurns = try await client.listActiveTurns()
            guard activeMessageID == nil,
                  let turn = ActiveChatTurnSelection.select(turns: activeTurns, forSessionID: sessionID) else {
                actionError = nil
                return
            }
            sessionID = turn.sessionId
            language = turn.language
            activeMessageID = turn.messageId
            turnMessageIDs.insert(turn.messageId)
            isSending = true
            turnStartedAt = nil
            progressUpdates = []
            statusLine = JarvisChatLocalization.string(.thinkingReconnecting, language: appLanguage)
            sendTask = Task { await reattach(turn) }
            actionError = nil
        } catch {
            actionError = message(for: error)
        }
    }

    private func recordToolActivity(_ tool: ChatToolActivity) {
        if let index = toolActivities.firstIndex(where: { $0.id == tool.id }) {
            if toolActivities[index].outcome == nil || tool.outcome != nil { toolActivities[index] = tool }
        } else {
            toolActivities.append(tool)
            if toolActivities.count > 128 { toolActivities.removeFirst() }
        }
    }

    private func consume(_ events: AsyncThrowingStream<ChatEvent, any Error>) async throws {
        for try await event in events {
            try Task.checkCancellation()
            switch event {
            case .connectionState(let state):
                isReconnecting = state == .reconnecting
            case .user(let message):
                if turnStartedAt == nil { turnStartedAt = ChatWorkProgress.startDate(message.at) ?? Date() }
                turnMessageIDs.insert(message.id)
                if activeMessageID == nil { activeMessageID = message.id }
                sessionID = message.sessionId
                discardOptimisticMessage()
                let attachments = activeMessageID == message.id && !sentTurnAttachments.isEmpty
                    ? sentTurnAttachments
                    : messages.first(where: { $0.id == message.id })?.attachments ?? []
                addOrReplace(JarvisChatRow(message, attachments: attachments))
            case .delta(let text):
                streamingText += text
            case .acknowledgment(let text):
                acknowledgment = text
                streamingText = ChatWorkProgress.removingUpdate(text, from: streamingText)
            case .commentary(let text):
                progressUpdates.append(text)
                streamingText = ChatWorkProgress.removingUpdate(text, from: streamingText)
            case .interrupted(let message):
                var row = JarvisChatRow(message)
                row.interrupted = true
                addOrReplace(row)
                streamingText = ""
                // Preserve interim updates across steering within the same turn.
                // An interrupted round can continue with a steering message on the same turn.
            case .done(let message):
                addOrReplace(JarvisChatRow(message))
                activeMessageID = nil
                streamingText = ""
                statusLine = nil
                acknowledgment = nil
                progressUpdates = []
                isReconnecting = false
            case .toolActivity(let tool):
                recordToolActivity(tool)
            case .progress(let progress):
                statusLine = JarvisChatLocalization.string(
                    progress.phase == .tools ? .turnWorking : .turnWriting, language: appLanguage
                )
            case .foodInvitation, .error, .unknown:
                break
            }
        }
        try Task.checkCancellation()
    }

    private func refreshHistory() async {
        guard let client else { return }
        do {
            let page = try await client.history()
            apply(page, replacing: false)
            historyPaging.refreshLatestPage(nextCursor: page.nextCursor)
        } catch {
            actionError = message(for: error)
        }
    }

    private func apply(_ page: ChatHistoryPage, replacing: Bool) {
        let incoming = page.messages
            .filter { $0.channel == .chat || $0.channel == .voice }
            .map(JarvisChatRow.init)
        messages = sorted(replacing ? incoming : messages + incoming)
        // One visible conversation, with transport-specific session IDs kept
        // separate so a typed reply never targets an ended voice session.
        if let latest = messages.last(where: { $0.channel == .chat }) {
            let latestMessage = page.messages.first { $0.id == latest.id }
            sessionID = latestMessage?.sessionId ?? sessionID
            language = latestMessage?.language ?? language
        }
    }

    private func addOrReplace(_ message: JarvisChatRow) {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
        } else {
            messages.append(message)
        }
        messages = sorted(messages)
    }

    private func sorted(_ values: [JarvisChatRow]) -> [JarvisChatRow] {
        values.reduce(into: [String: JarvisChatRow]()) { result, message in
            result[message.id] = message
        }.values.sorted {
            if $0.at == $1.at { return $0.id < $1.id }
            return (date(from: $0.at) ?? .distantPast) < (date(from: $1.at) ?? .distantPast)
        }
    }

    private func date(from value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }

    private func message(for error: any Error) -> String {
        if let error = error as? JarvisClientError {
            switch error {
            case .signInRequired: chatCopy(.errSignIn)
            case .notOwner: chatCopy(.errNotOwner)
            case .rateLimited: chatCopy(.errRateLimited)
            case .serviceUnavailable: chatCopy(.errUnavailable)
            case .networkFailure: chatCopy(.errOffline)
            case .timedOut: chatCopy(.errTimedOut)
            default: chatCopy(.errGeneric)
            }
        } else if let error = error as? JarvisChatClientError {
            switch error {
            case .invalidUpload: chatCopy(.errInvalidUpload)
            case .tooManyAttachments: chatCopy(.errTooMany)
            case .invalidTextLength: chatCopy(.errTextLength)
            case .turnNotFound: chatCopy(.errTurnNotFound)
            case .reattachTimedOut: chatCopy(.errReattach)
            default: chatCopy(.errTurn)
            }
        } else if let error = error as? JarvisNowFeedClientError,
                  error == .activityUnavailable {
            chatCopy(.errActivityGone)
        } else if let error = error as? JarvisApprovalsClientError,
                  error == .confirmationUnavailable {
            chatCopy(.errConfirmationGone)
        } else if let error = error as? JarvisApprovalsClientError,
                  error == .awayMode {
            chatCopy(.errAwayMode)
        } else {
            chatCopy(.errLoad)
        }
    }
}
