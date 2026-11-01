import JarvisCore
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @AppStorage("jarvis.appTheme") private var storedTheme = "system"
    @GestureState private var sidebarDrag = SidebarDrag()
    @StateObject private var workspaceRuntime: WorkspaceRuntime
    @State private var navigation = JarvisNavigationState()
    @StateObject private var voiceModel: VoiceScreenModel
    @State private var animationTargetProgress: CGFloat = 0
    @State private var presentedProgress: CGFloat = 0
    @State private var dragStartProgress: CGFloat?
    private let chatClient: JarvisClient?
    private let startupError: String?
    private let fixtureMode: Bool
    private let settingsClient: JarvisSettingsClient?
    private let voiceScreenshotLanguage: JarvisAppLanguage?
    @State private var notesClient: JarvisNotesClient?
    @State private var healthClient: JarvisHealthClient?
    @State private var factoryClient: JarvisFactoryClient?
    private let factoryScreenshot: JarvisFactoryScreenshotConfiguration?
    private let factoryFixtureMode: Bool
    private let healthScreenshotState: String?
    private let healthScreenshotLanguage: JarvisAppLanguage?
    private let activityScreenshotState: String?

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    private var presentedWorkspaceViewBinding: Binding<PresentedWorkspaceView?> {
        Binding<PresentedWorkspaceView?>(
            get: workspaceRuntimePresentedView,
            set: setPresentedWorkspaceView
        )
    }

    private var navigationPathBinding: Binding<[JarvisDestination]> {
        Binding<[JarvisDestination]>(
            get: currentNavigationPath,
            set: setNavigationPath
        )
    }

    private var initialActivitySheet: ActivitySheetKind? {
        let activityScreenshotIsActive: Bool = activityScreenshotState != nil
        let arguments: Set<String> = Set(ProcessInfo.processInfo.arguments)
        let notificationSheetRequested: Bool =
            fixtureMode && ProcessInfo.processInfo.arguments.contains("--screenshot-notifications-open")
        let notificationScreenRequested: Bool = fixtureMode && arguments.contains("--screenshot-screen=notifications")
        let notificationsAreRequested: Bool = notificationSheetRequested || notificationScreenRequested
        let shouldShowNotifications: Bool = notificationsAreRequested
        if activityScreenshotIsActive {
            return .background
        }
        if shouldShowNotifications {
            return .needsYou
        }
        return nil
    }

    init(client: JarvisClient? = nil, webAppURL: URL? = nil) {
        let arguments = ProcessInfo.processInfo.arguments
        let sidebarInitiallyOpen = arguments.contains("--screenshot-sidebar-open")
        let settingsPreview = arguments.contains("--screenshot-settings-fixture")
        let voiceConnectionScreenshot = arguments.contains("--screenshot-voice-connection-lost")
        let voiceScreenshotLanguage = arguments
            .first(where: { $0.hasPrefix("--screenshot-voice-language=") })
            .map { String($0.dropFirst("--screenshot-voice-language=".count)) }
            .flatMap(JarvisAppLanguage.init(rawValue:))
        let factoryScreenshot = JarvisFactoryScreenshotConfiguration.parse(arguments: arguments)
        let factoryFixtureMode = arguments.contains("--screenshot-factory-fixture")
        let healthFixtureMode = arguments.contains("--screenshot-health-fixture")
        let parsedHealthState: String? = arguments.first(where: {
            $0.hasPrefix("--screenshot-health-state=")
        })?.components(separatedBy: "=").last
        let healthState: String?
        if healthFixtureMode {
            healthState = parsedHealthState
        } else {
            healthState = nil
        }
        let parsedHealthLanguage: JarvisAppLanguage? = arguments.first(where: {
            $0.hasPrefix("--screenshot-health-language=")
        })?.components(separatedBy: "=").last.flatMap(JarvisAppLanguage.init(rawValue:))
        let healthLanguage: JarvisAppLanguage?
        if healthFixtureMode {
            healthLanguage = parsedHealthLanguage
        } else {
            healthLanguage = nil
        }
        let activityScreenshotState = arguments
            .first(where: { $0.hasPrefix("--screenshot-activity-state=") })
            .map { String($0.dropFirst("--screenshot-activity-state=".count)) }
            .flatMap(Self.validActivityScreenshotState)
        self.activityScreenshotState = activityScreenshotState
        let fixtureMode = settingsPreview
            || voiceConnectionScreenshot
            || arguments.contains("--screenshot-chat-fixture")
            || activityScreenshotState != nil
            || factoryFixtureMode
            || healthFixtureMode
        var initialNavigation = JarvisNavigationState()
        if sidebarInitiallyOpen {
            initialNavigation.openSidebar()
        }
        if settingsPreview {
            initialNavigation.navigate(to: .settings)
        }
        if voiceConnectionScreenshot {
            initialNavigation.navigate(to: .voice)
        } else if fixtureMode,
                  let screen = arguments.first(where: { $0.hasPrefix("--screenshot-screen=") })?
            .split(separator: "=", maxSplits: 1).last,
                  let destination = ["voice": JarvisDestination.voice, "notes": .notes, "health": .health,
                                     "settings": .settings][String(screen)] {
            initialNavigation.navigate(to: destination)
        }
        if factoryScreenshot != nil {
            initialNavigation.navigate(to: .softwareFactory)
        }
        if healthFixtureMode { initialNavigation.navigate(to: .health) }
        healthScreenshotState = healthState
        healthScreenshotLanguage = healthLanguage
#if targetEnvironment(simulator)
        if arguments.contains("--screenshot-voice-fixture") {
            initialNavigation.navigate(to: .voice)
        }
#endif
        self.fixtureMode = fixtureMode
        self.voiceScreenshotLanguage = voiceScreenshotLanguage
        self.factoryScreenshot = factoryScreenshot
        self.factoryFixtureMode = factoryFixtureMode
        _voiceModel = StateObject(
            wrappedValue: VoiceScreenModel(screenshotConnectionLost: voiceConnectionScreenshot)
        )
        let resolvedClient: JarvisClient?
        let resolvedStartupError: String?
        if fixtureMode {
            resolvedClient = try? JarvisFixtureScenario.makeClient(emptyActivity: activityScreenshotState == "empty")
            if resolvedClient == nil {
                resolvedStartupError = "Fixture preview is unavailable."
            } else {
                resolvedStartupError = nil
            }
            settingsClient = try? JarvisFixtureScenario.makeSettingsClient()
        } else if let client {
            resolvedClient = client
            resolvedStartupError = nil
            settingsClient = JarvisSettingsClient(client: client)
        } else {
            do {
                let resolved = try JarvisComposition.makeClient(
                    accessTokenProvider: JarvisUnavailableAccessTokenProvider()
                )
                resolvedClient = resolved
                resolvedStartupError = nil
                settingsClient = JarvisSettingsClient(client: resolved)
            } catch {
                resolvedClient = nil
                resolvedStartupError = "Chat isn't configured."
                settingsClient = nil
            }
        }
        chatClient = resolvedClient
        startupError = resolvedStartupError
        _workspaceRuntime = StateObject(
            wrappedValue: WorkspaceRuntime(
                client: resolvedClient,
                webAppURL: webAppURL ?? JarvisComposition.makeWebAppURL()
            )
        )
        _navigation = State(initialValue: initialNavigation)
        let initialSidebarProgress: CGFloat
        if sidebarInitiallyOpen {
            initialSidebarProgress = CGFloat(1)
        } else {
            initialSidebarProgress = CGFloat(0)
        }
        _animationTargetProgress = State(initialValue: initialSidebarProgress)
        _presentedProgress = State(initialValue: initialSidebarProgress)
        _notesClient = State(initialValue: Self.makeNotesClient(fixtureMode: fixtureMode))
        let resolvedHealthClient: JarvisHealthClient?
        if healthFixtureMode {
            let fixtureLanguage: JarvisAppLanguage = healthLanguage ?? .da
            let emptyFixture: Bool = healthState == "empty"
            resolvedHealthClient = try? JarvisHealthLiftFixture.makeClient(
                language: fixtureLanguage,
                empty: emptyFixture
            )
        } else {
            resolvedHealthClient = Self.makeHealthClient(fixtureMode: fixtureMode)
        }
        _healthClient = State(initialValue: resolvedHealthClient)
        _factoryClient = State(initialValue: Self.makeFactoryClient(
            previewState: factoryScreenshot?.state,
            fixtureMode: factoryFixtureMode
        ))
    }

    var body: some View {
        GeometryReader { (geometry: GeometryProxy) in
            rootLayout(in: geometry)
        }
        .ignoresSafeArea()
        .preferredColorScheme(themeColorScheme)
    }

    private func rootLayout(in geometry: GeometryProxy) -> some View {
        let screenSize: CGSize = geometry.size
        let safeAreaInsets: EdgeInsets = Self.resolvedSafeAreaInsets(fallback: geometry.safeAreaInsets)
        let screenWidth: CGFloat = screenSize.width
        let screenHeight: CGFloat = screenSize.height
        let drawerWidthFraction: CGFloat = JarvisDesignTokens.sidebarWidthFraction
        let maximumDrawerWidth: CGFloat = JarvisDesignTokens.sidebarMaximumWidth
        let requestedDrawerWidth: CGFloat = screenWidth * drawerWidthFraction
        let drawerWidth: CGFloat = min(requestedDrawerWidth, maximumDrawerWidth)
        let progress: CGFloat = sidebarProgress(drawerWidth: drawerWidth)
        let dimmingOpacity: CGFloat = progress * JarvisDesignTokens.screenDimOpacity
        let blurRadius: CGFloat = progress * JarvisDesignTokens.screenBlurRadius
        let horizontalOffset: CGFloat = -drawerWidth * progress
        let zeroProgress: CGFloat = 0
        let hasVisibleSidebarProgress: Bool = progress > zeroProgress
        let dragGesture = sidebarDragGesture(screenWidth: screenWidth, drawerWidth: drawerWidth)
        let navigationSurface = navigationSurface(drawerWidth: drawerWidth)
        let foreground = ContentForegroundLayer(
            content: navigationSurface,
            screenSize: screenSize,
            dimmingOpacity: dimmingOpacity,
            blurRadius: blurRadius,
            horizontalOffset: horizontalOffset,
            isSidebarOpen: navigation.isSidebarOpen,
            hasVisibleSidebarProgress: hasVisibleSidebarProgress,
            openSidebarLabel: JarvisNotesLocalization.string(.openSidebar, language: language),
            onOpenSidebar: openSidebar,
            onCloseSidebar: closeSidebar,
            sidebarDragGesture: dragGesture
        )
        return ContentSidebarLayout(
            screenSize: screenSize,
            language: language,
            sidebar: sidebarSurface(
                drawerWidth: drawerWidth,
                screenHeight: screenHeight,
                safeAreaInsets: safeAreaInsets
            ),
            foreground: foreground,
            edgeGesture: sidebarEdgeGesture(
                isSidebarOpen: navigation.isSidebarOpen,
                gesture: dragGesture
            ),
            progressObserver: sidebarProgressObserver,
            miniBar: voiceMiniBar(safeAreaInsets: safeAreaInsets, drawerWidth: drawerWidth),
            onAppear: normalizeStoredLanguage
        )
    }

    private func sidebarProgress(drawerWidth: CGFloat) -> CGFloat {
        let zeroProgress: CGFloat = 0
        let fullProgress: CGFloat = 1
        let minimumDrawerWidth: CGFloat = 1
        let safeDrawerWidth: CGFloat = max(drawerWidth, minimumDrawerWidth)
        let dragStartProgress: CGFloat = sidebarDrag.startProgress
        let dragTranslation: CGFloat = sidebarDrag.translation
        let progressDelta: CGFloat = dragTranslation / safeDrawerWidth
        let rawProgress: CGFloat = dragStartProgress - progressDelta
        let boundedProgress: CGFloat = min(max(rawProgress, zeroProgress), fullProgress)
        let isDragging: Bool = sidebarDrag.isActive
        let currentProgress: CGFloat
        if isDragging {
            currentProgress = boundedProgress
        } else {
            currentProgress = presentedProgress
        }
        return currentProgress
    }

    private func sidebarSurface(
        drawerWidth: CGFloat,
        screenHeight: CGFloat,
        safeAreaInsets: EdgeInsets
    ) -> some View {
        JarvisSidebar(
            currentDestination: navigation.currentDestination,
            isOpen: navigation.isSidebarOpen,
            safeAreaInsets: safeAreaInsets,
            onNavigate: { (destination: JarvisDestination) in
                navigate(to: destination, drawerWidth: drawerWidth)
            },
            onClose: closeSidebar
        )
        .frame(width: drawerWidth, height: screenHeight)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func navigationSurface(drawerWidth: CGFloat) -> some View {
        ContentNavigationSurface(
            path: navigationPathBinding,
            storedLanguage: $storedLanguage,
            storedTheme: $storedTheme,
            workspaceRuntime: workspaceRuntime,
            voiceModel: voiceModel,
            presentedView: presentedWorkspaceViewBinding,
            chatClient: chatClient,
            startupError: startupError,
            fixtureMode: fixtureMode,
            initialActivitySheet: initialActivitySheet,
            language: language,
            voiceScreenshotLanguage: voiceScreenshotLanguage,
            healthScreenshotLanguage: healthScreenshotLanguage,
            healthScreenshotState: healthScreenshotState,
            factoryScreenshot: factoryScreenshot,
            factoryFixtureMode: factoryFixtureMode,
            notesClient: notesClient,
            healthClient: healthClient,
            factoryClient: factoryClient,
            settingsClient: settingsClient,
            onRetryNotesConfiguration: { notesClient = Self.makeNotesClient(fixtureMode: fixtureMode) },
            onRetryHealthConfiguration: { healthClient = Self.makeHealthClient(fixtureMode: fixtureMode) },
            onRetryFactoryConfiguration: {
                factoryClient = Self.makeFactoryClient(
                    previewState: factoryScreenshot?.state,
                    fixtureMode: factoryFixtureMode
                )
            },
            onNavigate: { (destination: JarvisDestination) in
                navigate(to: destination, drawerWidth: drawerWidth)
            },
            onVoiceStateChange: handleVoiceStateChange,
            onRequestedDestinationChange: { (destination: JarvisDestination?) in
                handleRequestedDestinationChange(destination, drawerWidth: drawerWidth)
            },
            onSignedOut: {
                NotificationCenter.default.post(name: .jarvisSessionRevoked, object: nil)
            }
        )
    }

    private func sidebarEdgeGesture(isSidebarOpen: Bool, gesture: some Gesture) -> some View {
        Group {
            if !isSidebarOpen {
                SidebarEdgeGestureLayer(gesture: gesture)
            }
        }
    }

    private var sidebarProgressObserver: some View {
        let observerDimension: CGFloat = 1
        return Color.clear
            .frame(width: observerDimension, height: observerDimension)
            .modifier(SidebarProgressObserver(progress: animationTargetProgress) { value in
                reportPresentedProgress(value)
            })
            .animation(sidebarAnimation, value: animationTargetProgress)
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }

    private func voiceMiniBar(safeAreaInsets: EdgeInsets, drawerWidth: CGFloat) -> some View {
        Group {
            if voiceModel.isMinimized {
                let bottomInset: CGFloat = safeAreaInsets.bottom
                let controlInset: CGFloat = JarvisDesignTokens.voiceControlBottomInset
                let miniBarBottomPadding: CGFloat = bottomInset + controlInset
                VoiceMiniBar(model: voiceModel) {
                    voiceModel.restore()
                    navigate(to: .voice, drawerWidth: drawerWidth)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, miniBarBottomPadding)
            }
        }
    }

    private func currentNavigationPath() -> [JarvisDestination] {
        let path: [JarvisDestination] = navigation.path
        return path
    }

    private func setNavigationPath(_ path: [JarvisDestination]) {
        navigation.setPath(path)
    }

    private func openSidebar() {
        setSidebarOpen(true)
    }

    private static func validActivityScreenshotState(_ state: String) -> String? {
        let isSupportedState: Bool = state == "empty" || state == "active"
        guard isSupportedState else { return nil }
        return state
    }

    private func normalizeStoredLanguage() {
        let storedAppLanguage: JarvisAppLanguage? = JarvisAppLanguage(rawValue: storedLanguage)
        guard storedAppLanguage == nil else { return }
        storedLanguage = JarvisAppLanguage.default.rawValue
    }

    private var themeColorScheme: ColorScheme? {
        switch storedTheme {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }

    private static func resolvedSafeAreaInsets(fallback: EdgeInsets) -> EdgeInsets {
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) else {
            return fallback
        }
        let insets = window.safeAreaInsets
        let resolvedTop: CGFloat = max(fallback.top, insets.top)
        let resolvedLeading: CGFloat = max(fallback.leading, insets.left)
        let resolvedBottom: CGFloat = max(fallback.bottom, insets.bottom)
        let resolvedTrailing: CGFloat = max(fallback.trailing, insets.right)
        return EdgeInsets(
            top: resolvedTop,
            leading: resolvedLeading,
            bottom: resolvedBottom,
            trailing: resolvedTrailing
        )
    }

    private func sidebarDragGesture(
        screenWidth: CGFloat,
        drawerWidth: CGFloat
    ) -> some Gesture {
        DragGesture(
            minimumDistance: JarvisDesignTokens.sidebarGestureMinimumDistance,
            coordinateSpace: .named("sidebar")
        )
            .updating($sidebarDrag) { value, state, transaction in
                let isDragActive: Bool = state.isActive
                let startProgress: CGFloat
                if isDragActive {
                    startProgress = state.startProgress
                } else {
                    startProgress = presentedProgress
                }
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth,
                    startProgress: startProgress
                ) else { return }
                state = SidebarDrag(
                    startProgress: startProgress,
                    translation: value.translation.width,
                    isActive: true
                )
                transaction.disablesAnimations = true
            }
            .onChanged { value in
                guard dragStartProgress == nil else { return }
                let startProgress = presentedProgress
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth,
                    startProgress: startProgress
                ) else { return }
                dragStartProgress = startProgress
            }
            .onEnded { value in
                guard let startProgress = dragStartProgress else { return }
                dragStartProgress = nil
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth,
                    startProgress: startProgress
                ) else { return }
                let minimumDrawerWidth: CGFloat = 1
                let safeDrawerWidth: CGFloat = max(drawerWidth, minimumDrawerWidth)
                let projectedTranslation: CGFloat = value.predictedEndTranslation.width
                let currentTranslation: CGFloat = value.translation.width
                let projectedProgressDelta: CGFloat = projectedTranslation / safeDrawerWidth
                let currentProgressDelta: CGFloat = currentTranslation / safeDrawerWidth
                let projectedProgress: CGFloat = startProgress - projectedProgressDelta
                let currentProgress: CGFloat = startProgress - currentProgressDelta
                let zeroProgress: CGFloat = 0
                let fullProgress: CGFloat = 1
                let boundedCurrentProgress: CGFloat = min(max(currentProgress, zeroProgress), fullProgress)
                setSidebarOpen(
                    projectedProgress > JarvisDesignTokens.sidebarOpenThreshold,
                    fromProgress: boundedCurrentProgress
                )
            }
    }

    private func canBeginSidebarDrag(
        _ value: DragGesture.Value,
        screenWidth: CGFloat,
        drawerWidth: CGFloat,
        startProgress: CGFloat
    ) -> Bool {
        JarvisSidebarGesturePolicy.canBegin(
            startX: Double(value.startLocation.x),
            translationX: Double(value.translation.width),
            translationY: Double(value.translation.height),
            screenWidth: Double(screenWidth),
            drawerWidth: Double(drawerWidth),
            startProgress: Double(startProgress),
            openingStartFraction: Double(JarvisDesignTokens.sidebarGestureStartFraction)
        )
    }

    private var sidebarAnimation: Animation? {
        if reduceMotion { return nil }
        return .interactiveSpring(
            response: JarvisDesignTokens.sidebarSpringResponse,
            dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        )
    }

    private func setSidebarOpen(_ open: Bool, fromProgress: CGFloat? = nil) {
        let requestedProgress: CGFloat = fromProgress ?? presentedProgress
        let zeroProgress: CGFloat = 0
        let fullProgress: CGFloat = 1
        let currentProgress: CGFloat = min(max(requestedProgress, zeroProgress), fullProgress)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            animationTargetProgress = currentProgress
            presentedProgress = currentProgress
        }
        navigation.setSidebarOpen(open)
        let openProgress: CGFloat = 1
        let closedProgress: CGFloat = 0
        let targetProgress: CGFloat
        if open {
            targetProgress = openProgress
        } else {
            targetProgress = closedProgress
        }
        animateSidebar(to: targetProgress)
    }

    private func workspaceRuntimePresentedView() -> PresentedWorkspaceView? {
        let presentedView: PresentedWorkspaceView? = workspaceRuntime.presentedView
        return presentedView
    }

    private func setPresentedWorkspaceView(_ presentedView: PresentedWorkspaceView?) {
        let isDismissal: Bool = presentedView == nil
        guard isDismissal else { return }
        workspaceRuntime.userDismissedView()
    }

    private func handleRequestedDestinationChange(
        _ requestedDestination: JarvisDestination?,
        drawerWidth: CGFloat
    ) {
        guard requestedDestination != nil else { return }
        guard let destination = workspaceRuntime.consumeRequestedDestination() else { return }
        navigate(to: destination, drawerWidth: drawerWidth)
    }

    private func handleVoiceStateChange(_ state: VoiceSessionState) {
        let endedState: VoiceSessionState = .ended
        let shouldCloseSidebar: Bool = state == endedState
        navigation.voiceSessionStateChanged(state)
        if shouldCloseSidebar {
            setSidebarOpen(false)
        }
    }

    private func navigate(to destination: JarvisDestination, drawerWidth: CGFloat) {
        if destination == .voice {
            voiceModel.restore()
        } else if navigation.currentDestination == .voice && voiceModel.isSessionActive {
            voiceModel.minimize()
        }
        let isDragActive: Bool = sidebarDrag.isActive
        let minimumDrawerWidth: CGFloat = 1
        let safeDrawerWidth: CGFloat = max(drawerWidth, minimumDrawerWidth)
        let dragProgressStart: CGFloat = sidebarDrag.startProgress
        let dragTranslation: CGFloat = sidebarDrag.translation
        let progressDelta: CGFloat = dragTranslation / safeDrawerWidth
        let dragProgress: CGFloat = dragProgressStart - progressDelta
        let currentProgress: CGFloat
        if isDragActive {
            currentProgress = dragProgress
        } else {
            currentProgress = presentedProgress
        }
        let zeroProgress: CGFloat = 0
        let fullProgress: CGFloat = 1
        let boundedProgress: CGFloat = min(max(currentProgress, zeroProgress), fullProgress)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            animationTargetProgress = boundedProgress
            presentedProgress = boundedProgress
        }
        navigation.navigate(to: destination)
        let isSidebarOpen: Bool = navigation.isSidebarOpen
        let openProgress: CGFloat = 1
        let closedProgress: CGFloat = 0
        let targetProgress: CGFloat
        if isSidebarOpen {
            targetProgress = openProgress
        } else {
            targetProgress = closedProgress
        }
        animateSidebar(to: targetProgress)
    }

    private func animateSidebar(to progress: CGFloat) {
        if reduceMotion {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                animationTargetProgress = progress
                presentedProgress = progress
            }
        } else {
            DispatchQueue.main.async {
                withAnimation(sidebarAnimation) {
                    animationTargetProgress = progress
                }
            }
        }
    }

    private func reportPresentedProgress(_ progress: CGFloat) {
        let progressDifference: CGFloat = abs(presentedProgress - progress)
        let progressTolerance: CGFloat = 0.001
        guard progressDifference > progressTolerance else { return }
        DispatchQueue.main.async {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                presentedProgress = progress
            }
        }
    }

    private func closeSidebar() {
        setSidebarOpen(false)
    }

    private static func makeNotesClient(fixtureMode: Bool) -> JarvisNotesClient? {
        if fixtureMode { return JarvisNotesPreview.makeClient() }
        do {
            let client = try JarvisComposition.makeClient(
                accessTokenProvider: JarvisUnavailableAccessTokenProvider()
            )
            return JarvisNotesClient(client: client)
        } catch {
            return nil
        }
    }

    private static func makeHealthClient(fixtureMode: Bool) -> JarvisHealthClient? {
        if fixtureMode { return JarvisHealthPreview.makeClient() }
        do {
            let client = try JarvisComposition.makeClient(
                accessTokenProvider: JarvisUnavailableAccessTokenProvider()
            )
            return JarvisHealthClient(client: client)
        } catch {
            return nil
        }
    }

    private static func makeFactoryClient(
        previewState: JarvisFactoryPreviewState?,
        fixtureMode: Bool
    ) -> JarvisFactoryClient? {
        if fixtureMode, let previewState {
            return try? JarvisFactoryFixtureScenario.makeClient(state: previewState)
        }
        do {
            let client = try JarvisComposition.makeClient(
                accessTokenProvider: JarvisUnavailableAccessTokenProvider()
            )
            return JarvisFactoryClient(client: client)
        } catch {
            return nil
        }
    }
}

