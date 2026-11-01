import Combine
import Foundation
import JarvisCore
import UIKit

@MainActor
final class VoiceScreenModel: ObservableObject, VoiceLiveActivityControlling {
    @Published private(set) var voiceState: VoiceSessionState = .idle
    @Published private(set) var connectionPresentationState: VoiceConnectionPresentationState = .connected
    @Published private(set) var microphoneDenied = false
    @Published private(set) var signInRequired = false
    @Published private(set) var isAudioReady = false
    @Published private(set) var isMuted = false
    @Published private(set) var isCaptionsEnabled = false
    @Published private(set) var isMinimized = false
    @Published private(set) var isCameraEnabled = false
    @Published private(set) var cameraPermissionDenied = false
    @Published private(set) var isScreenSharing = false
    @Published private(set) var userCaption = ""
    @Published private(set) var assistantCaption = ""
    @Published private(set) var errorMessage: String?
    @Published private(set) var camera: VoiceCameraCapture?
    @Published private(set) var photoIsReady = false

    private let screenshotConnectionLost: Bool
    private var audio = VoiceAudioEngine()
    private let liveActivity = VoiceLiveActivityController()
    private(set) var liveActivitySessionID: UUID?
    private let screenShareBridge = VoiceScreenShareBridge()
    private var captureTask: Task<Void, Never>?
    private var screenShareMonitorTask: Task<Void, Never>?
    private var sessionClient: VoiceSessionClient?
    private var httpClient: JarvisClient?
    private var voiceSessionID: String?
    private var responseID: String?
    private var photoForNextTurn: Data?
    private var sessionGeneration = 0
    private var isStarting = false
    private var connectionPresentationMachine = VoiceConnectionPresentationStateMachine()
    private var isEnding = false
    private var screenshotState: VoiceSessionState?

    init(screenshotConnectionLost: Bool = false) {
        self.screenshotConnectionLost = screenshotConnectionLost
        if screenshotConnectionLost {
            connectionPresentationState = connectionPresentationMachine.apply(.connectionDropped)
            voiceState = .reconnecting(attempt: 3)
        }
#if targetEnvironment(simulator)
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--screenshot-voice-fixture"),
           let state = arguments.first(where: { $0.hasPrefix("--screenshot-voice-state=") })?
            .split(separator: "=").last {
            switch state {
            case "listening": voiceState = .listening
            case "thinking": voiceState = .ready
            case "speaking": voiceState = .speaking
            default: break
            }
            screenshotState = voiceState
            isAudioReady = true
            errorMessage = JarvisVoiceLocalization.string(.preview)
        }
#endif
    }

    #if targetEnvironment(simulator)
    func startActivityScreenshot() async {
        guard sessionClient == nil else { return }
        let arguments = ProcessInfo.processInfo.arguments
        let language = arguments.contains("--voice-activity-language=en") ? JarvisAppLanguage.en : .da
        let phase = arguments.contains("--voice-activity-state=speaking") ? VoiceSessionState.speaking : .listening
        let sessionID = UUID()
        liveActivitySessionID = sessionID
        VoiceLiveActivityActions.session = self
        sessionClient = VoiceSessionClient(
            baseURL: URL(string: "https://fixture.example.invalid")!,
            transport: VoiceActivityScreenshotSocket()
        )
        do {
            try await sessionClient?.start(accessToken: "fixture.voice", language: .da)
            voiceState = phase
            isAudioReady = true
            try liveActivity.start(
                sessionID: sessionID, language: language,
                startedAt: Date().addingTimeInterval(-724),
                waveform: (0..<VoiceWaveform.sampleCount).map { Double(($0 * 7) % 13 + 1) / 14 }
            )
            if arguments.contains("--voice-activity-state=muted") {
                try await setMuted(true)
            } else {
                liveActivity.update(state: voiceState, isMuted: false)
            }
        } catch {
            errorMessage = VoiceLiveActivityCopy.updateFailed.text(language: language)
        }
    }
    #endif

