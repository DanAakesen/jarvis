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

struct PresentedWorkspaceView: Equatable, Identifiable {
    let viewId: String
    let view: GeneratedView

    var id: String { viewId }
}

@MainActor
final class WorkspaceRuntime: ObservableObject {
    let workspacesClient: JarvisWorkspacesClient?
    let webAppURL: URL?

    @Published private(set) var connectionStatus: WorkspaceConnectionStatus
    @Published private(set) var presentedView: PresentedWorkspaceView?
    @Published private(set) var requestedDestination: JarvisDestination?

    private let client: JarvisClient?
    private var workspaceClient: JarvisWorkspaceClient?
    private var knownViews: [String: GeneratedView] = [:]
    private var trustedBlobHost: String?
    private var sessionGeneration = 0

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
    }

    init(client: JarvisClient?, webAppURL: URL?) {
        self.client = client
        workspacesClient = client.map(JarvisWorkspacesClient.init(client:))
        workspaceClient = client.map { JarvisWorkspaceClient(client: $0) }
        self.webAppURL = webAppURL
        connectionStatus = client == nil ? .unavailable : .connecting
    }

    func run() async {
        guard let workspaceClient else { return }
        let generation = sessionGeneration
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
                    await handle(command, expiresAtMilliseconds: expiresAtMilliseconds, trustedBlobHost: host)
                case .connectionInterrupted:
                    connectionStatus = .reconnecting
                case .pendingConfirmationsChanged, .activityChanged, .workspaceCancel, .unknown:
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
        sessionGeneration += 1
        workspaceClient = client.map { JarvisWorkspaceClient(client: $0) }
        knownViews.removeAll()
        trustedBlobHost = nil
        presentedView = nil
        requestedDestination = nil
        connectionStatus = workspaceClient == nil ? .unavailable : .connecting
    }

    func consumeRequestedDestination() -> JarvisDestination? {
        defer { requestedDestination = nil }
        return requestedDestination
    }

    func userDismissedView() {
        guard presentedView != nil else { return }
        presentedView = nil
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

    func openRoute(_ route: String) -> Bool {
        guard let destination = Self.routeDestination(for: route) else { return false }
        requestedDestination = destination
        return true
    }

    func loadHTMLArtifact(id: String) async throws -> HtmlArtifact {
        guard let workspaceClient else {
            throw JarvisWorkspaceClientError.invalidResponse
        }
        return try await workspaceClient.htmlArtifact(id: id)
    }

    func canPerform(_ action: GeneratedViewAction) -> Bool {
        switch action {
        case .openRoute(let route):
            return Self.routeDestination(for: route) != nil
        case .openLink(let value, _):
            return Self.isSafeWebLink(value)
        case .callTool:
            return false
        case .window(let windowAction):
            guard knownViews[windowAction.windowId] != nil else { return false }
            switch windowAction.operation {
            case .focus, .restore, .close, .minimise: return true
            case .move, .resize: return false
            }
        }
    }

    func perform(_ action: GeneratedViewWindowAction) -> Bool {
        guard canPerform(.window(action)) else { return false }
        switch action.operation {
        case .focus, .restore:
            guard let view = knownViews[action.windowId] else { return false }
            presentedView = PresentedWorkspaceView(viewId: action.windowId, view: view)
        case .close:
            guard knownViews[action.windowId] != nil else { return false }
            knownViews.removeValue(forKey: action.windowId)
            if presentedView?.viewId == action.windowId { presentedView = nil }
        case .minimise:
            guard knownViews[action.windowId] != nil else { return false }
            if presentedView?.viewId == action.windowId { presentedView = nil }
        case .move, .resize:
            return false
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
            case .navigate(let page):
                guard let destination = Self.destination(for: page) else {
                    return .refused(reason: JarvisWorkspaceLocalization.string(.destinationUnavailable, language: language))
                }
                requestedDestination = destination
            case .present(let viewId, let view):
                knownViews[viewId] = view
                presentedView = PresentedWorkspaceView(viewId: viewId, view: view)
            case .focus(let viewId):
                guard let view = knownViews[viewId] else {
                    return .refused(reason: JarvisWorkspaceLocalization.string(.viewUnavailable, language: language))
                }
                presentedView = PresentedWorkspaceView(viewId: viewId, view: view)
            case .dismiss(let viewId):
                guard knownViews[viewId] != nil else {
                    return .refused(reason: JarvisWorkspaceLocalization.string(.viewUnavailable, language: language))
                }
                if presentedView?.viewId == viewId { presentedView = nil }
            }
            return .applied
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
            device: WorkspaceDevice(kind: .phone, label: "iPhone")
        ))
    }

    private func workspaceTitle(for view: GeneratedView) -> String {
        switch view {
        case .table(let envelope): envelope.title
        case .list(let envelope): envelope.title
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

    private static func routeDestination(for route: String) -> JarvisDestination? {
        switch route {
        case "/usage": .usage
        case "/settings": .settings
        default: nil
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