private struct ContentNavigationSurface: View {
    @Binding var path: [JarvisDestination]
    @Binding var storedLanguage: String
    @Binding var storedTheme: String
    @ObservedObject var workspaceRuntime: WorkspaceRuntime
    @ObservedObject var voiceModel: VoiceScreenModel
    let presentedView: Binding<PresentedWorkspaceView?>
    let chatClient: JarvisClient?
    let startupError: String?
    let fixtureMode: Bool
    let initialActivitySheet: ActivitySheetKind?
    let language: JarvisAppLanguage
    let voiceScreenshotLanguage: JarvisAppLanguage?
    let healthScreenshotLanguage: JarvisAppLanguage?
    let healthScreenshotState: String?
    let factoryScreenshot: JarvisFactoryScreenshotConfiguration?
    let factoryFixtureMode: Bool
    let notesClient: JarvisNotesClient?
    let healthClient: JarvisHealthClient?
    let factoryClient: JarvisFactoryClient?
    let settingsClient: JarvisSettingsClient?
    let onRetryNotesConfiguration: () -> Void
    let onRetryHealthConfiguration: () -> Void
    let onRetryFactoryConfiguration: () -> Void
    let onNavigate: (JarvisDestination) -> Void
    let onVoiceStateChange: (VoiceSessionState) -> Void
    let onRequestedDestinationChange: (JarvisDestination?) -> Void
    let onSignedOut: () -> Void

