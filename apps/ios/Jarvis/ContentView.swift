import JarvisCore
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @AppStorage("jarvis.appTheme") private var storedTheme = "system"
    @GestureState private var sidebarDrag = SidebarDrag()
    @StateObject private var workspaceRuntime: WorkspaceRuntime
    @State private var navigation = JarvisNavigationState()
    @StateObject private var voiceModel: VoiceScreenModel
    @State private var sidebarGestureGeneration = 0
    private let chatClient: JarvisClient?
    private let startupError: String?
    private let fixtureMode: Bool
    private let navigationFixtureMode: Bool
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
#else
        let navigationFixtureMode = false
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
        if healthFixtureMode && !navigationFixtureMode { initialNavigation.navigate(to: .health) }
        healthScreenshotState = healthState
        healthScreenshotLanguage = healthLanguage
#if targetEnvironment(simulator)
        if arguments.contains("--screenshot-voice-fixture") {
            initialNavigation.navigate(to: .voice)
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
            resolvedClient = try? JarvisFixtureScenario.makeClient(emptyActivity: activityScreenshotState == "empty")
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
        GeometryReader { geometry in
            let safeAreaInsets = Self.resolvedSafeAreaInsets(fallback: geometry.safeAreaInsets)
            let drawerWidth = min(
                geometry.size.width * JarvisDesignTokens.sidebarWidthFraction,
                JarvisDesignTokens.sidebarMaximumWidth
            )
            let isDragging = sidebarDrag.isActive && sidebarDrag.generation == sidebarGestureGeneration
            let progress = isDragging
                ? min(max(sidebarDrag.startProgress - sidebarDrag.translation / max(drawerWidth, 1), 0), 1)
                : navigation.isSidebarOpen ? CGFloat(1) : CGFloat(0)

            ZStack(alignment: .trailing) {
                JarvisSidebar(
                    currentDestination: navigation.currentDestination,
                    isOpen: navigation.isSidebarOpen,
                    safeAreaInsets: safeAreaInsets,
                    onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) },
                    onClose: closeSidebar
                )
                .frame(width: drawerWidth, height: geometry.size.height)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .allowsHitTesting(navigation.isSidebarOpen)

                NavigationStack(
                    path: Binding(
                        get: { navigation.path },
                        set: {
                            sidebarGestureGeneration += 1
                            navigation.setPath($0)
                            navigation.closeSidebar()
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
                                    onOpenSidebar: { setSidebarOpen(true) },
                                    onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) }
                                )
                            } else if destination == .notes {
                                JarvisNotesArea(
                                    client: notesClient,
                                    language: language,
                                    onRetryConfiguration: { notesClient = Self.makeNotesClient(fixtureMode: fixtureMode) }
                                )
                            } else if destination == .health {
                                JarvisHealthArea(
                                    client: healthClient,
                                    language: healthScreenshotLanguage ?? language,
                                    observeRefreshEvents: !fixtureMode,
                                    onRetryConfiguration: { healthClient = Self.makeHealthClient(fixtureMode: fixtureMode) },
                                    now: fixtureMode ? JarvisHealthPreview.now : Date(),
                                    workoutInitiallySelected: healthScreenshotState != nil,
                                    presentNewLiftAfterLoading: healthScreenshotState == "newlift"
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
                                    liveUpdatesEnabled: !factoryFixtureMode
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
                    navigation.voiceSessionStateChanged(state)
                    if state == .ended { setSidebarOpen(false) }
                }
                .onChange(of: workspaceRuntime.requestedDestination) { _, destination in
                    guard destination != nil,
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
                .allowsHitTesting(!navigation.isSidebarOpen)
                .frame(width: geometry.size.width, height: geometry.size.height)
                .background { JarvisScreenBackground() }
                .overlay {
                    Color.black
                        .opacity(progress * JarvisDesignTokens.screenDimOpacity)
                        .accessibilityHidden(true)
                        .allowsHitTesting(false)
                }
                .blur(radius: progress * JarvisDesignTokens.screenBlurRadius)
                .overlay {
                    if navigation.isSidebarOpen || (isDragging && progress > 0) {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture(perform: closeSidebar)
                            .simultaneousGesture(sidebarDragGesture(
                                screenWidth: geometry.size.width, drawerWidth: drawerWidth
                            ))
                            .accessibilityHidden(true)
                    }
                }
                .offset(x: -drawerWidth * progress)
                .animation(sidebarAnimation, value: navigation.isSidebarOpen)
                .accessibilityElement(children: .contain)
                .accessibilityAction(
                    named: Text(JarvisNotesLocalization.string(.openSidebar, language: language))
                ) {
                    setSidebarOpen(true)
                }
                .accessibilityHidden(navigation.isSidebarOpen)

                if !navigation.isSidebarOpen {
                    Color.clear
                        .frame(width: JarvisDesignTokens.sidebarEdgeGestureWidth)
                        .contentShape(Rectangle())
                        .gesture(sidebarDragGesture(
                            screenWidth: geometry.size.width, drawerWidth: drawerWidth
                        ))
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
            .frame(width: geometry.size.width, height: geometry.size.height)
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
                if phase != .active { setSidebarOpen(false) }
            }
        }
        .ignoresSafeArea(.container)
        .preferredColorScheme(themeColorScheme)
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
        return EdgeInsets(
            top: max(fallback.top, insets.top),
            leading: max(fallback.leading, insets.left),
            bottom: max(fallback.bottom, insets.bottom),
            trailing: max(fallback.trailing, insets.right)
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
                if state.isActive {
                    guard state.generation == sidebarGestureGeneration else { return }
                    state.translation = value.translation.width
                    transaction.disablesAnimations = true
                    return
                }
                let startProgress: CGFloat = navigation.isSidebarOpen ? 1 : 0
                guard canBeginSidebarDrag(value, screenWidth: screenWidth,
                                         drawerWidth: drawerWidth, startProgress: startProgress) else { return }
                state = SidebarDrag(
                    startProgress: startProgress,
                    translation: value.translation.width,
                    isActive: true,
                    generation: sidebarGestureGeneration
                )
                transaction.disablesAnimations = true
            }
            .onEnded { value in
                guard sidebarDrag.isActive,
                      sidebarDrag.generation == sidebarGestureGeneration else { return }
                let projectedProgress = sidebarDrag.startProgress -
                    value.predictedEndTranslation.width / max(drawerWidth, 1)
                setSidebarOpen(projectedProgress > JarvisDesignTokens.sidebarOpenThreshold)
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

    private func setSidebarOpen(_ open: Bool) {
        sidebarGestureGeneration += 1
        if open {
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
            )
        }
        navigation.setSidebarOpen(open)
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
        navigation.navigate(to: destination)
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

private struct SidebarDrag: Equatable {
    var startProgress: CGFloat = 0
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
