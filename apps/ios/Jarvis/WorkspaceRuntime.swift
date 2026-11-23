import JarvisCore
import SwiftUI

enum WorkspaceConnectionStatus: Equatable {
    case unavailable
    case connecting
    case connected
    case reconnecting
    case offline
    case stale

    func title(language: JarvisAppLanguage) -> String {
        let key: JarvisWorkspaceLocalizationKey
        switch self {
        case .unavailable: key = .notConnected
        case .connecting: key = .connecting
        case .connected: key = .connected
        case .reconnecting: key = .reconnecting
        case .offline: key = .offline
        case .stale: key = .refreshConnection
        }
        return JarvisWorkspaceLocalization.string(key, language: language)
    }

    var symbolName: String {
        switch self {
        case .unavailable, .offline, .stale: "wifi.slash"
        case .connecting, .reconnecting: "arrow.triangle.2.circlepath"
        case .connected: "checkmark.circle"
        }
    }
}

/// Where a workspace command or an action in generated content sends the owner inside the app.
enum WorkspaceNavigation: Equatable {
    case destination(JarvisDestination)
    case notesGraph
    case factoryTask(String)
}

@MainActor
final class WorkspaceRuntime: ObservableObject {
    let workspacesClient: JarvisWorkspacesClient?

    @Published private(set) var connectionStatus: WorkspaceConnectionStatus
    @Published private(set) var presentedView: PresentedWorkspaceView?
    @Published private(set) var voiceVisuals: VoiceVisualHistory?
    @Published private(set) var requestedNavigation: WorkspaceNavigation?

    private let client: JarvisClient?
    private var workspaceClient: JarvisWorkspaceClient?
    private var knownViews: [String: GeneratedView] = [:]
    private var lastPresentedViewId: String?
    private var trustedBlobHost: String?
    private var sessionGeneration = 0
    private var mapLookups: [String: Task<Void, Never>] = [:]
    weak var mapVoice: VoiceScreenModel?

    private var language: JarvisAppLanguage {
        .default
    }

    init(client: JarvisClient?) {
        self.client = client
        workspacesClient = client.map(JarvisWorkspacesClient.init(client:))
        workspaceClient = client.map { JarvisWorkspaceClient(client: $0) }
        connectionStatus = client == nil ? .unavailable : .connecting
    }

    func run() async {
        guard let workspaceClient else { return }
        let generation = sessionGeneration
        defer { if generation == sessionGeneration { cancelMapLookups() } }
        do {
            for try await event in workspaceClient.events() {
                guard !Task.isCancelled, generation == sessionGeneration else { return }
                switch event {
                case .workspaceReady(_, let host):
                    trustedBlobHost = host
                    do {
                        try await registerCurrentSnapshot()
                        guard !Task.isCancelled, generation == sessionGeneration else { return }
                        connectionStatus = .connected
                    } catch {
                        guard !Task.isCancelled, generation == sessionGeneration else { return }
                        updateConnectionStatus(for: error)
                    }
                case .workspaceCommand(let command, let expiresAtMilliseconds, let host):
                    if command.operation == "apple-maps" {
                        startMapLookup(command, expiresAt: expiresAtMilliseconds, using: workspaceClient)
                    } else {
                        await handle(command, expiresAtMilliseconds: expiresAtMilliseconds, trustedBlobHost: host)
                    }
                case .workspaceCancel(let id):
                    mapLookups.removeValue(forKey: id)?.cancel()
                case .connectionInterrupted:
                    cancelMapLookups()
                    connectionStatus = .reconnecting
                case .pendingConfirmationsChanged, .activityChanged, .factoryBoardChanged, .chatToolActivity, .unknown:
                    break
                }
            }
            guard !Task.isCancelled, generation == sessionGeneration else { return }
            connectionStatus = .offline
        } catch {
            guard !Task.isCancelled, generation == sessionGeneration else { return }
            updateConnectionStatus(for: error)
        }
    }

    func resetSession() {
        cancelMapLookups()
        JarvisAppleMapsStore.shared.clear()
        sessionGeneration += 1
        workspaceClient = client.map { JarvisWorkspaceClient(client: $0) }
        knownViews.removeAll()
        lastPresentedViewId = nil
        trustedBlobHost = nil
        presentedView = nil
        voiceVisuals = nil
        requestedNavigation = nil
        connectionStatus = workspaceClient == nil ? .unavailable : .connecting
    }

#if DEBUG && targetEnvironment(simulator)
    private var fixtureHTMLArtifact: HtmlArtifact?