    var body: some View {
        NavigationStack(path: $path) {
            chatRoot.navigationDestination(for: JarvisDestination.self) { (destination: JarvisDestination) in
                destinationView(for: destination)
            }
        }
        .tint(JarvisDesignTokens.primaryAccent)
        .task { await workspaceRuntime.run() }
        .onChange(of: voiceModel.voiceState) { _, state in
            let voiceState: VoiceSessionState = state
            onVoiceStateChange(voiceState)
        }
        .onChange(of: workspaceRuntime.requestedDestination) { _, destination in
            let requestedDestination: JarvisDestination? = destination
            onRequestedDestinationChange(requestedDestination)
        }
        .sheet(item: presentedView) { (presented: PresentedWorkspaceView) in
            workspaceSheet(presented)
        }
    }

    private var chatRoot: some View {
        JarvisChatScreen(
            client: chatClient,
            fixtureMode: fixtureMode,
            initialActivitySheet: initialActivitySheet,
            startupError: startupError,
            onNavigate: onNavigate
        )
    }

    @ViewBuilder
    private func destinationView(for destination: JarvisDestination) -> some View {
        switch destination {
        case .workspaces:
            WorkspacesView(runtime: workspaceRuntime)
        case .voice:
            voiceDestination
        case .chat:
            chatDestination
        case .notes:
            notesDestination
        case .health:
            healthDestination
        case .softwareFactory:
            factoryDestination
        case .settings:
            settingsDestination
        case .banking, .usage, .status, .proactive:
            JarvisPlaceholderView(destination: destination, language: language)
        }
    }

