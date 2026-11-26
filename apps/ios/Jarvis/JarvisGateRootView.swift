import JarvisCore
import LocalAuthentication
import SwiftUI
import UIKit

private enum JarvisLockState: Equatable {
    case waiting
    case failed
    case passcode
    case signedOut
}

private enum JarvisGatePresentation: Equatable {
    case loading
    case signIn(JarvisSignInState)
    case lock(JarvisLockState)
    case unlocked
}

private extension JarvisAppLanguage {
    static var current: JarvisAppLanguage {
        .default
    }

    func text(_ key: JarvisNotesLocalizationKey) -> String {
        JarvisNotesLocalization.string(key, language: self)
    }

    var signIn: String { text(.gateSignIn) }
    var signingIn: String { text(.gateSigningIn) }
    var retry: String { text(.gateRetry) }
    var failed: String { text(.gateFailed) }
    var denied: String { text(.gateDenied) }
    var signOut: String { text(.gateSignOut) }
    var offline: String { text(.gateOffline) }
    var faceIDFailed: String { text(.gateFaceIDFailed) }
    var usePasscode: String { text(.gateUsePasscode) }
    var signedOut: String { text(.gateSignedOut) }
    var faceIDReason: String { text(.gateFaceIDReason) }
    var faceIDLabel: String { text(.gateFaceIDLabel) }
}

final class JarvisGateOverlayWindow: UIWindow {
    var isPrivacyCover = false
    override var canBecomeKey: Bool { false }
}

@MainActor
private final class JarvisGateOverlay {
    private var window: JarvisGateOverlayWindow?

    func update(visible: Bool, model: JarvisGateModel) {
        guard visible else {
            window?.isUserInteractionEnabled = false
            window?.isHidden = true
            window = nil
            return
        }
        if let window {
            window.isPrivacyCover = model.presentation == .unlocked
            window.isUserInteractionEnabled = model.shouldCoverContent
            return
        }
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            return
        }

        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        let overlay = JarvisGateOverlayWindow(windowScene: scene)
        overlay.isPrivacyCover = model.presentation == .unlocked
        // While the opening fades out over a ready Home, touches pass through to it.
        overlay.isUserInteractionEnabled = model.shouldCoverContent
        overlay.windowLevel = .alert + 1
        let host = UIHostingController(rootView: JarvisGateOverlayView(model: model))
        host.view.backgroundColor = .clear
        overlay.rootViewController = host
        overlay.isHidden = false
        window = overlay
    }
}

/// The cold-start opening screen's life: shown, fading out over Home, then gone for the rest of the process.
private enum JarvisOpeningState: Equatable {
    case visible, fading, finished
}

@MainActor
private final class JarvisGateModel: ObservableObject {
    @Published private(set) var presentation: JarvisGatePresentation = .loading {
        didSet { updateOpening() }
    }
    @Published private(set) var openingState: JarvisOpeningState
    @Published private(set) var openingProgress: JarvisOpeningProgress = .indeterminate
    @Published private(set) var contentEpoch = 0
    @Published private(set) var signOutGeneration = 0
    @Published private(set) var watchRevocationNotice: String?
    @Published private var isPrivacyCoverVisible = true

    private let policy = JarvisGatePolicy()
    private let tokenStore: KeychainTokenStore?
    private let provider: MicrosoftAccessTokenProvider?
    private let client: JarvisClient?
    private let overlay = JarvisGateOverlay()
    private var backgroundedAt: Date?
    private var isSigningOut = false
    private var homeIsReady = false
    private var unlockedAt: Date?
    private var openingCap: Task<Void, Never>?

    private static var isNavigationFixture: Bool {
#if targetEnvironment(simulator)
        ProcessInfo.processInfo.arguments.contains("--ui-test-navigation")
#else
        false
#endif
    }

    private static var launchesFixture: Bool {
#if targetEnvironment(simulator)
        ProcessInfo.processInfo.arguments.contains { $0.hasPrefix("--screenshot-") || $0.hasPrefix("--ui-test") }
#else
        false
#endif
    }

    /// Debug simulator only: keeps the opening on screen so it can be inspected and captured.
    private static var holdsOpeningForPreview: Bool {
#if DEBUG && targetEnvironment(simulator)
        ProcessInfo.processInfo.arguments.contains("--opening-preview")
#else
        false
#endif
    }