    /// Simulator captures only: shows synthetic content without a backend command.
    func presentFixture(viewId: String, view: GeneratedView, artifact: HtmlArtifact? = nil) {
        if let artifact { fixtureHTMLArtifact = artifact }
        knownViews[viewId] = view
        present(viewId: viewId, view: view)
    }
#endif

    func consumeRequestedNavigation() -> WorkspaceNavigation? {
        defer { requestedNavigation = nil }
        return requestedNavigation
    }

    /// The knowledge-graph card's own action: the vault graph lives in Notes.
    func openNotesGraph() {
        requestedNavigation = .notesGraph
    }

    /// Tells the backend this phone is the device Dan is using now. Commands addressed to the active device go to
    /// the one that reported last, so Voice calls this when it opens, or a browser tab could receive what Jarvis shows.
    func reportActive() {
        let generation = sessionGeneration
        Task {
            guard generation == sessionGeneration else { return }
            do {
                try await registerCurrentSnapshot()
                guard generation == sessionGeneration else { return }
                connectionStatus = .connected
            } catch {
                guard generation == sessionGeneration else { return }
                // Before the stream is ready there is nothing to report to; the ready event reports the snapshot itself.
                if let workspaceError = error as? JarvisWorkspaceClientError, workspaceError == .noActiveConnection { return }
                updateConnectionStatus(for: error)
            }
        }
    }

    func userDismissedView() {
        guard presentedView != nil || voiceVisuals?.entries.isEmpty == false else { return }
        presentedView = nil
        if voiceVisuals != nil { voiceVisuals = VoiceVisualHistory() }
        let generation = sessionGeneration
        Task {
            guard generation == sessionGeneration else { return }
            do {
                try await registerCurrentSnapshot()
                guard generation == sessionGeneration else { return }
                connectionStatus = .connected
            } catch {
                guard generation == sessionGeneration else { return }
                updateConnectionStatus(for: error)
            }
        }
    }

    func beginVoiceVisuals() {
        userDismissedView()
        voiceVisuals = VoiceVisualHistory()
    }

    func endVoiceVisuals() {
        guard voiceVisuals != nil else { return }
        userDismissedView()
        voiceVisuals = nil
    }

    func selectVoiceVisual(_ id: String) {
        guard voiceVisuals?.selectedID != id else { return }
        voiceVisuals?.select(id)
    }

    func openRoute(_ route: String) -> Bool {
        guard let navigation = Self.routeNavigation(for: route) else { return false }
        requestedNavigation = navigation
        return true
    }

    func loadHTMLArtifact(id: String) async throws -> HtmlArtifact {
#if DEBUG && targetEnvironment(simulator)
        if let fixtureHTMLArtifact, id == fixtureHTMLArtifact.id { return fixtureHTMLArtifact }
#endif
        guard let workspaceClient else {
            throw JarvisWorkspaceClientError.invalidResponse
        }
        return try await workspaceClient.htmlArtifact(id: id)
    }

    func canPerform(_ action: GeneratedViewAction) -> Bool {
        switch action {
        case .openRoute(let route):
            return Self.routeNavigation(for: route) != nil
        case .openLink(let value, _):
            return Self.isSafeWebLink(value)
        case .callTool:
            return false
        case .window(let windowAction):
            guard knownViews[windowAction.windowId] != nil else { return false }
            // A phone shows one view at a time, so moving or resizing one brings it forward.
            return true
        }
    }

    func perform(_ action: GeneratedViewWindowAction) -> Bool {
        guard canPerform(.window(action)) else { return false }
        switch action.operation {
        case .focus, .restore, .move, .resize:
            guard let view = knownViews[action.windowId] else { return false }
            present(viewId: action.windowId, view: view)
        case .close:
            guard knownViews[action.windowId] != nil else { return false }
            knownViews.removeValue(forKey: action.windowId)
            dismiss(viewId: action.windowId)
        case .minimise:
            guard knownViews[action.windowId] != nil else { return false }
            dismiss(viewId: action.windowId)
        }
        let generation = sessionGeneration
        Task {
            guard generation == sessionGeneration else { return }
            do {
                try await registerCurrentSnapshot()
            } catch {
                guard generation == sessionGeneration else { return }
                updateConnectionStatus(for: error)
            }
        }
        return true
    }

