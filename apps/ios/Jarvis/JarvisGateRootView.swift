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
        JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
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
            window?.isHidden = true
            window = nil
            return
        }
        if let window {
            window.isPrivacyCover = model.presentation == .unlocked
            return
        }
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            return
        }

        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        let overlay = JarvisGateOverlayWindow(windowScene: scene)
        overlay.isPrivacyCover = model.presentation == .unlocked
        overlay.windowLevel = .alert + 1
        let host = UIHostingController(rootView: JarvisGateOverlayView(model: model))
        host.view.backgroundColor = .clear
        overlay.rootViewController = host
        overlay.isHidden = false
        window = overlay
    }
}

@MainActor
private final class JarvisGateModel: ObservableObject {
    @Published private(set) var presentation: JarvisGatePresentation = .loading
    @Published private(set) var contentEpoch = 0
    @Published private var isPrivacyCoverVisible = true

    private let policy = JarvisGatePolicy()
    private let tokenStore: KeychainTokenStore?
    private let provider: MicrosoftAccessTokenProvider?
    private let client: JarvisClient?
    private let overlay = JarvisGateOverlay()
    private var backgroundedAt: Date?

    var shouldCoverContent: Bool {
        presentation != .unlocked || isPrivacyCoverVisible
    }

    init() {
        tokenStore = try? KeychainTokenStore()
        if let provider = try? MicrosoftAccessTokenProvider(),
           let client = try? JarvisComposition.makeClient(accessTokenProvider: provider) {
            self.provider = provider
            self.client = client
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
        if ProcessInfo.processInfo.arguments.contains("--screenshot-chat-fixture") ||
            ProcessInfo.processInfo.arguments.contains("--screenshot-health-fixture") ||
            ProcessInfo.processInfo.arguments.contains("--screenshot-settings-fixture") {
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
        case .active:
            let requiresLock = policy.shouldLock(lastBackgroundedAt: backgroundedAt, now: Date())
            backgroundedAt = nil
            if requiresLock, presentation == .unlocked {
                presentation = .lock(.waiting)
                Task { await authenticate() }
            } else {
                isPrivacyCoverVisible = false
            }
        @unknown default:
            isPrivacyCoverVisible = true
        }
        refreshOverlay()
    }

    func refreshOverlay() {
        overlay.update(visible: shouldCoverContent, model: self)
    }

    func signIn() async {
        guard presentation != .signIn(.signingIn) else { return }
        presentation = .signIn(.signingIn)
        guard let client else {
            presentation = .signIn(.failed)
            return
        }

        do {
            _ = try await client.createOwnerSession()
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
        if let sessionID = VoiceLiveActivityActions.session?.liveActivitySessionID {
            try? await VoiceLiveActivityActions.perform(sessionID: sessionID, command: .end)
        }
        do {
            try await tokenStore?.delete()
            try provider?.signOut()
            contentEpoch += 1
            presentation = .signIn(.idle)
        } catch {
            presentation = .signIn(.denied)
        }
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
            presentation = .lock(.signedOut)
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
        } catch let error as LAError where error.code == .biometryLockout || error.code == .userFallback {
            presentation = .lock(.passcode)
        } catch {
            presentation = .lock(.failed)
        }
    }
}

struct JarvisGateRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = JarvisGateModel()

    var body: some View {
        ContentView()
            .id(model.contentEpoch)
            .blur(radius: model.shouldCoverContent ? JarvisDesignTokens.gateBackgroundBlurRadius : 0)
            .allowsHitTesting(!model.shouldCoverContent)
            .accessibilityHidden(model.shouldCoverContent)
            .task {
                model.refreshOverlay()
                await model.load()
            }
            .onChange(of: model.shouldCoverContent) { _, _ in
                model.refreshOverlay()
            }
            .onChange(of: scenePhase) { _, phase in
                model.scenePhaseChanged(phase)
            }
            .onReceive(NotificationCenter.default.publisher(for: .jarvisSignInRequired).receive(on: DispatchQueue.main)) { _ in
                model.clientRequestedSignIn()
            }
            .onReceive(NotificationCenter.default.publisher(for: .jarvisSessionRevoked).receive(on: DispatchQueue.main)) { _ in
                Task { await model.signOut() }
            }
    }
}

private struct JarvisGateOverlayView: View {
    @ObservedObject var model: JarvisGateModel
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    var body: some View {
        Group {
            if model.presentation != .unlocked {
                JarvisGateSurface(
                    presentation: model.presentation,
                    language: language,
                    onPrimaryAction: model.performPrimaryAction
                )
            } else {
                JarvisDesignTokens.pageBackground
                    .ignoresSafeArea()
                    .accessibilityHidden(true)
            }
        }
        .accessibilityAddTraits(.isModal)
    }
}

private struct JarvisGateSurface: View {
    let presentation: JarvisGatePresentation
    let language: JarvisAppLanguage
    let onPrimaryAction: () -> Void

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
        switch presentation {
        case .signIn(.failed): language.failed
        case .signIn(.denied): language.denied
        case .signIn(.offline): language.offline
        case .lock(.failed): language.faceIDFailed
        case .lock(.signedOut): language.signedOut
        default: nil
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

    var body: some View {
        ZStack {
            if isSignIn {
                JarvisGateAmbientBackground()
            } else {
                Rectangle().fill(.regularMaterial)
                JarvisDesignTokens.pageBackground.opacity(JarvisDesignTokens.gateBackgroundOpacity)
            }

            if isSignIn {
                GeometryReader { geometry in
                    JarvisOrbView(activity: orbActivity)
                        .accessibilityHidden(true)
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
            } else {
                VStack(spacing: JarvisDesignTokens.gateControlSpacing) {
                    Spacer(minLength: JarvisDesignTokens.gateControlSpacing)
                    JarvisOrbView(activity: orbActivity)
                        .accessibilityHidden(true)

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
            }
        }
        .ignoresSafeArea()
    }

    @ViewBuilder
    private var gateMessage: some View {
        if let message {
            Text(message)
                .font(.body)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
        }
    }

    @ViewBuilder
    private var primaryActionButton: some View {
        if let buttonTitle {
            Button(action: onPrimaryAction) {
                HStack(spacing: JarvisDesignTokens.gateControlSpacing / 2) {
                    if isSigningIn {
                        ProgressView()
                            .tint(JarvisDesignTokens.gateActionForeground)
                            .accessibilityHidden(true)
                    } else if presentation == .signIn(.idle) {
                        JarvisMicrosoftMark()
                    } else if presentation == .lock(.signedOut) {
                        Image(systemName: "person.crop.circle")
                            .accessibilityHidden(true)
                    }
                    Text(buttonTitle)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(JarvisGateButtonStyle())
            .disabled(isSigningIn)
        }
    }
}

private struct JarvisGateAmbientBackground: View {
    var body: some View {
        JarvisScreenBackground()
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

private struct JarvisGateButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(JarvisDesignTokens.gateActionAccent)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(.regularMaterial, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.86 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