    var shouldCoverContent: Bool {
        presentation != .unlocked || isPrivacyCoverVisible
    }

    /// The overlay window stays up while the opening fades, even once Home no longer needs covering.
    var isOverlayVisible: Bool {
        shouldCoverContent || openingState != .finished
    }

    /// True while the app is inactive or in the background: decorative motion holds still.
    var isRenderingPaused: Bool {
        isPrivacyCoverVisible
    }

    init() {
        // The opening shows on every cold start (this model lives for the whole process) unless it is switched off.
        openingState = JarvisOpening.isEnabled && (!Self.launchesFixture || Self.holdsOpeningForPreview) ? .visible : .finished
        if Self.holdsOpeningForPreview,
           let value = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--opening-progress=") }),
           let fraction = Double(value.dropFirst("--opening-progress=".count)) {
            openingProgress = .measured(fraction)
        }
        if Self.isNavigationFixture {
            tokenStore = nil
            provider = nil
            client = nil
            presentation = .unlocked
            isPrivacyCoverVisible = false
            return
        }
        tokenStore = try? KeychainTokenStore()
        if let provider = try? MicrosoftAccessTokenProvider(),
           let client = try? JarvisComposition.makeClient(accessTokenProvider: provider) {
            self.provider = provider
            self.client = client
            JarvisFactoryLiveActivityController.configure(client: client)
            let notificationClient = try? JarvisComposition.makeClient(
                accessTokenProvider: provider,
                requestTimeout: JarvisApprovalNotificationCoordinator.requestTimeout
            )
            JarvisApprovalNotificationCoordinator.shared.configure(client: notificationClient ?? client)
            JarvisWidgetSnapshotPublisher.shared.configure(client: client)
            JarvisWatchBridge.shared.configure(client: client)
            provider.onSignInRequired = { [weak self] in
                self?.clientRequestedSignIn()
            }
        } else {
            provider = nil
            client = nil
        }
    }

    func load() async {
        guard case .loading = presentation else { return }
#if targetEnvironment(simulator)
        // Simulator captures only: show a gate state without signing in.
        if let state = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--screenshot-gate=") }) {
            switch state.dropFirst("--screenshot-gate=".count) {
            case "lock-failed": presentation = .lock(.failed)
            case "lock-waiting": presentation = .lock(.waiting)
            case "sign-in": presentation = .signIn(.idle)
            default: break
            }
            if presentation != .loading { return }
        }
#endif
        if ProcessInfo.processInfo.arguments.contains("--screenshot-chat-fixture") ||
            ProcessInfo.processInfo.arguments.contains("--screenshot-health-fixture") ||
            ProcessInfo.processInfo.arguments.contains("--screenshot-settings-fixture") ||
            ProcessInfo.processInfo.arguments.contains("--screenshot-voice-connection-lost") {
            presentation = .unlocked
            isPrivacyCoverVisible = false
            return
        }
        if ProcessInfo.processInfo.arguments.contains("--screenshot-lockscreen-task-fixture") {
            presentation = .unlocked
            isPrivacyCoverVisible = false
            return
        }
        guard let tokenStore else {
            presentation = .signIn(.failed)
            return
        }

