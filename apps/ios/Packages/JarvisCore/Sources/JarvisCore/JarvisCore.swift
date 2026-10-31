public enum JarvisCore {}

public enum JarvisDestination: String, CaseIterable, Hashable, Identifiable, Sendable {
    case chat
    case voice
    case notes
    case health
    case workspaces
    case softwareFactory
    case banking
    case usage
    case status
    case proactive
    case settings

    public static let sidebarItems: [JarvisDestination] = [
        .proactive, .status, .usage, .banking, .softwareFactory, .health, .workspaces, .notes, .chat,
    ]

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .chat: "Chat"
        case .voice: "Voice"
        case .notes: "Notes"
        case .health: "Health"
        case .workspaces: "Workspaces"
        case .softwareFactory: "Software Factory"
        case .banking: "Banking"
        case .usage: "Usage"
        case .status: "Status"
        case .proactive: "Proactive"
        case .settings: "Settings"
        }
    }

    public func localizedTitle(language: JarvisAppLanguage) -> String {
        let key: JarvisNotesLocalizationKey
        switch self {
        case .chat: key = .chatTitle
        case .voice: key = .voiceTitle
        case .workspaces: key = .workspacesTitle
        case .notes: key = .notes
        case .health: key = .healthTitle
        case .softwareFactory: key = .softwareFactoryTitle
        case .banking: key = .bankingTitle
        case .usage: key = .usageTitle
        case .status: key = .statusTitle
        case .proactive: key = .proactiveTitle
        case .settings: key = .settingsTitle
        }
        return JarvisNotesLocalization.string(key, language: language)
    }

    public var symbolName: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .voice: "waveform"
        case .notes: "note.text"
        case .health: "dumbbell"
        case .workspaces: "square.stack.3d.up"
        case .softwareFactory: "hammer"
        case .banking: "creditcard"
        case .usage: "chart.bar"
        case .status: "waveform.path"
        case .proactive: "sparkles"
        case .settings: "gearshape"
        }
    }

    public var isNavigable: Bool { self != .banking }
}

public struct JarvisNavigationState: Equatable {
    public private(set) var path: [JarvisDestination] = []
    public private(set) var isSidebarOpen = false

    public init() {}

    public var currentDestination: JarvisDestination {
        path.last ?? .chat
    }

    public mutating func setPath(_ newPath: [JarvisDestination]) {
        var normalizedPath: [JarvisDestination] = []
        for destination in newPath
        where destination != .chat && destination.isNavigable && !normalizedPath.contains(destination) {
            normalizedPath.append(destination)
        }
        path = normalizedPath
    }

    public mutating func navigate(to destination: JarvisDestination) {
        guard destination.isNavigable else { return }

        if destination == .chat {
            path = []
        } else if let existingIndex = path.firstIndex(of: destination) {
            path = Array(path.prefix(through: existingIndex))
        } else {
            path.append(destination)
        }
        closeSidebar()
    }

    public mutating func goBack() {
        guard !path.isEmpty else { return }
        path.removeLast()
    }

    public mutating func voiceSessionStateChanged(_ state: VoiceSessionState) {
        guard state == .ended else { return }
        navigate(to: .chat)
    }

    public mutating func openSidebar() {
        isSidebarOpen = true
    }

    public mutating func closeSidebar() {
        isSidebarOpen = false
    }

    public mutating func setSidebarOpen(_ isOpen: Bool) {
        isSidebarOpen = isOpen
    }
}