    var skipsAutomaticStart: Bool {
        screenshotConnectionLost
    }

    var showsConnectionRecovery: Bool {
        connectionPresentationState == .lost || connectionPresentationState == .retrying
    }

    var statusText: String {
        if case .reconnecting = voiceState { return JarvisVoiceLocalization.string(.reconnecting) }
        if voiceState == .failed || microphoneDenied { return JarvisVoiceLocalization.string(.offline) }
        if isMuted { return JarvisVoiceLocalization.string(.muted) }
        if !isAudioReady && voiceState == .listening { return JarvisVoiceLocalization.string(.connecting) }
        switch voiceState {
        case .idle, .connecting:
            return JarvisVoiceLocalization.string(.connecting)
        case .ready:
            return JarvisVoiceLocalization.string(.thinking)
        case .listening:
            return JarvisVoiceLocalization.string(.listening)
        case .speaking:
            return JarvisVoiceLocalization.string(.speaking)
        case .reconnecting:
            return JarvisVoiceLocalization.string(.reconnecting)
        case .ended, .failed:
            return JarvisVoiceLocalization.string(.offline)
        }
    }

    var isSessionActive: Bool {
        switch voiceState {
        case .connecting, .ready, .listening, .speaking, .reconnecting:
            return true
        case .idle, .ended, .failed:
            return false
        }
    }

    var canUseControls: Bool {
        isSessionActive && !microphoneDenied && !isEnding && screenshotState == nil
    }

    var isPreview: Bool { screenshotState != nil }