        do {
            let token = try await tokenStore.read()
            let isLocked = policy.shouldLock(lastBackgroundedAt: nil, now: Date(), isColdStart: true)
            switch policy.decision(
                tokenPresent: token.map { !$0.isEmpty } ?? false,
                isLocked: isLocked
            ) {
            case .locked:
                presentation = .lock(.waiting)
                await authenticate()
            case .denied:
                presentation = .signIn(.denied)
            case .signIn:
                presentation = .signIn(.idle)
            case .unlocked:
                presentation = .unlocked
                await prepareApprovalNotifications()
                await JarvisApprovalNotificationCoordinator.shared.refresh(language: .current)
            }
        } catch {
            presentation = .signIn(.failed)
        }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .inactive:
            isPrivacyCoverVisible = true
        case .background:
            backgroundedAt = Date()
            isPrivacyCoverVisible = true
            JarvisTaskActivityBackgroundRefresh.shared.schedule()
        case .active:
            if !Self.isNavigationFixture {
                CarScheduleActivityAttributes.clearActivities(expiredOnly: true)
                Task { await JarvisWatchBridge.shared.refreshDictationCredential() }
            }
            let requiresLock = policy.shouldLock(lastBackgroundedAt: backgroundedAt, now: Date())
            backgroundedAt = nil
            if requiresLock, presentation == .unlocked {
                presentation = .lock(.waiting)
                Task { await authenticate() }
            } else {
                isPrivacyCoverVisible = false
                if presentation == .unlocked, !Self.isNavigationFixture {
                    Task {
                        await JarvisApprovalNotificationCoordinator.shared.refresh(language: .current)
                    }
                    Task { await JarvisWidgetSnapshotPublisher.shared.refresh() }
                }
            }
        @unknown default:
            isPrivacyCoverVisible = true
        }
        refreshOverlay()
    }

    func refreshOverlay() {
        overlay.update(visible: isOverlayVisible, model: self)
    }

    // MARK: Opening screen

    /// Called once the first fresh Home data has loaded (or failed visibly); never by a timer.
    func homeDataReady() {
        homeIsReady = true
        updateOpening()
    }

    private var openingStage: JarvisOpeningPolicy.Stage {
        switch presentation {
        case .loading: .resolving
        case .lock(.waiting): .authenticating
        case .unlocked: .unlocked
        default: .needsAttention
        }
    }

    private func updateOpening() {
        guard openingState == .visible, !Self.holdsOpeningForPreview else { return }
        if presentation == .unlocked, unlockedAt == nil {
            unlockedAt = Date()
            openingCap = Task { [weak self] in
                try? await Task.sleep(for: .seconds(JarvisOpeningPolicy.dataWait))
                self?.updateOpening()
            }
        }
        let stillVisible = JarvisOpeningPolicy.isVisible(
            enabled: true, coldStart: true, stage: openingStage, dataReady: homeIsReady,
            unlockedFor: unlockedAt.map { Date().timeIntervalSince($0) } ?? 0
        )
        if !stillVisible { finishOpening() }
    }

    /// Crossfades the opening into whatever is underneath (Home, or the gate's own screen), then removes it.
    /// Reduce Motion shortens the fade. It only ever moves forward, so repeated lifecycle events cannot restart it.
    private func finishOpening() {
        openingCap?.cancel()
        let duration = UIAccessibility.isReduceMotionEnabled
            ? JarvisDesignTokens.openingReducedFadeDuration : JarvisDesignTokens.openingFadeDuration
        withAnimation(.easeOut(duration: duration)) { openingState = .fading }
        refreshOverlay()
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(duration + 0.05))
            self?.openingState = .finished
            self?.refreshOverlay()
        }
    }

    func signIn() async {
        guard !isSigningOut, presentation != .signIn(.signingIn) else { return }
        presentation = .signIn(.signingIn)
        guard let client else {
            presentation = .signIn(.failed)
            return
        }

        do {
            _ = try await client.createOwnerSession()
            watchRevocationNotice = nil
            JarvisWatchBridge.shared.configure(client: client)
            await JarvisAppCache.clear()
            JarvisComposition.setAccountAccessSuspended(false)
            contentEpoch += 1
            presentation = .lock(.waiting)
            await authenticate()
        } catch {
            presentation = .signIn(JarvisSignInState.recovering(from: error))
        }
    }

    func beginSignIn() {
        presentation = .signIn(.idle)
    }

    func signOut() async {
        guard !Self.isNavigationFixture, !isSigningOut else { return }
        isSigningOut = true
        JarvisComposition.setAccountAccessSuspended(true)
        defer { isSigningOut = false }
        presentation = .loading
        refreshOverlay()
        let watchRevoked = await JarvisWatchBridge.shared.disconnect()
        if let sessionID = VoiceLiveActivityActions.session?.liveActivitySessionID {
            try? await VoiceLiveActivityActions.perform(sessionID: sessionID, command: .end)
        }
        await JarvisApprovalNotificationCoordinator.shared.unregisterDeviceToken()
        do {
            try await tokenStore?.delete()
            try provider?.signOut()
            await JarvisAppCache.clear()
            contentEpoch += 1
            signOutGeneration += 1
            watchRevocationNotice = watchRevoked ? nil :
                "Signed out on this iPhone. Watch revocation could not be confirmed; existing credentials expire within 24 hours. Sign in when online, then sign out again to retry."
            presentation = .signIn(.idle)
        } catch {
            presentation = .signIn(.denied)
        }
    }

    func sessionRevoked() {
        Task { await signOut() }
    }

    func retryUnlock() async {
        await authenticate()
    }

    func usePasscode() async {
        await authenticate(usingPasscode: true)
    }

    func performPrimaryAction() {
        switch presentation {
        case .signIn(.denied):
            Task { await signOut() }
        case .signIn:
            Task { await signIn() }
        case .lock(.failed):
            Task { await retryUnlock() }
        case .lock(.passcode):
            Task { await usePasscode() }
        case .lock(.signedOut):
            beginSignIn()
        case .loading, .unlocked, .lock(.waiting):
            break
        }
    }

    func clientRequestedSignIn() {
        guard !Self.isNavigationFixture else { return }
        switch presentation {
        case .unlocked, .lock:
            sessionExpired()
        case .loading, .signIn:
            break
        }
    }

    private func sessionExpired() {
        let decision = policy.decision(
            tokenPresent: true,
            tokenExpired: true,
            isLocked: true
        )
        if decision == .signIn {
            JarvisComposition.setAccountAccessSuspended(true)
            presentation = .lock(.signedOut)
            Task { await JarvisWatchBridge.shared.disconnect() }
        }
    }

    private func authenticate(usingPasscode: Bool = false) async {
        guard case .lock = presentation else { return }

        let context = LAContext()
        var availabilityError: NSError?
        let biometricPolicy: LAPolicy = usingPasscode
            ? .deviceOwnerAuthentication
            : .deviceOwnerAuthenticationWithBiometrics
        guard context.canEvaluatePolicy(biometricPolicy, error: &availabilityError) else {
            presentation = .lock(usingPasscode ? .failed : .passcode)
            return
        }

        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                context.evaluatePolicy(
                    biometricPolicy,
                    localizedReason: JarvisAppLanguage.current.faceIDReason
                ) { success, error in
                    if success {
                        continuation.resume()
                    } else {
                        continuation.resume(throwing: error ?? LAError(.authenticationFailed))
                    }
                }
            }
            presentation = .unlocked
            isPrivacyCoverVisible = false
            if let client { JarvisWatchBridge.shared.configure(client: client) }
            await prepareApprovalNotifications()
            await JarvisApprovalNotificationCoordinator.shared.refresh(language: .current)
        } catch let error as LAError where error.code == .biometryLockout || error.code == .userFallback {
            presentation = .lock(.passcode)
        } catch {
            presentation = .lock(.failed)
        }
    }

    private func prepareApprovalNotifications() async {
        let coordinator = JarvisApprovalNotificationCoordinator.shared
        guard await coordinator.requestAuthorizationIfNeeded() else { return }
        await coordinator.registerForRemoteNotificationsIfAuthorized()
    }
}

