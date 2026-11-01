import Foundation
import JarvisCore
import SwiftUI

struct JarvisChatRow: Identifiable, Equatable {
    let id: String
    let role: ConversationRole
    var text: String
    let at: String
    var interrupted: Bool
    var toolCalls: [ChatHistoryToolCall]
    let attachments: [ChatHistoryAttachment]

    init(_ message: ChatHistoryMessage) {
        id = message.id
        role = message.role
        text = message.text
        at = message.at
        interrupted = message.interrupted
        toolCalls = message.toolCalls
        attachments = message.attachments
    }

    init(_ message: ChatMessage) {
        id = message.id
        role = message.role
        text = message.text
        at = message.at
        interrupted = false
        toolCalls = []
        attachments = []
    }
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
    @Published var draft = ""
    @Published var pendingAttachments: [PendingChatAttachment] = []
    @Published var isLoading = true
    @Published var isLoadingOlder = false
    @Published var isSending = false
    @Published var isCancelling = false
    @Published var resolvingConfirmationDecisions = [String: ConfirmationDecision]()
    @Published var dismissingActivityIDs = Set<String>()
    @Published var historyError: String?
    @Published var actionError: String?
    @Published var statusLine: String?
    @Published var streamingText = ""
    @Published var nowFeed: JarvisNowFeed?
    @Published private(set) var backgroundTasks: [BackgroundTaskRecord] = []
    @Published var activityError: String?
    @Published var activityMessage: String?
    @Published private(set) var voiceLanguage: ChatLanguage = .da

