import JarvisCore
import SwiftUI

/// Owns only an explicitly created test session. It never changes the normal Chat model.
@MainActor
private final class JarvisRuntimeTestModel: ObservableObject {
    @Published var availability: ChatRuntimeAvailability?
    @Published var selection: ChatRuntimeTest?
    @Published var session: ChatSession?
    @Published var messages: [JarvisChatRow] = []
    @Published var draft = ""
    @Published var partial = ""
    @Published var loading = false
    @Published var creating = false
    @Published var sending = false
    @Published var stopping = false
    @Published var error: JarvisChatLocalizationKey?
    @Published var recovery = ChatRuntimeRecovery()
    @Published var nextCursor: String?
    @Published var activeMessageID: String?
    private let client: JarvisChatClient?
    private let language: ChatLanguage
    private var turn: Task<Void, Never>?

    init(client: JarvisChatClient?, language: ChatLanguage) {
        self.client = client
        self.language = language
    }

    var canSend: Bool {
        session != nil && !loading && !sending && !recovery.requiresHistoryReview && !recovery.sessionBlocked &&
            !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func checkAvailability() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            guard let client else { throw JarvisChatClientError.invalidResponse }
            let value = try await client.runtimeTestAvailability()
            try Task.checkCancellation()
            availability = value
            if let selection, availability?[selection].available != true { self.selection = nil }
        } catch {
            guard !Task.isCancelled else { return }
            availability = nil
            selection = nil
            self.error = .runtimeVerificationFailed
        }
    }

    func open() async {
        guard !loading, session == nil, let selection, availability?[selection].available == true else { return }
        loading = true
        creating = true
        error = nil
        do {
            guard let client else { throw JarvisChatClientError.invalidResponse }
            session = try await client.createSession(language: language, runtimeTest: selection)
        } catch { self.error = .runtimeCreateFailed }
        loading = false
        creating = false
        if session != nil { await refreshHistory() }
    }

    func refreshHistory(older: Bool = false) async {
        guard !loading, !sending, let client, let session else { return }
        loading = true
        defer { loading = false }
        do {
            let page = try await client.history(before: older ? nextCursor : nil, sessionId: session.id)
            try Task.checkCancellation()
            let incoming = page.messages.map(JarvisChatRow.init)
            messages = older ? incoming + messages.filter { row in !incoming.contains { $0.id == row.id } } : incoming
            nextCursor = page.nextCursor
            partial = ""
            recovery.historyReviewed()
            error = recovery.sessionBlocked ? .runtimeBlocked : nil
        } catch {
            guard !Task.isCancelled else { return }
            recovery.failed(code: nil)
            self.error = .runtimeHistoryFailed
        }
    }

    func send() {
        guard canSend, let client, let session else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        sending = true
        error = nil
        partial = ""
        activeMessageID = nil
        turn = Task {
            defer {
                sending = false
                stopping = false
                activeMessageID = nil
                turn = nil
            }
            do {
                let events = try await client.sendTurn(sessionId: session.id, text: text)
                for try await event in events {
                    switch event {
                    case .user(let message):
                        activeMessageID = message.id
                        append(JarvisChatRow(message))
                    case .delta(let text): partial += text
                    case .done(let message):
                        append(JarvisChatRow(message))
                        partial = ""
                    case .interrupted(let message): append(JarvisChatRow(message))
                    case .error(let failure): throw JarvisChatClientError.serverEvent(code: failure.code, message: nil)
                    case .acknowledgment, .foodInvitation, .unknown, .connectionState: break
                    }
                }
            } catch {
                if activeMessageID == nil { draft = text }
                let code: String?
                if let failure = error as? JarvisChatClientError, case .serverEvent(let value, _) = failure { code = value } else { code = nil }
                recovery.failed(code: code)
                self.error = recovery.sessionBlocked ? .runtimeBlocked : .runtimeUncertain
            }
        }
    }

    func stop() async {
        guard !stopping, let client, let session, let activeMessageID else { return }
        stopping = true
        defer { stopping = false }
        do {
            // Keep consuming the stream after cancellation so the final saved reply is visible.
            _ = try await client.cancelTurn(sessionId: session.id, messageId: activeMessageID)
        } catch { self.error = .runtimeStopFailed }
    }

    private func append(_ message: JarvisChatRow) {
        messages.removeAll { $0.id == message.id }
        messages.append(message)
    }
}