struct JarvisGateRootView: View {
    /// Plain opening colour over the first frames; see the overlay in `body`.
    @ViewBuilder
    private var openingColourCover: some View {
        if model.openingState == .visible {
            JarvisDesignTokens.openingBackground
                .ignoresSafeArea()
                .accessibilityHidden(true)
        }
    }

    /// Home reports its first fresh data through this, on a cold start only.
    private var coldStartCallback: (@MainActor () -> Void)? {
        guard model.openingState == .visible else { return nil }
        return { [model] in model.homeDataReady() }
    }

    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("jarvis.appTheme") private var storedTheme = "system"
    @StateObject private var model = JarvisGateModel()
    @StateObject private var navigation = JarvisNavigationModel(
        initialState: ContentView.initialNavigation(),
        dismissKeyboard: {
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
            )
        }
    )

    var body: some View {
        JarvisSidebarReveal(isEnabled: !model.shouldCoverContent) {
            Group {
                if ProcessInfo.processInfo.arguments.contains("--screenshot-lockscreen-task-fixture") {
                    JarvisLockScreenTasksPreview(
                        language: .default
                    )
                } else {
                    ContentView(
                        sessionEpoch: model.contentEpoch,
                        onColdStartData: coldStartCallback
                    )
                }
            }
            // Only sign-out discards the shell; sign-in resets session content explicitly.
            .id(model.signOutGeneration)
            // Backgrounds under the gate hold still: nobody can see them.
            .environment(\.jarvisBackgroundPaused, model.shouldCoverContent)
            // Gating applies to the page only; the root drawer and edge strip stay outside it.
            .blur(radius: model.shouldCoverContent ? JarvisDesignTokens.gateBackgroundBlurRadius : 0)
            .allowsHitTesting(!model.shouldCoverContent)
            .accessibilityElement(children: .contain)
            .accessibilityHidden(model.shouldCoverContent)
        }
        .environmentObject(navigation)
        // The first frames after the static launch screen show the opening's own colour, never a flash of Home.
        .overlay { openingColourCover }
        // The drawer sits outside ContentView, so the stored theme must be applied at the root as well.
        .preferredColorScheme(storedTheme == "light" ? .light : storedTheme == "dark" ? .dark : nil)
        .task {
            model.refreshOverlay()
            await model.load()
            model.refreshOverlay()
        }
        .onChange(of: model.signOutGeneration) { _, _ in
            navigation.reset()
        }
        .onChange(of: model.shouldCoverContent) { _, covered in
            if covered { navigation.closeSidebar() }
            model.refreshOverlay()
        }
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
        }
        .onReceive(NotificationCenter.default.publisher(for: .jarvisSignInRequired).receive(on: DispatchQueue.main)) { _ in
            model.clientRequestedSignIn()
        }
        .onReceive(NotificationCenter.default.publisher(for: .jarvisSessionRevoked).receive(on: DispatchQueue.main)) { _ in
            model.sessionRevoked()
        }
    }
}