    private var voiceDestination: some View {
        VoiceScreenView(
            model: voiceModel,
            language: voiceScreenshotLanguage ?? language,
            fixtureMode: fixtureMode,
            onMinimize: { onNavigate(.chat) },
            onEnd: { onNavigate(.chat) }
        )
    }

    private var chatDestination: some View {
        JarvisChatScreen(
            client: chatClient,
            fixtureMode: fixtureMode,
            startupError: startupError,
            onNavigate: onNavigate
        )
    }

    private var notesDestination: some View {
        JarvisNotesArea(
            client: notesClient,
            language: language,
            onRetryConfiguration: onRetryNotesConfiguration
        )
    }

    private var healthDestination: some View {
        let resolvedLanguage: JarvisAppLanguage = healthScreenshotLanguage ?? language
        let shouldObserveRefreshEvents: Bool = !fixtureMode
        let currentDate: Date = fixtureMode ? JarvisHealthPreview.now : Date()
        let workoutInitiallySelected: Bool = healthScreenshotState != nil
        let shouldPresentNewLift: Bool = healthScreenshotState == "newlift"
        return JarvisHealthArea(
            client: healthClient,
            language: resolvedLanguage,
            observeRefreshEvents: shouldObserveRefreshEvents,
            onRetryConfiguration: onRetryHealthConfiguration,
            now: currentDate,
            workoutInitiallySelected: workoutInitiallySelected,
            presentNewLiftAfterLoading: shouldPresentNewLift
        )
    }

