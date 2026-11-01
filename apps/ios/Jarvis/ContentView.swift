import JarvisCore
import SwiftUI
import UIKit

@MainActor
private final class NavigationBisectWrites: ObservableObject {
    @Published private(set) var entries: [String] = []
    private var sequence = 0

    func record(_ tag: String, before: Bool, after: Bool, stage: String = "postwrite") {
        guard let variant = NavigationBisectVariant.current,
              [.G, .H, .I, .J, .K].contains(variant) else { return }
        sequence += 1
        entries.append("\(sequence):\(stage):caller=\(tag):before=\(before):after=\(after)")
        if entries.count > 32 { entries.removeFirst(entries.count - 32) }
    }
}

private struct NavigationBisectWritesProbe: View {
    @ObservedObject var writes: NavigationBisectWrites

    var body: some View {
        NavigationBisectProbe(identifier: "navigation.bisectWrites") { _ in
            writes.entries.joined(separator: "|")
        }
    }
}

struct NavigationBisectMenuValue: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled

    @ViewBuilder func body(content: Content) -> some View {
        if NavigationBisectVariant.current != nil {
            content.accessibilityValue("isEnabled=\(isEnabled);menuDisabled=\(!isEnabled)")
        } else {
            content
        }
    }
}

extension View {
    @ViewBuilder func navigationBisectGateHitTesting(_ enabled: Bool) -> some View {
        if NavigationBisectVariant.current == .I {
            self
        } else {
            allowsHitTesting(enabled)
        }
    }
}

struct NavigationBisectProbe: View {
    @Environment(\.isEnabled) private var isEnabled
    let identifier: String
    let value: (Bool) -> String

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(identifier)
            .accessibilityIdentifier(identifier)
            .accessibilityValue(value(isEnabled))
            .allowsHitTesting(false)
    }
}

private struct NavigationBisectWindowGeometry: Equatable {
    let size: CGSize
    let safeAreaInsets: EdgeInsets

    @MainActor init(window: UIWindow) {
        size = window.bounds.size
        let insets = window.safeAreaInsets
        safeAreaInsets = EdgeInsets(
            top: insets.top, leading: insets.left,
            bottom: insets.bottom, trailing: insets.right
        )
    }
}

private struct NavigationBisectWindowShell<Content: View>: View {
    @State private var geometry: NavigationBisectWindowGeometry?
    let content: (CGSize, EdgeInsets) -> Content