struct JarvisRuntimeTestSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var model: JarvisRuntimeTestModel
    @FocusState private var inputFocused: Bool
    @State private var requestTask: Task<Void, Never>?
    private let appLanguage: JarvisAppLanguage
    private let fixtureMode: Bool

    init(client: JarvisChatClient?, language: ChatLanguage, appLanguage: JarvisAppLanguage, fixtureMode: Bool = false) {
        _model = StateObject(wrappedValue: JarvisRuntimeTestModel(client: client, language: language))
        self.appLanguage = appLanguage
        self.fixtureMode = fixtureMode
    }

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: appLanguage)
    }

    private func label(_ runtime: ChatRuntimeTest) -> String {
        runtime == .copilot ? "Copilot" : copy(.runtimeCurrent)
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
                        if model.session?.runtimeTest != nil {
                            Text(copy(.runtimeHistoryNotice)).foregroundStyle(.secondary)
                            transcript
                        } else {
                            selector
                        }
                        if let error = model.error {
                            Text(copy(error)).foregroundStyle(.primary)
                                .accessibilityIdentifier("runtimeTest.error")
                            if model.session != nil {
                                JarvisLabelledButton(title: copy(.runtimeRefreshHistory), systemImage: "arrow.clockwise",
                                                     identifier: "runtimeTest.refresh", isDisabled: model.loading || model.sending) {
                                    perform { await model.refreshHistory() }
                                }
                            }
                        }
                        Color.clear.frame(height: 1).id("runtimeTest.bottom")
                    }
                    .padding(JarvisDesignTokens.chatHorizontalInset)
                }
                .onChange(of: model.partial) { _, _ in proxy.scrollTo("runtimeTest.bottom", anchor: .bottom) }
                .onChange(of: model.messages.count) { _, _ in proxy.scrollTo("runtimeTest.bottom", anchor: .bottom) }
                .safeAreaInset(edge: .bottom) {
                    if model.session != nil { composer }
                }
            }
            .navigationTitle(model.session?.runtimeTest.map { "\(label($0)) · \(copy(.runtimeTitle))" } ?? copy(.runtimeTest))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    JarvisSheetCloseButton(title: copy(.runtimeReturn), isDisabled: model.sending || model.creating) { dismiss() }
                }
                .sharedBackgroundVisibility(.hidden)
            }
            .jarvisAmbientBackground(transparentNavigationBar: true)
        }
        .interactiveDismissDisabled(model.sending || model.creating)
        .task { await model.checkAvailability() }
        .onDisappear { requestTask?.cancel() }
    }

    private var selector: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
            Text(copy(.runtimeTestIntro)).foregroundStyle(.secondary)
            if model.loading { JarvisLoadingView(title: copy(.runtimeChecking)) }
            ForEach(ChatRuntimeTest.allCases, id: \.rawValue) { runtime in
                let option = model.availability?[runtime]
                VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                    JarvisLabelledButton(title: label(runtime), systemImage: model.selection == runtime ? "checkmark.circle.fill" : "circle",
                                         identifier: "runtimeTest.\(runtime.rawValue)", isDisabled: model.loading || option?.available != true,
                                         isFullWidth: true, isLeading: true, isSelected: model.selection == runtime,
                                         usesSelectionFeedback: true) { model.selection = runtime }
                    if let option, !option.available {
                        Text(copy(reason(option.reason))).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            JarvisLabelledButton(title: copy(.runtimeOpen), systemImage: "bubble.left.and.bubble.right",
                                 identifier: "runtimeTest.open", isBusy: model.loading,
                                 isDisabled: model.selection == nil, isFullWidth: true, isEmphasised: true) {
                perform { await model.open() }
            }
            JarvisLabelledButton(title: copy(.runtimeRetry), systemImage: "arrow.clockwise",
                                 identifier: "runtimeTest.retry", isDisabled: model.loading) {
                perform { await model.checkAvailability() }
            }
        }
    }

    @ViewBuilder private var transcript: some View {
        if model.loading { JarvisLoadingView(title: copy(.runtimeRefreshHistory)) }
        if model.nextCursor != nil {
            JarvisLabelledButton(title: copy(.runtimeOlder), identifier: "runtimeTest.older", isDisabled: model.loading || model.sending) {
                perform { await model.refreshHistory(older: true) }
            }
        }
        if !model.loading && model.messages.isEmpty && !model.sending {
            Text(copy(.runtimeEmpty)).foregroundStyle(.secondary)
        }
        ForEach(model.messages) { message in
            VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                Text(message.role == .dan ? copy(.runtimeYou) : "Jarvis").font(.headline)
                Text(.init(message.text)).textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("runtimeTest.message.\(message.id)")
        }
        if !model.partial.isEmpty { Text(.init(model.partial)).textSelection(.enabled) }
        if model.sending { JarvisLoadingView(title: copy(.runtimeSending)) }
    }

    private var composer: some View {
        JarvisComposerBar(placeholder: copy(.runtimeMessage), text: $model.draft, isFocused: $inputFocused,
                          inputIdentifier: "runtimeTest.input", isInputDisabled: model.loading || model.sending || model.recovery.requiresHistoryReview || model.recovery.sessionBlocked,
                          rimState: model.sending ? .thinking : .idle, isRimAnimated: !fixtureMode && !reduceMotion,
                          onSubmit: model.send, header: { EmptyView() }, leading: { EmptyView() }, actions: {
            if model.sending {
                JarvisComposerIconButton(title: copy(.runtimeStop), systemImage: "stop.fill", identifier: "runtimeTest.stop",
                                         isDisabled: model.activeMessageID == nil || model.stopping) { Task { await model.stop() } }
            } else {
                JarvisComposerIconButton(title: copy(.sendMessage), systemImage: "arrow.up", identifier: "runtimeTest.send",
                                         isDisabled: !model.canSend, action: model.send)
            }
        })
    }

    private func perform(_ action: @escaping @MainActor () async -> Void) {
        requestTask?.cancel()
        requestTask = Task { await action() }
    }

    private func reason(_ code: String?) -> JarvisChatLocalizationKey {
        switch code {
        case "copilot_not_configured": .runtimeNotConfigured
        case "copilot_not_verified": .runtimeNotVerified
        case "copilot_policy_not_verified": .runtimePolicyNotVerified
        case "copilot_settings_mismatch": .runtimeSettingsMismatch
        case "copilot_definition_mismatch": .runtimeDefinitionMismatch
        case "verification_unavailable": .runtimeVerificationFailed
        case "storage_unavailable": .runtimeStorageUnavailable
        default: .runtimeUnavailable
        }
    }
}