    private var factoryDestination: some View {
        let resolvedLanguage: JarvisAppLanguage = factoryScreenshot?.language ?? language
        let previewState: JarvisFactoryPreviewState? = factoryScreenshot?.state
        let shouldEnableLiveUpdates: Bool = !factoryFixtureMode
        return JarvisFactoryArea(
            client: factoryClient,
            language: resolvedLanguage,
            onRetryConfiguration: onRetryFactoryConfiguration,
            previewState: previewState,
            liveUpdatesEnabled: shouldEnableLiveUpdates
        )
    }

    private var settingsDestination: some View {
        JarvisSettingsArea(
            storedLanguage: $storedLanguage,
            storedTheme: $storedTheme,
            client: settingsClient,
            onSignedOut: onSignedOut
        )
    }

    private func workspaceSheet(_ presented: PresentedWorkspaceView) -> some View {
        GeneratedWorkspaceSheet(presented: presented, runtime: workspaceRuntime)
    }
}

private struct ContentSidebarLayout<Sidebar: View, Foreground: View, EdgeGesture: View, ProgressObserver: View, MiniBar: View>: View {
    let screenSize: CGSize
    let language: JarvisAppLanguage
    let sidebar: Sidebar
    let foreground: Foreground
    let edgeGesture: EdgeGesture
    let progressObserver: ProgressObserver
    let miniBar: MiniBar
    let onAppear: () -> Void

