import JarvisCore
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @AppStorage("jarvis.appTheme") private var storedTheme = "system"
    @EnvironmentObject private var navigation: JarvisNavigationModel
    @StateObject private var workspaceRuntime: WorkspaceRuntime
    @StateObject private var voiceModel: VoiceScreenModel
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
    private let sessionEpoch: Int
    @State private var appliedSessionEpoch: Int

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
        }

    init(client: JarvisClient? = nil, webAppURL: URL? = nil, sessionEpoch: Int = 0) {
        self.sessionEpoch = sessionEpoch
        _appliedSessionEpoch = State(initialValue: sessionEpoch)
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
        healthScreenshotState = healthState
        healthScreenshotLanguage = healthLanguage
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
                // Reads the current Keychain session per request; only the gate may open Microsoft sign-in.
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
            sidebarShell(
                size: geometry.size,
                safeAreaInsets: Self.resolvedSafeAreaInsets(fallback: geometry.safeAreaInsets)
            )
        }
        .ignoresSafeArea(.container)
        .preferredColorScheme(themeColorScheme)
        .onDisappear { workspaceRuntime.resetSession() }
    }

    private func sidebarShell(
        size: CGSize,
        safeAreaInsets: EdgeInsets
    ) -> some View {
            let drawerWidth = min(
                size.width * JarvisDesignTokens.sidebarWidthFraction,
                JarvisDesignTokens.sidebarMaximumWidth
            )
            return ZStack(alignment: .trailing) {
                NavigationStack(
                    path: Binding(
                        get: { navigation.path },
                        set: {
                            navigation.setPath($0)
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
                        onNavigate: { navigate(to: $0) }
                    )
                        // Only session-owned screen data is discarded; the navigation host stays installed.
                        .id(sessionEpoch)
                        .navigationDestination(for: JarvisDestination.self) { destination in
                            Group {
                                if destination == .workspaces {
                                    WorkspacesView(runtime: workspaceRuntime)
                                } else if destination == .voice {
                                    VoiceScreenView(
                                        model: voiceModel,
                                        language: voiceScreenshotLanguage ?? language,
                                        fixtureMode: fixtureMode && !navigationFixtureMode,
                                        onMinimize: { navigate(to: .chat) },
                                        onEnd: { navigate(to: .chat) }
                                    )
                                } else if destination == .chat {
                                    JarvisChatScreen(
                                        client: chatClient,
                                        fixtureMode: fixtureMode,
                                        startupError: startupError,
                                        onNavigate: { navigate(to: $0) }
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
                            .id(sessionEpoch)
                        }
                }
                .tint(JarvisDesignTokens.primaryAccent)
                .task(id: sessionEpoch) {
                    if appliedSessionEpoch != sessionEpoch {
                        workspaceRuntime.resetSession()
                        await voiceModel.end(returnToChat: false)
                        guard !Task.isCancelled else { return }
                        appliedSessionEpoch = sessionEpoch
                        if navigation.currentDestination == .voice { await voiceModel.start() }
                    }
                    guard !Task.isCancelled else { return }
                    await workspaceRuntime.run()
                }
                .onChange(of: voiceModel.voiceState) { _, state in
                    guard appliedSessionEpoch == sessionEpoch else { return }
                    navigation.voiceSessionStateChanged(state)
                }
                .onChange(of: workspaceRuntime.requestedDestination) { _, destination in
                    guard destination != nil,
                          let destination = workspaceRuntime.consumeRequestedDestination() else {
                        return
                    }
                    navigate(to: destination)
                }
                .sheet(
                    item: Binding(
                        get: { workspaceRuntime.presentedView },
                        set: { if $0 == nil { workspaceRuntime.userDismissedView() } }
                    )
                ) { presented in
                    GeneratedWorkspaceSheet(presented: presented, runtime: workspaceRuntime)
                }
                .frame(width: size.width, height: size.height)
                .background { JarvisScreenBackground() }
                .accessibilityElement(children: .contain)
                .accessibilityAction(
                    named: Text(JarvisNotesLocalization.string(.openSidebar, language: language))
                ) {
                    navigation.openSidebar()
                }
                .accessibilityHidden(navigation.isSidebarOpen)

                if !navigation.isSidebarOpen {
                    Color.clear
                        .frame(width: JarvisDesignTokens.sidebarEdgeGestureWidth)
                        .contentShape(Rectangle())
                        .gesture(sidebarEdgeGesture(screenWidth: size.width, drawerWidth: drawerWidth))
                        .accessibilityHidden(true)
                }

                if voiceModel.isMinimized {
                    VoiceMiniBar(model: voiceModel) {
                        voiceModel.restore()
                        navigate(to: .voice)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, safeAreaInsets.bottom + JarvisDesignTokens.voiceControlBottomInset)
                    .accessibilityHidden(navigation.isSidebarOpen)
                }
            }
            .frame(width: size.width, height: size.height)
            .overlay(alignment: .trailing) {
                if navigation.isSidebarOpen {
                    ZStack(alignment: .trailing) {
                        Color.black.opacity(JarvisDesignTokens.screenDimOpacity)
                            .ignoresSafeArea()
                            .contentShape(Rectangle())
                            .onTapGesture { navigation.closeSidebar() }
                            .accessibilityHidden(true)

                        JarvisSidebar(
                            currentDestination: navigation.currentDestination,
                            safeAreaInsets: safeAreaInsets,
                            onNavigate: { navigate(to: $0) }
                        )
                        .frame(width: drawerWidth, height: size.height)
                        .transition(reduceMotion ? .opacity : .move(edge: .trailing))
                    }
                }
            }
            .animation(sidebarAnimation, value: navigation.isSidebarOpen)
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
                if phase != .active {
                    var transaction = Transaction()
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { navigation.closeSidebar() }
                }
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

    private func sidebarEdgeGesture(screenWidth: CGFloat, drawerWidth: CGFloat) -> some Gesture {
        DragGesture(
            minimumDistance: JarvisDesignTokens.sidebarGestureMinimumDistance,
            coordinateSpace: .named("sidebar")
        )
            .onEnded { value in
                guard scenePhase == .active, !navigation.isSidebarOpen,
                      JarvisSidebarGesturePolicy.canBegin(
                        startX: Double(value.startLocation.x),
                        translationX: Double(value.translation.width),
                        translationY: Double(value.translation.height),
                        screenWidth: Double(screenWidth),
                        drawerWidth: Double(drawerWidth),
                        startProgress: 0,
                        openingStartFraction: Double(JarvisDesignTokens.sidebarGestureStartFraction)
                      ),
                      -value.translation.width / max(drawerWidth, 1)
                        > JarvisDesignTokens.sidebarOpenThreshold else { return }
                navigation.openSidebar()
            }
    }

    private var sidebarAnimation: Animation? {
        reduceMotion ? nil : .interactiveSpring(
                response: JarvisDesignTokens.sidebarSpringResponse,
                dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        )
    }

    private func navigate(to destination: JarvisDestination) {
        if destination == .voice {
            voiceModel.restore()
        } else if navigation.currentDestination == .voice && voiceModel.isSessionActive {
            voiceModel.minimize()
        }
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

    static func initialNavigation(arguments: [String] = ProcessInfo.processInfo.arguments) -> JarvisNavigationState {
        var state = JarvisNavigationState()
#if targetEnvironment(simulator)
        let navigationFixture = arguments.contains("--ui-test-navigation")
        let calendarFixture = arguments.contains("--screenshot-calendar-change-fixture")
#else
        let navigationFixture = false
        let calendarFixture = false
#endif
        let fixtureMode = navigationFixture || calendarFixture
            || arguments.contains("--screenshot-settings-fixture")
            || arguments.contains("--screenshot-voice-connection-lost")
            || arguments.contains("--screenshot-chat-fixture")
            || arguments.contains("--screenshot-factory-fixture")
            || arguments.contains("--screenshot-health-fixture")
            || arguments.contains("--screenshot-activity-state=empty")
            || arguments.contains("--screenshot-activity-state=active")
        if arguments.contains("--screenshot-sidebar-open") { state.openSidebar() }
        if arguments.contains("--screenshot-settings-fixture") { state.navigate(to: .settings) }
        if arguments.contains("--screenshot-voice-connection-lost") {
            state.navigate(to: .voice)
        } else if fixtureMode,
                  let screen = arguments.first(where: { $0.hasPrefix("--screenshot-screen=") })?
                    .split(separator: "=", maxSplits: 1).last,
                  let destination = ["voice": JarvisDestination.voice, "notes": .notes,
                                     "health": .health, "settings": .settings][String(screen)] {
            state.navigate(to: destination)
        }
        if JarvisFactoryScreenshotConfiguration.parse(arguments: arguments) != nil {
            state.navigate(to: .softwareFactory)
        }
        if arguments.contains("--screenshot-health-fixture"),
           !navigationFixture {
            state.navigate(to: .health)
        }
#if targetEnvironment(simulator)
        if arguments.contains("--screenshot-voice-fixture") { state.navigate(to: .voice) }
#endif
        return state
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