private struct JarvisGateOverlayView: View {
    @ObservedObject var model: JarvisGateModel

    private var language: JarvisAppLanguage {
        .default
    }

    var body: some View {
        ZStack {
            base
            if model.openingState != .finished {
                JarvisOpeningView(
                    progress: model.openingProgress,
                    isPaused: model.isRenderingPaused,
                    isFinishing: model.openingState == .fading
                )
                .opacity(model.openingState == .visible ? 1 : 0)
            }
        }
        .accessibilityAddTraits(.isModal)
        // This window is hosted outside the app's scene, so SwiftUI never reports the scene's phase to it and the
        // orb and background would never run. Report the gate's own view of it instead.
        .environment(\.scenePhase, model.isRenderingPaused ? .inactive : .active)
    }

    /// What lies under the opening. While the opening is visible it is a plain colour, so only one orb is drawn;
    /// as the opening fades it is the real screen: the gate's own state, or Home itself, uncovered.
    @ViewBuilder
    private var base: some View {
        if model.openingState == .visible {
            JarvisDesignTokens.openingBackground
                .ignoresSafeArea()
                .accessibilityHidden(true)
        } else if model.presentation != .unlocked {
            JarvisGateSurface(
                presentation: model.presentation,
                language: language,
                watchRevocationNotice: model.watchRevocationNotice,
                isPaused: model.isRenderingPaused,
                onPrimaryAction: model.performPrimaryAction
            )
        } else if model.shouldCoverContent {
            // The privacy cover: the same background, still.
            JarvisScreenBackground()
        } else {
            Color.clear
        }
    }
}

private struct JarvisGateSurface: View {
    let presentation: JarvisGatePresentation
    let language: JarvisAppLanguage
    let watchRevocationNotice: String?
    var isPaused = false
    let onPrimaryAction: () -> Void

    /// The orb's frame on screen: the living background fans out from it in every gate state.
    @State private var orbFrame: CGRect = .zero

    private var isSignIn: Bool {
        if case .signIn = presentation { return true }
        return false
    }

    private var orbActivity: JarvisOrbActivity {
        if presentation == .signIn(.signingIn) { return .signingIn }
        if presentation == .loading { return .calm }
        return .idle
    }

    private var message: String? {
        if presentation == .signIn(.idle), let watchRevocationNotice { return watchRevocationNotice }
        switch presentation {
        case .signIn(.failed): return language.failed
        case .signIn(.denied): return language.denied
        case .signIn(.offline): return language.offline
        case .lock(.failed): return language.faceIDFailed
        case .lock(.signedOut): return language.signedOut
        default: return nil
        }
    }