    var body: some View {
        ZStack(alignment: .trailing) {
            sidebar
            foreground
            edgeGesture
            progressObserver
            miniBar
        }
        .frame(width: screenSize.width, height: screenSize.height)
        .background { JarvisScreenBackground() }
        .coordinateSpace(name: "sidebar")
        .clipped()
        .environment(\.locale, language.locale)
        .onAppear(perform: onAppear)
    }
}

private struct ContentForegroundLayer<Content: View, DragGesture: Gesture>: View {
    let content: Content
    let screenSize: CGSize
    let dimmingOpacity: CGFloat
    let blurRadius: CGFloat
    let horizontalOffset: CGFloat
    let isSidebarOpen: Bool
    let hasVisibleSidebarProgress: Bool
    let openSidebarLabel: String
    let onOpenSidebar: () -> Void
    let onCloseSidebar: () -> Void
    let sidebarDragGesture: DragGesture

    var body: some View {
        content
            .frame(width: screenSize.width, height: screenSize.height)
            .background { JarvisScreenBackground() }
            .overlay { SidebarDimmingLayer(opacity: dimmingOpacity) }
            .blur(radius: blurRadius)
            .overlay {
                if hasVisibleSidebarProgress {
                    SidebarDismissGestureLayer(
                        onClose: onCloseSidebar,
                        gesture: sidebarDragGesture
                    )
                }
            }
            .offset(x: horizontalOffset)
            .accessibilityAction(named: Text(openSidebarLabel)) {
                onOpenSidebar()
            }
            .accessibilityHidden(isSidebarOpen)
    }
}