    private func cancelMapLookups() {
        for lookup in mapLookups.values { lookup.cancel() }
        mapLookups.removeAll()
    }

    private func startMapLookup(_ command: WorkspaceCommand, expiresAt: Int64, using client: JarvisWorkspaceClient) {
        let id = command.commandId
        let remaining = Double(expiresAt) / 1_000 - Date().timeIntervalSince1970
        guard mapLookups[id] == nil, remaining > 0 else { return }
        mapLookups[id] = Task {
            let deadline = Task {
                do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
                mapLookups.removeValue(forKey: id)?.cancel()
            }
            defer {
                deadline.cancel()
                if !Task.isCancelled { mapLookups[id] = nil }
            }
            do {
                guard UIApplication.shared.applicationState == .active else {
                    try await client.acknowledge(commandId: id, expiresAtMilliseconds: expiresAt, applied: false,
                        outcome: .refused, reason: "Open Jarvis on the iPhone to search Apple Maps.")
                    return
                }
                guard let lookup = try await JarvisAppleMapsStore.shared.resolve(lookupId: id, command: command) else {
                    try await client.acknowledge(commandId: id, expiresAtMilliseconds: expiresAt, applied: false,
                        outcome: .refused, reason: "The phone could not read the Apple Maps request.")
                    return
                }
                guard lookup.status != .unavailable else {
                    try await client.acknowledge(commandId: id, expiresAtMilliseconds: expiresAt, applied: false,
                        outcome: .error, reason: "Apple Maps is unavailable on the phone.")
                    return
                }
                let spoken: Bool
                if command.fields["speakResult"] == .bool(true), let mapVoice {
                    spoken = await mapVoice.speakAppleMaps(lookup.result)
                } else {
                    spoken = false
                }
                try Task.checkCancellation()
                let receipt = WorkspaceMapReceipt(matches: lookup.result.places.count, spoken: spoken, reason: lookup.status)
                try await client.acknowledge(commandId: id, expiresAtMilliseconds: expiresAt, applied: true, mapReceipt: receipt)
            } catch {
                if !Task.isCancelled, let error = error as? JarvisWorkspaceClientError, error == .staleConnection {
                    updateConnectionStatus(for: error)
                }
            }
        }
    }

    private func handle(
        _ command: WorkspaceCommand,
        expiresAtMilliseconds: Int64,
        trustedBlobHost: String?
    ) async {
        guard let workspaceClient else { return }
        let generation = sessionGeneration
        let result = apply(command, trustedBlobHost: trustedBlobHost ?? self.trustedBlobHost)
        do {
            try await WorkspaceCommandProcessor().acknowledge(
                command: command,
                expiresAtMilliseconds: expiresAtMilliseconds,
                trustedBlobHost: trustedBlobHost ?? self.trustedBlobHost,
                using: workspaceClient
            ) { _, _ in result }
        } catch {
            guard !Task.isCancelled, generation == sessionGeneration else { return }
            updateConnectionStatus(for: error)
            return
        }
        guard !Task.isCancelled, generation == sessionGeneration else { return }
        if result == .applied {
            do {
                try await registerCurrentSnapshot()
                guard !Task.isCancelled, generation == sessionGeneration else { return }
                connectionStatus = .connected
            } catch {
                guard !Task.isCancelled, generation == sessionGeneration else { return }
                updateConnectionStatus(for: error)
            }
        }
    }

    private func apply(_ command: WorkspaceCommand, trustedBlobHost: String?) -> WorkspaceCommandResult {
        switch WorkspaceCommandInterpreter.interpret(
            command,
            trustedBlobHost: trustedBlobHost,
            language: language
        ) {
        case .refused(let reason):
            return .refused(reason: reason)
        case .error(let reason):
            return .error(reason: reason)
        case .supported(let intent):
            switch intent {
            case .navigate(let page, let taskId):
                if page == "factory", let taskId {
                    requestedNavigation = .factoryTask(taskId)
                } else if page == "knowledge" {
                    requestedNavigation = .notesGraph
                } else if let destination = Self.destination(for: page) {
                    requestedNavigation = .destination(destination)
                } else {
                    return .refused(reason: JarvisWorkspaceLocalization.string(.destinationUnavailable, language: language))
                }
            case .present(let viewId, let view):
                knownViews[viewId] = view
                present(viewId: viewId, view: view)
            case .focus(let viewId):
                guard let view = knownViews[viewId] else {
                    return .refused(reason: JarvisWorkspaceLocalization.string(.viewUnavailable, language: language))
                }
                present(viewId: viewId, view: view)
            case .dismissAll(let forget):
                presentedView = nil
                if voiceVisuals != nil { voiceVisuals = VoiceVisualHistory() }
                if forget {
                    knownViews.removeAll()
                    lastPresentedViewId = nil
                }
            case .restoreLast:
                guard let viewId = lastPresentedViewId, let view = knownViews[viewId] else {
                    return .refused(reason: JarvisWorkspaceLocalization.string(.viewUnavailable, language: language))
                }
                present(viewId: viewId, view: view)
            case .dismiss(let viewId):
                guard knownViews[viewId] != nil else {
                    return .refused(reason: JarvisWorkspaceLocalization.string(.viewUnavailable, language: language))
                }
                dismiss(viewId: viewId)
            }
            return .applied
        }
    }

