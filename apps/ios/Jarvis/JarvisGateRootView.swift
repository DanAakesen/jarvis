import JarvisCore
import LocalAuthentication
import SwiftUI

private enum JarvisSignInState: Equatable {
    case idle
    case signingIn
    case failed
    case denied
    case offline
}

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

@MainActor
private final class JarvisGateModel: ObservableObject {
    @Published private(set) var presentation: JarvisGatePresentation = .loading
    @Published private var isPrivacyCoverVisible = true

    private let policy = JarvisGatePolicy()
    private let tokenStore: KeychainTokenStore?
    private let provider: MicrosoftAccessTokenProvider?
    private let client: JarvisClient?
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
                self?.sessionExpired()
            }
        } else {
            provider = nil
            client = nil
        }
    }

    func load() async {
        guard case .loading = presentation else { return }
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
            presentation = .lock(.waiting)
            await authenticate()
        } catch is CancellationError {
            presentation = .signIn(.idle)
        } catch let error as JarvisClientError {
            switch error {
            case .notOwner:
                presentation = .signIn(.denied)
            case .networkFailure, .timedOut, .serviceUnavailable:
                presentation = .signIn(.offline)
            default:
                presentation = .signIn(.failed)
            }
        } catch {
            presentation = .signIn(.failed)
        }
    }

    func beginSignIn() {
        presentation = .signIn(.idle)
    }

    func signOut() async {
        do {
            try await tokenStore?.delete()
            try provider?.signOut()
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
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @StateObject private var model = JarvisGateModel()

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    var body: some View {
        ZStack {
            ContentView()
                .blur(radius: model.shouldCoverContent ? JarvisDesignTokens.gateBackgroundBlurRadius : 0)
                .allowsHitTesting(!model.shouldCoverContent)
                .accessibilityHidden(model.shouldCoverContent)

            if model.presentation != .unlocked {
                JarvisGateSurface(
                    presentation: model.presentation,
                    language: language,
                    onPrimaryAction: primaryAction
                )
                .transition(.opacity)
            } else if model.shouldCoverContent {
                Color(uiColor: .systemBackground)
                    .ignoresSafeArea()
                    .accessibilityHidden(true)
            }
        }
        .task { await model.load() }
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
        }
    }

    private func primaryAction() {
        switch model.presentation {
        case .signIn(.denied):
            Task { await model.signOut() }
        case .signIn:
            Task { await model.signIn() }
        case .lock(.failed):
            Task { await model.retryUnlock() }
        case .lock(.passcode):
            Task { await model.usePasscode() }
        case .lock(.signedOut):
            model.beginSignIn()
        case .loading, .unlocked, .lock(.waiting):
            break
        }
    }
}

private struct JarvisGateSurface: View {
    let presentation: JarvisGatePresentation
    let language: JarvisAppLanguage
    let onPrimaryAction: () -> Void

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
            Rectangle().fill(.regularMaterial)
            Color(uiColor: .systemBackground).opacity(JarvisDesignTokens.gateBackgroundOpacity)

            VStack(spacing: JarvisDesignTokens.gateControlSpacing) {
                Spacer(minLength: JarvisDesignTokens.gateControlSpacing)
                JarvisOrbView(activity: orbActivity)

                if isLocked {
                    Image(systemName: "faceid")
                        .font(.system(size: JarvisDesignTokens.gateFaceIDSymbolSize, weight: .regular))
                        .foregroundStyle(.primary)
                        .accessibilityLabel(language.faceIDLabel)
                }

                if let message {
                    Text(message)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.center)
                }

                Spacer(minLength: JarvisDesignTokens.gateControlSpacing)

                if let buttonTitle {
                    Button(action: onPrimaryAction) {
                        HStack(spacing: JarvisDesignTokens.gateControlSpacing / 2) {
                            if isSigningIn {
                                ProgressView()
                                    .tint(.white)
                                    .accessibilityHidden(true)
                            } else if presentation == .signIn(.idle) || presentation == .lock(.signedOut) {
                                Image(systemName: "person.crop.circle")
                                    .accessibilityHidden(true)
                            }
                            Text(buttonTitle)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(isSigningIn)
                }
            }
            .padding(.horizontal, JarvisDesignTokens.gateContentInset)
            .padding(.bottom, JarvisDesignTokens.gateContentInset)
        }
        .ignoresSafeArea()
    }
}