    func start() async {
#if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--ui-test-navigation") {
            guard sessionClient == nil else { return }
            let client = VoiceSessionClient(
                baseURL: URL(string: "https://fixture.example.invalid")!,
                transport: VoiceActivityScreenshotSocket()
            )
            sessionClient = client
            do {
                try await client.start(accessToken: "fixture.voice", language: .da)
                voiceState = .listening
                isAudioReady = true
            } catch {
                sessionClient = nil
                voiceState = .failed
                errorMessage = Self.message(for: error)
            }
            return
        }
#endif
        if let screenshotState {
            voiceState = screenshotState
            isAudioReady = true
            return
        }
        guard !isStarting, !isEnding, sessionClient == nil else { return }
        sessionGeneration += 1
        let generation = sessionGeneration
        isStarting = true
        defer {
            if sessionGeneration == generation { isStarting = false }
        }
        liveActivitySessionID = UUID()
        VoiceLiveActivityActions.session = self
        errorMessage = nil
        microphoneDenied = false
        signInRequired = false
        voiceState = .connecting
        do {
            let tokenStore = try KeychainTokenStore()
            guard let token = try await tokenStore.read() else {
                throw JarvisClientError.signInRequired
            }
            guard sessionGeneration == generation else { return }
            try Task.checkCancellation()
            let httpClient = try JarvisComposition.makeClient(
                accessTokenProvider: MissingVoiceAccessTokenProvider()
            )
            let language = try await httpClient.voiceDefaultLanguage()
            guard sessionGeneration == generation else { return }
            try Task.checkCancellation()
            let microphoneAllowed = await VoiceAudioEngine.requestMicrophonePermission()
            guard sessionGeneration == generation else { return }
            try Task.checkCancellation()
            guard microphoneAllowed else {
                microphoneDenied = true
                voiceState = .failed
                liveActivitySessionID = nil
                markRetryFailedIfNeeded()
                return
            }
            guard sessionGeneration == generation else { return }
            let baseURL = try JarvisComposition.apiBaseURL()
            self.httpClient = httpClient
            self.audio = VoiceAudioEngine()
            let audio = self.audio
            let client = VoiceSessionClient(
                baseURL: baseURL,
                transport: URLSessionWebSocketTransport(),
                onMessage: { [weak self] message in
                    Task { @MainActor in
                        guard let self, self.sessionGeneration == generation else { return }
                        self.receive(message)
                    }
                },
                onAction: { action in
                    if case .interruptPlayback = action { audio.stopPlayback() }
                },
                onStateChange: { [weak self] state in
                    Task { @MainActor in
                        guard let self, self.sessionGeneration == generation else { return }
                        self.receiveSessionState(state)
                    }
                }
            )
            audio.setPlaybackFinishedHandler { [weak self] responseID, audible in
                Task { @MainActor in
                    guard let self, self.sessionGeneration == generation else { return }
                    try? await client.playbackCompleted(responseID: responseID, audible: audible)
                }
            }
            sessionClient = client
            try await client.start(accessToken: token, language: language)
            guard sessionGeneration == generation else { return }
            try Task.checkCancellation()
            startScreenShareMonitoring()
        } catch {
            guard sessionGeneration == generation else { return }
            isEnding = true
            defer { isEnding = false }
            sessionGeneration += 1
            isStarting = false
            errorMessage = Self.message(for: error)
            if let clientError = error as? JarvisClientError,
               case .signInRequired = clientError {
                signInRequired = true
            }
            voiceState = .failed
            markRetryFailedIfNeeded()
            let failedClient = sessionClient
            sessionClient = nil
            liveActivitySessionID = nil
            self.httpClient = nil
            stopAudio()
            await liveActivity.end()
            if let failedClient { try? await failedClient.end() }
        }
    }

    func retryIfNeeded() async {
        guard connectionPresentationState != .lost,
              microphoneDenied || voiceState == .failed else { return }
        await start()
    }

    func retryNow() async {
        guard connectionPresentationState == .lost, !isStarting, !isEnding else { return }
        connectionPresentationState = connectionPresentationMachine.apply(.retryRequested)
        sessionGeneration += 1
        let retryGeneration = sessionGeneration
        isStarting = true
        defer {
            if sessionGeneration == retryGeneration { isStarting = false }
        }
        let interruptedClient = sessionClient
        sessionClient = nil
        liveActivitySessionID = nil
        stopAudio()
        await liveActivity.end()
        if let interruptedClient { try? await interruptedClient.end() }
        guard sessionGeneration == retryGeneration,
              connectionPresentationState == .retrying else { return }
        isStarting = false
        await start()
    }

    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    func refreshCameraPermissionState() {
        if cameraPermissionDenied && VoiceCameraCapture.isAuthorized {
            cameraPermissionDenied = false
        }
    }

    func toggleMute() async {
        try? await setMuted(!isMuted)
    }

    private func setMuted(_ nextValue: Bool) async throws {
        guard let sessionClient, canUseControls else { return }
        guard nextValue != isMuted else { return }
        let generation = sessionGeneration
        isMuted = nextValue
        liveActivity.update(state: voiceState, isMuted: isMuted)
        do {
            try await sessionClient.setMuted(nextValue)
        } catch {
            guard generation == sessionGeneration else { return }
            errorMessage = Self.message(for: error)
            throw error
        }
    }

    func performLiveActivityCommand(_ command: VoiceLiveActivityCommand) async throws {
        guard liveActivitySessionID != nil else {
            throw VoiceLiveActivityError.unavailable
        }
        switch command {
        case .setMuted(let muted):
            guard canUseControls else { throw VoiceLiveActivityError.unavailable }
            try await setMuted(muted)
        case .end: await end()
        }
    }

    func toggleCaptions() {
        isCaptionsEnabled.toggle()
    }

    func minimize() {
        guard isSessionActive else { return }
        isMinimized = true
    }

    func restore() {
        isMinimized = false
    }

    func end() async {
        guard !isEnding else { return }
        isEnding = true
        defer { isEnding = false }
        sessionGeneration += 1
        liveActivitySessionID = nil
        connectionPresentationState = connectionPresentationMachine.apply(.ended)
        isStarting = false
        let endingClient = sessionClient
        sessionClient = nil
        voiceState = .ended
        screenShareBridge.requestStop()
        stopScreenShareMonitoring()
        stopAudio()
        camera?.stop()
        camera = nil
        isCameraEnabled = false
        isScreenSharing = false
        photoForNextTurn = nil
        photoIsReady = false
        await liveActivity.end()
        httpClient = nil
        userCaption = ""
        assistantCaption = ""
        if let endingClient {
            do {
                try await endingClient.end()
            } catch {
                errorMessage = Self.message(for: error)
            }
        }
        sessionClient = nil
        voiceSessionID = nil
        responseID = nil
        voiceState = .ended
        isMuted = false
        isMinimized = false
    }

    func startCamera() async {
        guard canUseControls, !isCameraEnabled else { return }
        let generation = sessionGeneration
        let cameraAllowed = await VoiceCameraCapture.requestAccess()
        guard sessionGeneration == generation, canUseControls else { return }
        guard cameraAllowed else {
            cameraPermissionDenied = true
            return
        }
        cameraPermissionDenied = false
        let capture = VoiceCameraCapture()
        do {
            try capture.start()
            camera = capture
            isCameraEnabled = true
            photoIsReady = false
            if let sessionClient { try await sessionClient.setCameraState(on: true) }
        } catch {
            guard sessionGeneration == generation else { return }
            capture.stop()
            camera = nil
            isCameraEnabled = false
            errorMessage = JarvisVoiceLocalization.string(.cameraUnavailable)
        }
    }

    func stopCamera() async {
        let generation = sessionGeneration
        camera?.stop()
        camera = nil
        isCameraEnabled = false
        photoForNextTurn = nil
        photoIsReady = false
        if let sessionClient {
            do {
                try await sessionClient.setCameraState(on: false)
            } catch {
                guard sessionGeneration == generation else { return }
                errorMessage = Self.message(for: error)
            }
        }
    }

    func capturePhotoForNextTurn() {
        guard let frame = camera?.capturePhoto() else {
            errorMessage = JarvisVoiceLocalization.string(.frameUnavailable)
            return
        }
        photoForNextTurn = frame
        photoIsReady = true
    }

    func setScreenSharing(_ enabled: Bool) async {
        guard enabled != isScreenSharing else { return }
        let generation = sessionGeneration
        if enabled, isCameraEnabled {
            await stopCamera()
        }
        guard sessionGeneration == generation, !isEnding else { return }
        isScreenSharing = enabled
    }

    func startScreenShareMonitoring() {
        guard screenShareMonitorTask == nil else { return }
        screenShareMonitorTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.refreshScreenShareState()
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    func stopScreenShareMonitoring() {
        screenShareMonitorTask?.cancel()
        screenShareMonitorTask = nil
    }

    func refreshScreenShareState() {
        guard isSessionActive else { return }
        let isSharing = screenShareBridge.isSharing
        guard isSharing != isScreenSharing else { return }
        let generation = sessionGeneration
        Task {
            guard sessionGeneration == generation else { return }
            await setScreenSharing(isSharing)
        }
    }

    func requestStopScreenSharing() {
        screenShareBridge.requestStop()
    }

    private func receive(_ message: VoiceServerMessage) {
        switch message {
        case .sessionReady(let sessionID):
            voiceSessionID = String(sessionID)
            beginAudioIfNeeded()
        case .sessionEnded:
            let generation = sessionGeneration
            Task {
                guard sessionGeneration == generation else { return }
                await end()
            }
        case .transcriptionDelta(let transcript, _):
            userCaption = Self.boundedCaption(transcript)
        case .transcriptionCompleted(let transcript, let itemID):
            userCaption = Self.boundedCaption(transcript)
            if isCameraEnabled, let itemID { inspectCameraTurn(transcript, itemID: itemID) }
            else if isScreenSharing { inspectScreenTurn() }
        case .responseCreated(let id):
            responseID = id
            assistantCaption = ""
        case .audioDelta(_, let base64):
            do {
                try audio.enqueuePlayback(base64, responseID: responseID)
                if let pcm16 = try? VoiceAudioCodec.decodePCM16(base64) {
                    liveActivity.update(state: voiceState, isMuted: isMuted, pcm16: pcm16)
                }
            } catch {
                errorMessage = JarvisVoiceLocalization.string(.playbackUnavailable)
            }
        case .assistantTranscriptDelta(let text):
            assistantCaption = Self.boundedCaption(assistantCaption + text)
        case .responseDone:
            audio.finishPlayback(responseID: responseID)
            responseID = nil
        case .responseCancelled:
            audio.stopPlayback()
            responseID = nil
        case .visualContext(_, let path, let reason):
            if path == "caption", let reason {
                errorMessage = Self.visualFailure(reason)
            }
        case .screenContextUnavailable(_, let reason):
            if let reason { errorMessage = Self.visualFailure(reason) }
        case .speechStarted:
            break
        case .unknown:
            break
        }
    }

    private func beginAudioIfNeeded() {
        guard screenshotState == nil, captureTask == nil else { return }
        do {
            let stream = try audio.startCapture()
            isAudioReady = true
            if let sessionID = liveActivitySessionID {
                let language = JarvisAppLanguage(
                    rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
                ) ?? .default
                do {
                    try liveActivity.start(sessionID: sessionID, language: language)
                    liveActivity.update(state: voiceState, isMuted: isMuted)
                } catch {
                    errorMessage = VoiceLiveActivityCopy.updateFailed.text(language: language)
                }
            }
            captureTask = Task { @MainActor [weak self] in
                for await pcm16 in stream {
                    guard let self, !Task.isCancelled else { return }
                    if self.voiceState != .speaking {
                        self.liveActivity.update(state: self.voiceState, isMuted: self.isMuted, pcm16: pcm16)
                    }
                    guard !self.isMuted, self.canSendAudio else { continue }
                    guard let client = self.sessionClient else { continue }
                    try? await client.sendAudio(pcm16)
                }
            }
        } catch {
            errorMessage = JarvisVoiceLocalization.string(.microphoneUnavailable)
            voiceState = .failed
            let generation = sessionGeneration
            Task {
                guard sessionGeneration == generation else { return }
                await end()
            }
        }
    }

    private var canSendAudio: Bool {
        switch voiceState {
        case .ready, .listening, .speaking:
            return true
        case .idle, .connecting, .reconnecting, .ended, .failed:
            return false
        }
    }

    private func stopAudio() {
        captureTask?.cancel()
        captureTask = nil
        audio.stop()
        isAudioReady = false
    }

    private func receiveSessionState(_ state: VoiceSessionState) {
        switch state {
        case .ready, .listening:
            connectionPresentationState = connectionPresentationMachine.apply(.connected)
        case .reconnecting:
            connectionPresentationState = connectionPresentationMachine.apply(.connectionDropped)
        case .connecting where connectionPresentationState == .lost:
            connectionPresentationState = connectionPresentationMachine.apply(.retryRequested)
        case .failed:
            connectionPresentationState = connectionPresentationMachine.apply(.retryFailed)
        case .ended:
            connectionPresentationState = connectionPresentationMachine.apply(.ended)
        case .idle, .connecting, .speaking:
            break
        }
        voiceState = state
        liveActivity.update(state: state, isMuted: isMuted)
        guard state == .failed else { return }
        let generation = sessionGeneration
        Task {
            guard sessionGeneration == generation else { return }
            await resetFailedSession()
        }
    }

    private func markRetryFailedIfNeeded() {
        guard connectionPresentationState == .retrying else { return }
        connectionPresentationState = connectionPresentationMachine.apply(.retryFailed)
    }

    private func resetFailedSession() async {
        guard voiceState == .failed, sessionClient != nil, !isEnding else { return }
        isEnding = true
        defer { isEnding = false }
        sessionGeneration += 1
        isStarting = false
        liveActivitySessionID = nil
        screenShareBridge.requestStop()
        stopScreenShareMonitoring()
        camera?.stop()
        camera = nil
        isCameraEnabled = false
        isScreenSharing = false
        let failedClient = sessionClient
        sessionClient = nil
        httpClient = nil
        voiceSessionID = nil
        responseID = nil
        isMuted = false
        photoForNextTurn = nil
        photoIsReady = false
        if errorMessage == nil { errorMessage = JarvisVoiceLocalization.string(.unavailable) }
        stopAudio()
        await liveActivity.end()
        if let failedClient { try? await failedClient.end() }
    }

    private func inspectCameraTurn(_ question: String, itemID: String) {
        guard let camera, let sessionClient, let httpClient, let voiceSessionID,
              let jpeg = photoForNextTurn ?? camera.latestFrame() else {
            Task { try? await sessionClient?.sendScreenContextUnavailable(
                itemID: itemID,
                reason: .captureFailed
            ) }
            return
        }
        photoForNextTurn = nil
        photoIsReady = false
        let generation = sessionGeneration
        Task { @MainActor in
            do {
                let frame = try await httpClient.uploadVoiceFrame(
                    sessionId: voiceSessionID,
                    jpeg: jpeg,
                    question: question,
                    turnId: itemID
                )
                guard self.sessionGeneration == generation else { return }
                let context = try VoiceScreenContext(
                    source: .camera,
                    capturedAt: frame.capturedAt,
                    question: question,
                    frameId: frame.frameId,
                    itemId: itemID
                )
                try await sessionClient.sendScreenContext(context)
            } catch {
                guard self.sessionGeneration == generation else { return }
                errorMessage = JarvisVoiceLocalization.string(.frameUnavailable)
                try? await sessionClient.sendScreenContextUnavailable(
                    itemID: itemID,
                    reason: .visionFailed
                )
            }
        }
    }

    private func inspectScreenTurn() {
        guard let httpClient, let voiceSessionID, let sessionClient,
              let jpeg = screenShareBridge.latestFrame() else {
            errorMessage = nil
            Task { try? await sessionClient?.sendScreenContextUnavailable(reason: .captureFailed) }
            return
        }
        let generation = sessionGeneration
        Task { @MainActor in
            do {
                let result = try await httpClient.inspectVoiceScreenFrame(
                    sessionId: voiceSessionID,
                    jpeg: jpeg
                )
                guard self.sessionGeneration == generation else { return }
                try await sessionClient.sendScreenContext(VoiceScreenContext(
                    source: .screen,
                    capturedAt: result.capturedAt,
                    description: result.description
                ))
            } catch {
                guard self.sessionGeneration == generation else { return }
                errorMessage = nil
                try? await sessionClient.sendScreenContextUnavailable(
                    reason: .visionFailed
                )
            }
        }
    }

    private static func boundedCaption(_ value: String) -> String {
        String(value.suffix(5_000))
    }

    private static func message(for error: any Error) -> String {
        guard let error = error as? JarvisClientError else { return JarvisVoiceLocalization.string(.unavailable) }
        switch error {
        case .signInRequired:
            return JarvisVoiceLocalization.string(.signInError)
        case .notOwner:
            return JarvisVoiceLocalization.string(.unavailable)
        case .rateLimited:
            return JarvisVoiceLocalization.string(.tryLater)
        case .serviceUnavailable, .networkFailure, .timedOut:
            return JarvisVoiceLocalization.string(.unavailable)
        default:
            return JarvisVoiceLocalization.string(.unavailable)
        }
    }

    private static func visualFailure(_ reason: String) -> String {
        switch reason {
        case "daily_limit", "budget_exhausted":
            return JarvisVoiceLocalization.string(.imageLimit)
        case "frame_rate_limited":
            return JarvisVoiceLocalization.string(.imageRateLimit)
        case "budget_unavailable":
            return JarvisVoiceLocalization.string(.imageUnavailable)
        default:
            return JarvisVoiceLocalization.string(.imageUnavailable)
        }
    }
}

private struct MissingVoiceAccessTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        throw JarvisClientError.signInRequired
    }

    func requestSignIn() async {
        NotificationCenter.default.post(name: .jarvisSignInRequired, object: nil)
    }
}