private struct SidebarDimmingLayer: View {
    let opacity: CGFloat

    var body: some View {
        let dimmingColor: Color = .black
        return dimmingColor
            .opacity(opacity)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private struct SidebarDismissGestureLayer<DragGesture: Gesture>: View {
    let onClose: () -> Void
    let gesture: DragGesture

    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture(perform: onClose)
            .simultaneousGesture(gesture)
            .accessibilityHidden(true)
    }
}

private struct SidebarEdgeGestureLayer<DragGesture: Gesture>: View {
    let gesture: DragGesture

    var body: some View {
        let edgeWidth: CGFloat = JarvisDesignTokens.sidebarEdgeGestureWidth
        return Color.clear
            .frame(width: edgeWidth)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(gesture)
            .accessibilityHidden(true)
    }
}

private struct SidebarDrag: Equatable {
    var startProgress: CGFloat = 0
    var translation: CGFloat = 0
    var isActive = false
}

private struct SidebarProgressObserver: AnimatableModifier {
    var progress: CGFloat
    let onChange: (CGFloat) -> Void

    var animatableData: CGFloat {
        get { progress }
        set {
            progress = newValue
            onChange(newValue)
        }
    }

    func body(content: Content) -> some View {
        content.onAppear { onChange(progress) }
    }
}

private struct JarvisPlaceholderView: View {
    let destination: JarvisDestination
    let language: JarvisAppLanguage

    var body: some View {
        Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .jarvisAmbientBackground()
            .navigationTitle(destination.localizedTitle(language: language))
            .navigationBarTitleDisplayMode(.inline)
    }
}
