import Combine
import Foundation
import JarvisCore
import UIKit

@MainActor
final class VoiceScreenModel: ObservableObject {
    @Published private(set) var voiceState: VoiceSessionState = .idle
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

    private let audio = VoiceAudioEngine()
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

    init() {
        audio.setPlaybackFinishedHandler { [weak self] responseID, audible in
            Task { @MainActor in
                guard let self, let client = self.sessionClient else { return }
                try? await client.playbackCompleted(responseID: responseID, audible: audible)
            }
        }
    }

    var statusText: String {
        if case .reconnecting = voiceState { return "Reconnecting" }
        if voiceState == .failed || microphoneDenied { return "Offline" }
        if isMuted { return "Muted" }
        if !isAudioReady && voiceState == .listening { return "Connecting" }
        switch voiceState {
        case .idle, .connecting:
            return "Connecting"
        case .ready:
            return "Thinking"
        case .listening:
            return "Listening"
        case .speaking:
            return "Speaking"
        case .reconnecting:
            return "Reconnecting"
        case .ended, .failed:
            return "Offline"
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
        isSessionActive && !microphoneDenied
    }

    func start() async {
        guard !isStarting, sessionClient == nil else { return }
        isStarting = true
        defer { isStarting = false }
        errorMessage = nil
        microphoneDenied = false
        signInRequired = false
        voiceState = .connecting
        do {
            let tokenStore = try KeychainTokenStore()
            guard let token = try await tokenStore.read() else {
                throw JarvisClientError.signInRequired
            }
            let httpClient = try JarvisComposition.makeClient(
                accessTokenProvider: MissingVoiceAccessTokenProvider()
            )
            let language = try await httpClient.voiceDefaultLanguage()
            guard await VoiceAudioEngine.requestMicrophonePermission() else {
                microphoneDenied = true
                voiceState = .failed
                return
            }
            let baseURL = try JarvisComposition.apiBaseURL()
            self.httpClient = httpClient
            sessionGeneration += 1
            let audio = self.audio
            let client = VoiceSessionClient(
                baseURL: baseURL,
                transport: URLSessionWebSocketTransport(),
                onMessage: { [weak self] message in
                    Task { @MainActor in self?.receive(message) }
                },
                onAction: { action in
                    if case .interruptPlayback = action { audio.stopPlayback() }
                },
                onStateChange: { [weak self] state in
                    Task { @MainActor in self?.receiveSessionState(state) }
                }
            )
            sessionClient = client
            try await client.start(accessToken: token, language: language)
            startScreenShareMonitoring()
        } catch {
            errorMessage = Self.message(for: error)
            if let clientError = error as? JarvisClientError,
               case .signInRequired = clientError {
                signInRequired = true
            }
            voiceState = .failed
            let failedClient = sessionClient
            sessionClient = nil
            if let failedClient { try? await failedClient.end() }
            await stopAudio()
        }
    }

    func retryIfNeeded() async {
        guard microphoneDenied || voiceState == .failed else { return }
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
        guard let sessionClient, canUseControls else { return }
        let nextValue = !isMuted
        do {
            try await sessionClient.setMuted(nextValue)
            isMuted = nextValue
        } catch {
            errorMessage = Self.message(for: error)
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
        sessionGeneration += 1
        screenShareBridge.requestStop()
        stopScreenShareMonitoring()
        await stopAudio()
        camera?.stop()
        camera = nil
        isCameraEnabled = false
        isScreenSharing = false
        photoForNextTurn = nil
        photoIsReady = false
        if let sessionClient {
            do {
                try await sessionClient.end()
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
        guard await VoiceCameraCapture.requestAccess() else {
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
            capture.stop()
            camera = nil
            isCameraEnabled = false
            errorMessage = "Camera unavailable."
        }
    }

    func stopCamera() async {
        camera?.stop()
        camera = nil
        isCameraEnabled = false
        photoForNextTurn = nil
        photoIsReady = false
        if let sessionClient {
            do {
                try await sessionClient.setCameraState(on: false)
            } catch {
                errorMessage = Self.message(for: error)
            }
        }
    }

    func capturePhotoForNextTurn() {
        guard let frame = camera?.capturePhoto() else {
            errorMessage = "Camera frame unavailable."
            return
        }
        photoForNextTurn = frame
        photoIsReady = true
    }

    func setScreenSharing(_ enabled: Bool) async {
        guard enabled != isScreenSharing else { return }
        if enabled, isCameraEnabled {
            await stopCamera()
        }
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
        let isSharing = screenShareBridge.isSharing
        guard isSharing != isScreenSharing else { return }
        Task { await setScreenSharing(isSharing) }
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
            Task { await end() }
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
            } catch {
                errorMessage = "Audio playback unavailable."
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
        guard captureTask == nil else { return }
        do {
            let stream = try audio.startCapture()
            isAudioReady = true
            captureTask = Task { @MainActor [weak self] in
                for await pcm16 in stream {
                    guard let self, !Task.isCancelled else { return }
                    guard !self.isMuted, self.canSendAudio else { continue }
                    guard let client = self.sessionClient else { continue }
                    try? await client.sendAudio(pcm16)
                }
            }
        } catch {
            errorMessage = "Microphone unavailable."
            voiceState = .failed
            Task { await end() }
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

    private func stopAudio() async {
        captureTask?.cancel()
        captureTask = nil
        audio.stop()
        isAudioReady = false
    }

    private func receiveSessionState(_ state: VoiceSessionState) {
        voiceState = state
        guard state == .failed else { return }
        Task { await resetFailedSession() }
    }

    private func resetFailedSession() async {
        guard voiceState == .failed, sessionClient != nil else { return }
        sessionGeneration += 1
        screenShareBridge.requestStop()
        stopScreenShareMonitoring()
        camera?.stop()
        camera = nil
        isCameraEnabled = false
        isScreenSharing = false
        sessionClient = nil
        voiceSessionID = nil
        responseID = nil
        isMuted = false
        photoForNextTurn = nil
        photoIsReady = false
        if errorMessage == nil { errorMessage = "Voice unavailable." }
        await stopAudio()
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
                errorMessage = "Camera frame unavailable."
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
        guard let error = error as? JarvisClientError else { return "Voice unavailable." }
        switch error {
        case .signInRequired:
            return "Sign in required."
        case .notOwner:
            return "Voice unavailable."
        case .rateLimited:
            return "Try again later."
        case .serviceUnavailable, .networkFailure, .timedOut:
            return "Voice unavailable."
        default:
            return "Voice unavailable."
        }
    }

    private static func visualFailure(_ reason: String) -> String {
        switch reason {
        case "daily_limit", "budget_exhausted":
            return "Image limit reached."
        case "frame_rate_limited":
            return "Image request limited."
        case "budget_unavailable":
            return "Image unavailable."
        default:
            return "Image unavailable."
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