    private let client: JarvisChatClient?
    private let nowClient: JarvisNowFeedClient?
    private let updatesClient: JarvisWorkspaceClient?
    private let settingsClient: JarvisSettingsClient?
    private let factoryClient: JarvisFactoryClient?
    private var historyPaging = ChatHistoryPagingState()
    private var sessionID: String?
    private var language: ChatLanguage
    private var activeMessageID: String?
    private var uploadedAttachmentIDs: [UUID: String] = [:]
    private var sendTask: Task<Void, Never>?
    private var observationSuspended = false
    private var didLoad = false
    private var fixtureTurnUsed = false
    let fixtureMode: Bool
    let startupError: String?

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
        if let client { JarvisFactoryLiveActivityController.configure(client: client) }
        self.fixtureMode = fixtureMode
        self.startupError = startupError
        language = .da
    }

    var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            (!fixtureMode || !fixtureTurnUsed)
    }

    var fixtureTurnUnavailable: Bool { fixtureMode && fixtureTurnUsed }
    var canCancel: Bool { activeMessageID != nil }
    var hasOlderMessages: Bool { historyPaging.nextCursor != nil }

    var activeConfirmation: PendingConfirmation? {
        nowFeed?.confirmations.first
    }

    var shouldShowNowBar: Bool {
        isSending || !backgroundTasks.isEmpty || nowFeed.map {
            !$0.confirmations.isEmpty ||
                !$0.running.isEmpty ||
                !$0.items.isEmpty
        } == true
    }

    var needsYouCount: Int {
        guard let nowFeed else { return 0 }
        return nowFeed.confirmations.count + nowFeed.items.filter {
            $0.category == .attention || $0.category == .credential || $0.category == .alert
        }.count
    }

    var nowTitle: String {
        if activeConfirmation != nil {
            return "Waiting for approval"
        }
        if isSending {
            return statusLine ?? "Thinking…"
        }
        if let task = nowFeed?.running.first {
            return task.activity.isEmpty ? task.title : task.activity
        }
        if let task = backgroundTasks.first(where: { $0.status == .running }) {
            return task.detail ?? task.title
        }
        return nowFeed?.awayMode == true ? "Away mode" : "Background activity"
    }

    func load() async {
        guard !didLoad else { return }
        didLoad = true
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
        await loadVoiceLanguage()
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
            actionError = "You can attach up to five files."
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

    func setVoiceLanguage(_ language: ChatLanguage) async {
        guard !fixtureMode, !isSending, language != voiceLanguage, let settingsClient else { return }
        do {
            _ = try await settingsClient.saveSettings(
                JarvisSettingsPatch(
                    area: "voice",
                    key: "defaultLanguage",
                    value: .string(language.rawValue)
                )
            )
            voiceLanguage = language
            self.language = language
            sessionID = nil
            actionError = nil
        } catch {
            actionError = JarvisChatLocalization.string(.voiceLanguageUpdateFailed, language: appLanguage)
        }
    }

    func send() {
        guard !isSending, canSend else { return }
        if fixtureMode { fixtureTurnUsed = true }
        isSending = true
        isCancelling = false
        actionError = nil
        statusLine = "Thinking…"
        streamingText = ""
        let text = draft
        let attachments = pendingAttachments
        sendTask = Task { await sendTurn(text: text, attachments: attachments) }
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
            activityError = startupError ?? "Activity is unavailable."
            return
        }
        do {
            nowFeed = try await nowClient.load()
            activityError = nil
            let language = JarvisAppLanguage(
                rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
            ) ?? .default
            let liveBackgroundTasks: [BackgroundTaskRecord]
            do {
                liveBackgroundTasks = try await nowClient.backgroundTasks()
                backgroundTasks = liveBackgroundTasks
            } catch {
                // Keep existing approvals and Factory updates independent of job storage.
                liveBackgroundTasks = []
                activityError = message(for: error)
            }
            await JarvisFactoryLiveActivityController.synchronize(
                nowFeed?.running ?? [], backgroundTasks: liveBackgroundTasks,
                factoryClient: factoryClient, language: language
            )
            await JarvisApprovalNotificationCoordinator.shared.synchronize(
                nowFeed?.confirmations ?? [],
                language: language
            )
            consumeLockScreenApprovalResult()
        } catch {
            activityError = message(for: error)
        }
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
        guard !fixtureMode else { return }
        guard let updatesClient else { return }
        do {
            for try await event in updatesClient.events() {
                try Task.checkCancellation()
                switch event {
                case .pendingConfirmationsChanged, .activityChanged:
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
            activityMessage = "Activity dismissed."
            nowFeed = try await nowClient.load()
            activityError = nil
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
            activityMessage = decision == .approve ? "Approval recorded." : "Request declined."
            nowFeed = try await nowClient.load()
            activityError = nil
        } catch {
            activityError = message(for: error)
        }
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

    private func sendTurn(text: String, attachments: [PendingChatAttachment]) async {
        guard let client else {
            isSending = false
            actionError = startupError ?? "Chat is unavailable."
            return
        }

        do {
            var attachmentIDs: [String] = []
            if !attachments.isEmpty { statusLine = "Uploading attachments…" }
            for attachment in attachments {
                if let uploaded = uploadedAttachmentIDs[attachment.id] {
                    attachmentIDs.append(uploaded)
                } else {
                    let descriptor = try await client.uploadAttachment(attachment.upload)
                    uploadedAttachmentIDs[attachment.id] = descriptor.id
                    attachmentIDs.append(descriptor.id)
                }
            }
            if sessionID == nil {
                statusLine = "Thinking…"
                let session = try await client.createSession(language: language)
                sessionID = session.id
                language = session.language
            }
            statusLine = "Thinking…"
            guard let sessionID else { throw JarvisClientError.invalidRequest }
            let events = try await client.sendTurn(
                sessionId: sessionID,
                text: text,
                attachmentIds: attachmentIDs
            )
            draft = ""
            pendingAttachments = []
            uploadedAttachmentIDs = [:]
            try await consume(events)
            await refreshHistory()
            isSending = false
        } catch is CancellationError {
            isSending = false
            activeMessageID = nil
            statusLine = nil
            streamingText = ""
        } catch {
            isSending = false
            activeMessageID = nil
            statusLine = nil
            if !Task.isCancelled { actionError = message(for: error) }
            streamingText = ""
        }
        sendTask = nil
    }

    private func loadVoiceLanguage() async {
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
            voiceLanguage = language
            if sessionID == nil { self.language = language }
        } catch {
            voiceLanguage = .da
            if sessionID == nil { language = .da }
            actionError = JarvisChatLocalization.string(.voiceLanguageLoadFailed, language: appLanguage)
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
            isSending = true
            statusLine = "Reconnecting…"
            sendTask = Task { await reattach(turn) }
            actionError = nil
        } catch {
            actionError = message(for: error)
        }
    }

    private func consume(_ events: AsyncThrowingStream<ChatEvent, any Error>) async throws {
        for try await event in events {
            try Task.checkCancellation()
            switch event {
            case .user(let message):
                activeMessageID = message.id
                sessionID = message.sessionId
                addOrReplace(JarvisChatRow(message))
            case .delta(let text):
                streamingText += text
            case .acknowledgment(let text):
                statusLine = text
            case .interrupted(let message), .done(let message):
                addOrReplace(JarvisChatRow(message))
                activeMessageID = nil
                streamingText = ""
                statusLine = nil
            case .foodInvitation, .error, .unknown:
                break
            }
        }
        try Task.checkCancellation()
    }

    private func refreshHistory() async {
        guard let client else { return }
        do {
            let page = try await client.history(sessionId: sessionID)
            apply(page, replacing: false)
            historyPaging.refreshLatestPage(nextCursor: page.nextCursor)
        } catch {
            actionError = message(for: error)
        }
    }

    private func apply(_ page: ChatHistoryPage, replacing: Bool) {
        let incoming = page.messages
            .filter { $0.channel == .chat }
            .map(JarvisChatRow.init)
        messages = sorted(replacing ? incoming : messages + incoming)
        if let latest = messages.last {
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
            case .signInRequired: "Sign in is required."
            case .notOwner: "This account cannot access Jarvis."
            case .rateLimited: "Jarvis is busy. Try again later."
            case .serviceUnavailable: "Jarvis is unavailable. Try again."
            case .networkFailure, .timedOut: "You're offline. Check your connection."
            default: "Jarvis could not complete the request."
            }
        } else if let error = error as? JarvisChatClientError {
            switch error {
            case .invalidUpload: "This attachment type or size is not supported."
            case .tooManyAttachments: "You can attach up to five files."
            case .invalidTextLength: "Enter a message before sending."
            case .turnNotFound: "The active turn is no longer available."
            case .reattachTimedOut: "Jarvis could not reconnect to the active turn."
            default: "Jarvis could not complete the turn."
            }
        } else if let error = error as? JarvisNowFeedClientError,
                  error == .activityUnavailable {
            "This activity is no longer available."
        } else if let error = error as? JarvisApprovalsClientError,
                  error == .confirmationUnavailable {
            "This confirmation is no longer available."
        } else if let error = error as? JarvisApprovalsClientError,
                  error == .awayMode {
            "Away mode is on. This request wasn't approved."
        } else {
            "Jarvis could not load this information."
        }
    }
}