    private func present(viewId: String, view: GeneratedView) {
        lastPresentedViewId = viewId
        let visual = PresentedWorkspaceView(viewId: viewId, view: view)
        presentedView = visual
        voiceVisuals?.present(visual)
    }

    private func dismiss(viewId: String) {
        voiceVisuals?.dismiss(viewId)
        if presentedView?.viewId == viewId {
            presentedView = voiceVisuals?.entries.last
        }
    }

    private func registerCurrentSnapshot() async throws {
        guard let workspaceClient else { return }
        let windows = presentedView.map {
            [WorkspaceWindow(viewId: $0.viewId, title: workspaceTitle(for: $0.view))]
        } ?? []
        try await workspaceClient.register(WorkspaceSnapshot(
            windows: windows,
            contextPanelOpen: false,
            device: WorkspaceDevice(kind: .phone, label: "iPhone", appleMaps: true)
        ))
    }

    private func workspaceTitle(for view: GeneratedView) -> String {
        switch view {
        case .table(let envelope): envelope.title
        case .list(let envelope): envelope.title
        case .map(let envelope): envelope.title
        case .detail(let envelope): envelope.title
        case .text(let envelope): envelope.title
        case .timeline(let envelope): envelope.title
        case .chart(let envelope): envelope.title
        case .taskCard(let envelope): envelope.title
        case .status(let envelope): envelope.title
        case .image(let envelope): envelope.title
        case .htmlApp(let envelope): envelope.title
        case .knowledgeGraph(let envelope): envelope.title
        case .code(let envelope): envelope.title
        case .unsupportedVersion, .unknown:
            JarvisWorkspaceLocalization.string(.generatedView, language: language)
        }
    }

    private func updateConnectionStatus(for error: any Error) {
        if let workspaceError = error as? JarvisWorkspaceClientError,
           workspaceError == .staleConnection || workspaceError == .noActiveConnection {
            connectionStatus = .stale
            return
        }
        if let clientError = error as? JarvisClientError {
            switch clientError {
            case .signInRequired, .notOwner:
                connectionStatus = .unavailable
            case .networkFailure, .timedOut, .serviceUnavailable, .rateLimited:
                connectionStatus = .offline
            default:
                connectionStatus = .stale
            }
            return
        }
        connectionStatus = .stale
    }

    private static func destination(for page: String) -> JarvisDestination? {
        switch page {
        case "home": .chat
        case "factory": .softwareFactory
        case "settings": .settings
        case "usage": .usage
        case "notes": .notes
        case "workspaces", "folio": .workspaces
        case "status": .status
        case "health", "daily": .health
        default: nil
        }
    }

    /// Each route the generated-view contract allows opens its native screen. A task route opens that task; a
    /// project or release route opens the Factory page, which has no deep link to them.
    private static func routeNavigation(for route: String) -> WorkspaceNavigation? {
        switch GeneratedViewRoute(route: route) {
        case .home: .destination(.chat)
        case .usage: .destination(.usage)
        case .settings: .destination(.settings)
        case .factoryTask(let id): .factoryTask(id)
        case .factoryProject, .factoryRelease: .destination(.softwareFactory)
        case nil: nil
        }
    }

    private static func isSafeWebLink(_ value: String) -> Bool {
        guard let url = URL(string: value),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return false
        }
        return components.scheme?.lowercased() == "https"
            && components.host != nil
            && components.user == nil
            && components.password == nil
    }
}