    private var buttonTitle: String? {
        switch presentation {
        case .signIn(.idle): language.signIn
        case .signIn(.signingIn): language.signingIn
        case .signIn(.failed), .signIn(.offline), .lock(.failed): language.retry
        case .signIn(.denied): language.signOut
        case .lock(.passcode): language.usePasscode
        case .lock(.signedOut): language.signIn
        case .loading, .unlocked, .lock(.waiting): nil
        }
    }

    private var isSigningIn: Bool {
        presentation == .signIn(.signingIn)
    }

    private var isLocked: Bool {
        if case .lock(let state) = presentation { return state != .signedOut }
        return false
    }

    private var orb: some View {
        JarvisOrb(activity: orbActivity, isPaused: isPaused)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { orbFrame = $0 }
    }

    var body: some View {
        ZStack {
            // One background for every gate state, so a failed Face ID crossfades like the others.
            JarvisNeuralBackground(
                activity: orbActivity == .idle ? .calm : orbActivity, effects: .full, orb: .screen(orbFrame), isPaused: isPaused
            )

            if isSignIn {
                GeometryReader { geometry in
                    orb
                        .position(
                            x: geometry.size.width / 2,
                            y: JarvisDesignTokens.gateOrbCenterTop
                        )

                    Text("Jarvis")
                        .font(.system(size: 40, weight: .bold))
                        .tracking(-1.2)
                        .foregroundStyle(.primary)
                        .position(
                            x: geometry.size.width / 2,
                            y: geometry.safeAreaInsets.top
                                + JarvisDesignTokens.gateSignInTitleTop
                                + JarvisDesignTokens.gateSignInTitleHeight / 2
                        )

                    VStack(spacing: JarvisDesignTokens.gateControlSpacing / 2) {
                        gateMessage
                        primaryActionButton
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, JarvisDesignTokens.gateSignInHorizontalInset)
                    .padding(.bottom, JarvisDesignTokens.gateSignInBottomInset)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                }
                .transition(.opacity)
            } else {
                VStack(spacing: JarvisDesignTokens.gateControlSpacing) {
                    Spacer(minLength: JarvisDesignTokens.gateControlSpacing)
                    orb

                    if isLocked {
                        Image(systemName: "faceid")
                            .font(.system(size: JarvisDesignTokens.gateFaceIDSymbolSize, weight: .regular))
                            .foregroundStyle(.primary)
                            .accessibilityLabel(language.faceIDLabel)
                    }

                    gateMessage
                    Spacer(minLength: JarvisDesignTokens.gateControlSpacing)
                    primaryActionButton
                }
                .padding(.horizontal, JarvisDesignTokens.gateContentInset)
                .padding(.bottom, JarvisDesignTokens.gateContentInset)
                .transition(.opacity)
            }
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: JarvisDesignTokens.gateStateFadeDuration), value: presentation)
    }

    @ViewBuilder
    private var gateMessage: some View {
        if let message {
            Text(message)
                .font(.body)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var primaryActionButton: some View {
        if let buttonTitle {
            JarvisLabelledButton(
                title: buttonTitle,
                systemImage: presentation == .lock(.signedOut) ? "person.crop.circle" : nil,
                leading: presentation == .signIn(.idle) ? AnyView(JarvisMicrosoftMark()) : nil,
                isBusy: isSigningIn,
                isFullWidth: true,
                action: onPrimaryAction
            )
            .transition(.opacity)
        }
    }
}

private struct JarvisMicrosoftMark: View {
    var body: some View {
        HStack(spacing: 2) {
            VStack(spacing: 2) {
                square(Color(red: 242.0 / 255, green: 80.0 / 255, blue: 34.0 / 255))
                square(Color(red: 0, green: 164.0 / 255, blue: 239.0 / 255))
            }
            VStack(spacing: 2) {
                square(Color(red: 127.0 / 255, green: 186.0 / 255, blue: 0))
                square(Color(red: 1, green: 185.0 / 255, blue: 0))
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }

    private func square(_ color: Color) -> some View {
        Rectangle()
            .fill(color)
            .frame(width: 9, height: 9)
    }
}