    var body: some View {
        let current = geometry ?? UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
            .map { NavigationBisectWindowGeometry(window: $0) }
        content(current?.size ?? .zero, current?.safeAreaInsets ?? EdgeInsets())
            .background {
                NavigationBisectWindowBoundsReader { updated in
                    if geometry != updated { geometry = updated }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
    }
}

private struct NavigationBisectWindowBoundsReader: UIViewRepresentable {
    let onChange: (NavigationBisectWindowGeometry) -> Void

    func makeUIView(context: Context) -> BoundsView {
        let view = BoundsView()
        view.isUserInteractionEnabled = false
        view.onChange = onChange
        return view
    }

    func updateUIView(_ uiView: BoundsView, context: Context) {
        uiView.onChange = onChange
        uiView.publishGeometry()
    }

    final class BoundsView: UIView {
        var onChange: ((NavigationBisectWindowGeometry) -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            publishGeometry()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            publishGeometry()
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            publishGeometry()
        }

        func publishGeometry() {
            guard let keyWindow = window?.windowScene?.windows.first(where: \.isKeyWindow) else { return }
            let updated = NavigationBisectWindowGeometry(window: keyWindow)
            DispatchQueue.main.async { self.onChange?(updated) }
        }
    }
}

struct ContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @AppStorage("jarvis.appTheme") private var storedTheme = "system"
    @GestureState private var sidebarDrag = SidebarDrag()
    @StateObject private var workspaceRuntime: WorkspaceRuntime
    @State private var navigation = JarvisNavigationState()
    @StateObject private var navigationWrites: NavigationBisectWrites
    @StateObject private var voiceModel: VoiceScreenModel
    @State private var sidebarGestureGeneration = 0
    private let chatClient: JarvisClient?
    private let startupError: String?
    private let fixtureMode: Bool
    private let navigationFixtureMode: Bool
    private let navigationBisectVariant = NavigationBisectVariant.current
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

    init(client: JarvisClient? = nil, webAppURL: URL? = nil) {
        let arguments = ProcessInfo.processInfo.arguments
#if targetEnvironment(simulator)
        let navigationFixtureMode = arguments.contains("--ui-test-navigation")
        let calendarChangeLanguage: JarvisAppLanguage? = arguments.contains("--screenshot-calendar-change-fixture")
            ? JarvisAppLanguage(rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? "")
                ?? .default
            : nil
#else
        let navigationFixtureMode = false
        let calendarChangeLanguage: JarvisAppLanguage? = nil
#endif
        let sidebarInitiallyOpen = arguments.contains("--screenshot-sidebar-open")
        let settingsPreview = arguments.contains("--screenshot-settings-fixture")
        let voiceConnectionScreenshot = arguments.contains("--screenshot-voice-connection-lost")
        let voiceScreenshotLanguage = arguments
            .first(where: { $0.hasPrefix("--screenshot-voice-language=") })
            .map { String($0.dropFirst("--screenshot-voice-language=".count)) }
            .flatMap(JarvisAppLanguage.init(rawValue:))
        let factoryScreenshot = JarvisFactoryScreenshotConfiguration.parse(arguments: arguments)
        let factoryFixtureMode = navigationFixtureMode || arguments.contains("--screenshot-factory-fixture")
        let healthFixtureMode = navigationFixtureMode || arguments.contains("--screenshot-health-fixture")
        let healthState = healthFixtureMode ? arguments.first(where: {
            $0.hasPrefix("--screenshot-health-state=")
        })?.components(separatedBy: "=").last : nil
        let healthLanguage = healthFixtureMode ? arguments.first(where: {
            $0.hasPrefix("--screenshot-health-language=")
        })?.components(separatedBy: "=").last.flatMap(JarvisAppLanguage.init(rawValue:)) : nil
        let activityScreenshotState = arguments
            .first(where: { $0.hasPrefix("--screenshot-activity-state=") })
            .map { String($0.dropFirst("--screenshot-activity-state=".count)) }
            .flatMap { $0 == "empty" || $0 == "active" ? $0 : nil }
        self.activityScreenshotState = activityScreenshotState
        let fixtureMode = settingsPreview
            || voiceConnectionScreenshot
            || arguments.contains("--screenshot-chat-fixture")
            || activityScreenshotState != nil
            || factoryFixtureMode
            || healthFixtureMode
            || calendarChangeLanguage != nil
        var initialNavigation = JarvisNavigationState()
        let writes = NavigationBisectWrites()
        writes.record("init", before: false, after: initialNavigation.isSidebarOpen)
        func mutateInitial(_ tag: String, _ mutation: (inout JarvisNavigationState) -> Void) {
            let before = initialNavigation.isSidebarOpen
            writes.record(tag, before: before, after: before, stage: "prewrite")
            mutation(&initialNavigation)
            writes.record(tag, before: before, after: initialNavigation.isSidebarOpen)
        }
        if sidebarInitiallyOpen {
            mutateInitial("init.openSidebar") { $0.openSidebar() }
        }
        if settingsPreview {
            mutateInitial("init.settings") { $0.navigate(to: .settings) }
        }
        if voiceConnectionScreenshot {
            mutateInitial("init.voiceConnection") { $0.navigate(to: .voice) }
        } else if fixtureMode,
                  let screen = arguments.first(where: { $0.hasPrefix("--screenshot-screen=") })?
            .split(separator: "=", maxSplits: 1).last,
                  let destination = ["voice": JarvisDestination.voice, "notes": .notes, "health": .health,
                                     "settings": .settings][String(screen)] {
            mutateInitial("init.destination") { $0.navigate(to: destination) }
        }
        if factoryScreenshot != nil {
            mutateInitial("init.factory") { $0.navigate(to: .softwareFactory) }
        }
        if healthFixtureMode && !navigationFixtureMode {
            mutateInitial("init.health") { $0.navigate(to: .health) }
        }
        healthScreenshotState = healthState
        healthScreenshotLanguage = healthLanguage
#if targetEnvironment(simulator)
        if arguments.contains("--screenshot-voice-fixture") {
            mutateInitial("init.voiceFixture") { $0.navigate(to: .voice) }
        }
#endif
        self.fixtureMode = fixtureMode
        self.navigationFixtureMode = navigationFixtureMode
        self.voiceScreenshotLanguage = voiceScreenshotLanguage
        self.factoryScreenshot = factoryScreenshot
        self.factoryFixtureMode = factoryFixtureMode
        _voiceModel = StateObject(
            wrappedValue: VoiceScreenModel(screenshotConnectionLost: voiceConnectionScreenshot)
        )
        let resolvedClient: JarvisClient?
        let resolvedStartupError: String?
        if fixtureMode {
            if let calendarChangeLanguage {
                resolvedClient = try? JarvisFixtureScenario.makeClient(calendarChangeLanguage: calendarChangeLanguage)
            } else {
                resolvedClient = try? JarvisFixtureScenario.makeClient(emptyActivity: activityScreenshotState == "empty")
            }
            resolvedStartupError = resolvedClient == nil ? "Fixture preview is unavailable." : nil
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
        _navigationWrites = StateObject(wrappedValue: writes)
        _notesClient = State(initialValue: Self.makeNotesClient(fixtureMode: fixtureMode))
        _healthClient = State(initialValue: healthFixtureMode
            ? try? JarvisHealthLiftFixture.makeClient(language: healthLanguage ?? .da, empty: healthState == "empty")
            : Self.makeHealthClient(fixtureMode: fixtureMode))
        _factoryClient = State(initialValue: Self.makeFactoryClient(
            previewState: factoryScreenshot?.state ?? (navigationFixtureMode ? .board : nil),
            fixtureMode: factoryFixtureMode
        ))
    }

    var body: some View {
        let currentNavigation = navigation
        let currentDrag = sidebarDrag
        let gestureGeneration = sidebarGestureGeneration
        let committedProgress: CGFloat = currentNavigation.isSidebarOpen ? 1 : 0
        let isDragging = currentDrag.isActive && currentDrag.generation == gestureGeneration
        Group {
            if navigationBisectVariant == .E {
                NavigationBisectWindowShell { size, safeAreaInsets in
                    sidebarShell(
                        size: size, safeAreaInsets: safeAreaInsets,
                        currentNavigation: currentNavigation, currentDrag: currentDrag,
                        gestureGeneration: gestureGeneration, committedProgress: committedProgress,
                        isDragging: isDragging
                    )
                }
            } else {
                GeometryReader { geometry in
                    sidebarShell(
                        size: geometry.size,
                        safeAreaInsets: Self.resolvedSafeAreaInsets(fallback: geometry.safeAreaInsets),
                        currentNavigation: currentNavigation, currentDrag: currentDrag,
                        gestureGeneration: gestureGeneration, committedProgress: committedProgress,
                        isDragging: isDragging
                    )
                }
            }
        }
        .ignoresSafeArea(.container)
        .preferredColorScheme(themeColorScheme)
    }

    private func sidebarShell(
        size: CGSize,
        safeAreaInsets: EdgeInsets,
        currentNavigation: JarvisNavigationState,
        currentDrag: SidebarDrag,
        gestureGeneration: Int,
        committedProgress: CGFloat,
        isDragging: Bool
    ) -> some View {
            let drawerWidth = min(
                size.width * JarvisDesignTokens.sidebarWidthFraction,
                JarvisDesignTokens.sidebarMaximumWidth
            )
            let progress = isDragging
                ? min(max(committedProgress - currentDrag.translation / max(drawerWidth, 1), 0), 1)
                : committedProgress

            return ZStack(alignment: .trailing) {
                JarvisSidebar(
                    currentDestination: currentNavigation.currentDestination,
                    isOpen: currentNavigation.isSidebarOpen,
                    safeAreaInsets: safeAreaInsets,
                    onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) },
                    onClose: closeSidebar
                )
                .frame(width: drawerWidth, height: size.height)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .allowsHitTesting(currentNavigation.isSidebarOpen)

                NavigationStack(
                    path: Binding(
                        get: { navigation.path },
                        set: {
                            guard $0 != navigation.path else { return }
                            sidebarGestureGeneration += 1
                            let path = $0
                            mutateNavigation("pathBinding.setPath") { $0.setPath(path) }
                            mutateNavigation("pathBinding.closeSidebar") { $0.closeSidebar() }
                        }
                    )
                ) {
                    JarvisChatScreen(
                        client: chatClient,
                        fixtureMode: fixtureMode,
                        initialActivitySheet: activityScreenshotState != nil
                            ? .background
                            : (fixtureMode && ProcessInfo.processInfo.arguments.contains("--screenshot-notifications-open")
                                || fixtureMode && ProcessInfo.processInfo.arguments.contains("--screenshot-screen=notifications")
                                ? .needsYou : nil),
                        startupError: startupError,
                        showsSidebarToolbarButton: navigationBisectVariant != .F,
                        onOpenSidebar: { setSidebarOpen(true) },
                        onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) }
                    )
                        .navigationDestination(for: JarvisDestination.self) { destination in
                            if destination == .workspaces {
                                WorkspacesView(runtime: workspaceRuntime)
                            } else if destination == .voice {
                                VoiceScreenView(
                                    model: voiceModel,
                                    language: voiceScreenshotLanguage ?? language,
                                    fixtureMode: fixtureMode && !navigationFixtureMode,
                                    onMinimize: { navigate(to: .chat, drawerWidth: drawerWidth) },
                                    onEnd: { navigate(to: .chat, drawerWidth: drawerWidth) }
                                )
                            } else if destination == .chat {
                                JarvisChatScreen(
                                    client: chatClient,
                                    fixtureMode: fixtureMode,
                                    startupError: startupError,
                                    showsSidebarToolbarButton: navigationBisectVariant != .F,
                                    onOpenSidebar: { setSidebarOpen(true) },
                                    onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) }
                                )
                            } else if destination == .notes {
                                JarvisNotesArea(
                                    client: notesClient,
                                    language: language,
                                    onRetryConfiguration: { notesClient = Self.makeNotesClient(fixtureMode: fixtureMode) },
                                    onOpenSidebar: { setSidebarOpen(true) }
                                )
                            } else if destination == .health {
                                JarvisHealthArea(
                                    client: healthClient,
                                    language: healthScreenshotLanguage ?? language,
                                    observeRefreshEvents: !fixtureMode,
                                    onRetryConfiguration: { healthClient = Self.makeHealthClient(fixtureMode: fixtureMode) },
                                    now: fixtureMode ? JarvisHealthPreview.now : Date(),
                                    workoutInitiallySelected: healthScreenshotState != nil,
                                    presentNewLiftAfterLoading: healthScreenshotState == "newlift",
                                    onOpenSidebar: { setSidebarOpen(true) }
                                )
                            } else if destination == .softwareFactory {
                                JarvisFactoryArea(
                                    client: factoryClient,
                                    language: factoryScreenshot?.language ?? language,
                                    onRetryConfiguration: {
                                        factoryClient = Self.makeFactoryClient(
                                            previewState: factoryScreenshot?.state,
                                            fixtureMode: factoryFixtureMode
                                        )
                                    },
                                    previewState: factoryScreenshot?.state,
                                    liveUpdatesEnabled: !factoryFixtureMode,
                                    onOpenSidebar: { setSidebarOpen(true) }
                                )
                            } else if destination == .settings {
                                JarvisSettingsArea(
                                    storedLanguage: $storedLanguage,
                                    storedTheme: $storedTheme,
                                    client: settingsClient,
                                    onSignedOut: {
                                        NotificationCenter.default.post(name: .jarvisSessionRevoked, object: nil)
                                    }
                                )
                            } else {
                                JarvisPlaceholderView(destination: destination, language: language)
                            }
                        }
                }
                .tint(JarvisDesignTokens.primaryAccent)
                .task { await workspaceRuntime.run() }
                .onChange(of: voiceModel.voiceState) { _, state in
                    guard navigationBisectVariant != .K else { return }
                    mutateNavigation(state == .ended ? "voiceEnded.stateChanged" : "voiceStateChanged") {
                        $0.voiceSessionStateChanged(state)
                    }
                    if state == .ended { setSidebarOpen(false, caller: "voiceEnded.closeSidebar") }
                }
                .onChange(of: workspaceRuntime.requestedDestination) { _, destination in
                    guard navigationBisectVariant != .K, destination != nil,
                          let destination = workspaceRuntime.consumeRequestedDestination() else {
                        return
                    }
                    navigate(to: destination, drawerWidth: drawerWidth)
                }
                .sheet(
                    item: Binding(
                        get: { workspaceRuntime.presentedView },
                        set: { if $0 == nil { workspaceRuntime.userDismissedView() } }
                    )
                ) { presented in
                    GeneratedWorkspaceSheet(presented: presented, runtime: workspaceRuntime)
                }
                .allowsHitTesting(!currentNavigation.isSidebarOpen)
                .frame(width: size.width, height: size.height)
                .overlay(alignment: .topLeading) {
                    if navigationBisectVariant == .F,
                       currentNavigation.currentDestination == .chat {
                        Button { setSidebarOpen(true) } label: {
                            Image(systemName: "line.3.horizontal")
                                .frame(
                                    width: JarvisDesignTokens.chatMinimumTapTarget,
                                    height: JarvisDesignTokens.chatMinimumTapTarget
                                )
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .tint(JarvisDesignTokens.primaryAccent)
                        .accessibilityLabel(JarvisNotesLocalization.string(.openSidebar, language: language))
                        .accessibilityIdentifier("navigation.openSidebar")
                        .modifier(NavigationBisectMenuValue())
                        .padding(.leading, safeAreaInsets.leading + 16)
                        .padding(.top, safeAreaInsets.top)
                        .allowsHitTesting(!currentNavigation.isSidebarOpen)
                    }
                }
                .background { JarvisScreenBackground() }
                .overlay {
                    if navigationBisectVariant != .H {
                      Color.black
                        .opacity(progress * JarvisDesignTokens.screenDimOpacity)
                        .accessibilityHidden(true)
                        .allowsHitTesting(false)
                    }
                }
                .blur(radius: navigationBisectVariant == .H ? 0 : progress * JarvisDesignTokens.screenBlurRadius)
                .overlay {
                    if currentNavigation.isSidebarOpen, navigationBisectVariant != .C {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture(perform: closeSidebar)
                            .simultaneousGesture(sidebarDragGesture(
                                screenWidth: size.width, drawerWidth: drawerWidth,
                                generation: gestureGeneration, startProgress: committedProgress
                            ))
                            .id(gestureGeneration)
                            .accessibilityHidden(true)
                    }
                }
                .offset(x: -drawerWidth * progress)
                .accessibilityElement(children: .contain)
                .accessibilityAction(
                    named: Text(JarvisNotesLocalization.string(.openSidebar, language: language))
                ) {
                    setSidebarOpen(true, caller: "accessibility.openSidebar")
                }
                .accessibilityHidden(currentNavigation.isSidebarOpen)

                if !currentNavigation.isSidebarOpen, navigationBisectVariant != .B {
                    Color.clear
                        .frame(width: JarvisDesignTokens.sidebarEdgeGestureWidth)
                        .contentShape(Rectangle())
                        .gesture(sidebarDragGesture(
                            screenWidth: size.width, drawerWidth: drawerWidth,
                            generation: gestureGeneration, startProgress: committedProgress
                        ))
                        .id(gestureGeneration)
                        .accessibilityHidden(true)
                }

                if voiceModel.isMinimized {
                    VoiceMiniBar(model: voiceModel) {
                        voiceModel.restore()
                        navigate(to: .voice, drawerWidth: drawerWidth)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, safeAreaInsets.bottom + JarvisDesignTokens.voiceControlBottomInset)
                }
            }
            .frame(width: size.width, height: size.height)
            .overlay(alignment: .topLeading) {
                if let variant = navigationBisectVariant {
                    NavigationBisectProbe(identifier: "navigation.bisectState") { isEnabled in
                        "variant=\(variant.rawValue);isSidebarOpen=\(currentNavigation.isSidebarOpen);"
                            + "sidebarXOffset=\(-drawerWidth * progress);"
                            + "sidebarDisabled=\(!currentNavigation.isSidebarOpen || !isEnabled);"
                            + "contentDisabled=\(currentNavigation.isSidebarOpen || !isEnabled)"
                    }
                    if [.G, .H, .I, .J, .K].contains(variant) {
                        NavigationBisectWritesProbe(writes: navigationWrites)
                            .offset(y: 2)
                    }
                }
            }
            .background { JarvisScreenBackground() }
            .coordinateSpace(name: "sidebar")
            .clipped()
            .environment(\.locale, language.locale)
            .onAppear {
                if JarvisAppLanguage(rawValue: storedLanguage) == nil {
                    storedLanguage = JarvisAppLanguage.default.rawValue
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard navigationBisectVariant != .K else { return }
                if phase != .active { setSidebarOpen(false, caller: "scenePhase") }
            }
    }

    private var themeColorScheme: ColorScheme? {
        switch storedTheme {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }

    private static var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
    }

    private static func resolvedSafeAreaInsets(fallback: EdgeInsets) -> EdgeInsets {
        guard let window = keyWindow else {
            return fallback
        }
        let insets = window.safeAreaInsets
        return EdgeInsets(
            top: max(fallback.top, insets.top),
            leading: max(fallback.leading, insets.left),
            bottom: max(fallback.bottom, insets.bottom),
            trailing: max(fallback.trailing, insets.right)
        )
    }

    private func sidebarDragGesture(
        screenWidth: CGFloat,
        drawerWidth: CGFloat,
        generation: Int,
        startProgress: CGFloat
    ) -> some Gesture {
        return DragGesture(
            minimumDistance: JarvisDesignTokens.sidebarGestureMinimumDistance,
            coordinateSpace: .named("sidebar")
        )
            .updating($sidebarDrag) { value, state, transaction in
                guard generation == sidebarGestureGeneration else { return }
                if state.isActive {
                    guard state.generation == sidebarGestureGeneration else { return }
                    state.translation = value.translation.width
                    if navigationBisectVariant != .D { transaction.disablesAnimations = true }
                    return
                }
                guard canBeginSidebarDrag(value, screenWidth: screenWidth,
                                         drawerWidth: drawerWidth, startProgress: startProgress) else { return }
                state = SidebarDrag(
                    translation: value.translation.width,
                    isActive: true,
                    generation: sidebarGestureGeneration
                )
                if navigationBisectVariant != .D { transaction.disablesAnimations = true }
            }
            .onEnded { value in
                guard generation == sidebarGestureGeneration,
                      canBeginSidebarDrag(value, screenWidth: screenWidth,
                                          drawerWidth: drawerWidth, startProgress: startProgress) else { return }
                let projectedProgress = startProgress -
                    value.predictedEndTranslation.width / max(drawerWidth, 1)
                setSidebarOpen(projectedProgress > JarvisDesignTokens.sidebarOpenThreshold, caller: "gesture.ended")
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
        reduceMotion ? nil : .interactiveSpring(
                response: JarvisDesignTokens.sidebarSpringResponse,
                dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        )
    }

    private func mutateNavigation(_ tag: String, _ mutation: (inout JarvisNavigationState) -> Void) {
        let before = navigation.isSidebarOpen
        navigationWrites.record(tag, before: before, after: before, stage: "prewrite")
        mutation(&navigation)
        navigationWrites.record(tag, before: before, after: navigation.isSidebarOpen)
    }

    private func setSidebarOpen(_ open: Bool, caller: String = "menu.openSidebar") {
#if targetEnvironment(simulator)
        if navigationFixtureMode {
            print("Jarvis navigation command: sidebar=\(navigation.isSidebarOpen) requested=\(open)")
        }
#endif
        sidebarGestureGeneration += 1
        if open {
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
            )
        }
        if navigationBisectVariant == .D {
            mutateNavigation(caller) { $0.setSidebarOpen(open) }
        } else {
            withAnimation(sidebarAnimation) {
                mutateNavigation(caller) { $0.setSidebarOpen(open) }
            }
        }
    }

    private func navigate(to destination: JarvisDestination, drawerWidth: CGFloat) {
        if destination == .voice {
            voiceModel.restore()
        } else if navigation.currentDestination == .voice && voiceModel.isSessionActive {
            voiceModel.minimize()
        }
        sidebarGestureGeneration += 1
        if navigationFixtureMode {
            switch destination {
            case .notes:
                notesClient = Self.makeNotesClient(fixtureMode: true)
            case .health:
                healthClient = try? JarvisHealthLiftFixture.makeClient(language: language, empty: false)
            case .softwareFactory:
                factoryClient = Self.makeFactoryClient(previewState: .board, fixtureMode: true)
            default: break
            }
        }
        if navigationBisectVariant == .D {
            mutateNavigation("navigate.\(destination.rawValue)") { $0.navigate(to: destination) }
        } else {
            withAnimation(sidebarAnimation) {
                mutateNavigation("navigate.\(destination.rawValue)") { $0.navigate(to: destination) }
            }
        }
    }

    private func closeSidebar() {
        setSidebarOpen(false, caller: "closeSidebar")
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

private struct SidebarDrag: Equatable {
    var translation: CGFloat = 0
    var isActive = false
    var generation = 0
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
