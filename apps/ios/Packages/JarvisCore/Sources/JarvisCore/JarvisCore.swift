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
        .proactive, .status, .usage, .banking, .softwareFactory, .health, .notes, .chat,
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

public struct JarvisNavigationPathUpdate {
    public let state: JarvisNavigationState
    public let navigationRequest: (from: JarvisDestination, to: JarvisDestination)?

    public init(path: [JarvisDestination], from previous: JarvisNavigationState) {
        var next = previous
        next.setPath(path)
        if next.path != previous.path { next.closeSidebar() }
        state = next
        navigationRequest = next.currentDestination != previous.currentDestination
            ? (from: previous.currentDestination, to: next.currentDestination)
            : nil
    }
}

public enum JarvisSidebarGesturePolicy {
    /// A finished edge swipe opens the drawer when it is mostly horizontal, travels toward the
    /// drawer, and either covers enough of the drawer width or is a quick flick.
    public static func shouldOpen(
        translationX: Double,
        translationY: Double,
        velocityX: Double,
        drawerWidth: Double,
        openThreshold: Double,
        flickVelocity: Double = 600,
        flickMinimumDistance: Double = 24
    ) -> Bool {
        guard translationX.isFinite, translationY.isFinite, velocityX.isFinite,
              drawerWidth.isFinite, openThreshold.isFinite, drawerWidth > 0,
              translationX < 0, abs(translationX) > abs(translationY) else {
            return false
        }
        let distance = -translationX
        return distance / drawerWidth > openThreshold
            || (-velocityX > flickVelocity && distance >= flickMinimumDistance)
    }

    /// A finished swipe on the open drawer or scrim closes it under the mirrored rules.
    public static func shouldClose(
        translationX: Double,
        translationY: Double,
        velocityX: Double,
        drawerWidth: Double,
        closeThreshold: Double,
        flickVelocity: Double = 600,
        flickMinimumDistance: Double = 24
    ) -> Bool {
        shouldOpen(
            translationX: -translationX,
            translationY: translationY,
            velocityX: -velocityX,
            drawerWidth: drawerWidth,
            openThreshold: closeThreshold,
            flickVelocity: flickVelocity,
            flickMinimumDistance: flickMinimumDistance
        )
    }

    public static func canBegin(
        startX: Double,
        translationX: Double,
        translationY: Double,
        screenWidth: Double,
        drawerWidth: Double,
        startProgress: Double,
        openingStartFraction: Double
    ) -> Bool {
        guard screenWidth.isFinite,
              drawerWidth.isFinite,
              startX.isFinite,
              translationX.isFinite,
              translationY.isFinite,
              startProgress.isFinite,
              openingStartFraction.isFinite,
              screenWidth > 0,
              drawerWidth > 0,
              (0...1).contains(startProgress),
              (0...1).contains(openingStartFraction),
              abs(translationX) > abs(translationY) else {
            return false
        }

        if startProgress > 0 {
            return startX < screenWidth - drawerWidth * startProgress
        }
        return startX >= screenWidth * openingStartFraction && translationX < 0
    }
}
