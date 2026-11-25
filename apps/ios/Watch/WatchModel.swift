import Combine
import AVFoundation
import Foundation
import JarvisCore
import OSLog

@MainActor
final class WatchModel: ObservableObject {
    struct Message: Identifiable {
        var id = UUID().uuidString
        var role: ConversationRole
        var text: String
        var user: Bool { role == .dan }
    }
    enum DictationState: Equatable { case idle, connecting, listening, finishing }
    enum AudioAction: Equatable { case dictation, voice }
    struct AudioFailure: Equatable {
        let message: String
        let action: AudioAction
    }
    @Published var messages: [Message] = []
    @Published private var composer = WatchComposer()
    var draft: String {
        get { composer.draft }
        set { composer.draft = newValue }
    }
    @Published var busy = false
    @Published var error: String?
    @Published private(set) var audioFailure: AudioFailure?
    @Published private(set) var historyError: String?
    @Published private(set) var replyTargetMessageID: String?
    @Published var voiceID: UUID?
    @Published var voiceState = ""
    @Published private(set) var waitingForVoiceConnection = false
    @Published private(set) var startingVoice = false
    @Published var muted = false
    @Published private(set) var dictationState: DictationState = .idle
    let connection = WatchConnection.shared
    private let audio = VoiceAudioEngine()
    private let voiceLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Jarvis", category: "WatchVoice")
    private var capture: Task<Void, Never>?
    private var captureTerminationLogged = false
    private var audioSends = Set<UUID>()
    private var audioBackpressure = WatchVoiceBackpressure(now: Date())
    private var lastAudioMetrics = Date()
    private var audioSequence: UInt64 = 0
    private var captureLevel = WatchCaptureLevel()
    private var heartbeat: Task<Void, Never>?
    private var historyRequest = UUID()
    private var replyRoute = WatchReplyRouteState()
    private var turn: UUID?
    private var replyID: String?
    private var voiceGeneration = UUID()
    private var voiceStartToken: UUID?
    @Published private var voiceRecovery: Task<Void, Never>?
    private var audioRouteRecovery: Task<Void, Never>?
    private var audioRouteBudget = WatchVoiceRecovery.RouteBudget()
    @Published private(set) var repairingAudio = false
    var voiceRecoveryStatus: String? {
        if voiceRecovery != nil { return "iPhone connection lost. Reconnecting…" }
        if repairingAudio { return "Audio changed. Reconnecting…" }
        return nil
    }
    private var endingVoice = false
    private var dictationGeneration = UUID()
    private var dictationID: UUID?
    private var dictationCapture: Task<Bool, Never>?
    private var dictationTimeout: Task<Void, Never>?
    private let transcriptionDeadline = WatchDictationDeadline()
    private var dictationAudio = Data()
    private var dictationTranscription: Task<String, Error>?
    private var seenVoiceDeliveryIDs = Set<UUID>()
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            messages = [
                .init(role: .dan, text: "What should I train today?"),
                .init(role: .jarvis, text: "Upper body: bench press, rows and shoulder press."),
                .init(role: .dan, text: "What weight for bench?"),
                .init(role: .jarvis, text: "Your last entry was 60 kg for 8 reps."),
            ]
            if let state = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--watch-voice-fixture=") }) {
                voiceID = UUID(); muted = state.hasSuffix("muted")
                voiceState = state.hasSuffix("speaking") ? "Speaking" : "Listening"
                messages = [
                    .init(
                        role: .jarvis,
                        text: state.hasSuffix("listening")
                            ? "Your next meeting starts at 10:30."
                            : "You have time to review your notes."
                    ),
                ]
            }
            if ProcessInfo.processInfo.arguments.contains("--watch-chat-draft") {
                draft = "Please remind me to bring my notes to the morning meeting."
            }
            if ProcessInfo.processInfo.arguments.contains("--watch-chat-long") {
                messages = [
                    .init(role: .jarvis, text: "Hello Dan, nice to be talking with you."),
                    .init(role: .dan, text: "What is next today?"),
                    .init(role: .jarvis, text: "Your next meeting starts at 10:30. You have time to review the notes before you leave."),
                    .init(role: .jarvis, text: "I can help you prepare."),
                    .init(role: .jarvis, text: "Would you like me to summarise them?"),
                    .init(role: .dan, text: "Yes, please."),
                    .init(role: .jarvis, text: "Two items need a decision before noon: the budget review and the venue. Nothing else is due today."),
                    .init(role: .jarvis, text: "I will remind you at 10:00."),
                ]
            }
        }
        #endif
        connection.onEvent = { [weak self] in self?.receive($0) }
        connection.onSignOut = { [weak self] in
            guard let self else { return }
            self.replyRoute.clear()
            self.replyTargetMessageID = nil
            JarvisReplyNotificationTarget.pending()?.clear()
            JarvisReplyNotificationTarget.active()?.clearActive()
            if self.dictationState != .idle { self.failDictation(WatchFailure.signInRequired) }
        }
        connection.onDisconnect = { [weak self] in
            guard let self else { return }
            if self.voiceID != nil {
                // WatchConnectivity reachability often drops for a few seconds; do not end a live session for it.
                self.recoverVoiceConnection()
                return
            }
            guard self.composer.handleConnectionLoss(hasInFlightTurn: self.turn != nil, hasVoiceSession: false) else { return }
            self.busy = false; self.turn = nil
            if self.error == nil { self.error = "iPhone unavailable. Reconnect and check history before sending again." }
        }
    }
    private func configurePlaybackCompletion(epoch: UUID) {
        audio.setPlaybackFinishedHandler { [weak self] responseID, audible in
            Task { @MainActor in
                guard let self, self.voiceGeneration == epoch, !self.endingVoice, let id = self.voiceID else { return }
                let receipt = WatchRequest(action: .playbackCompleted, text: id.uuidString, itemID: responseID, flag: audible)
                await WatchVoiceRecovery.deliverPlaybackReceipt(receipt, isCurrent: {
                    self.voiceGeneration == epoch && self.voiceID == id && !self.endingVoice
                }, send: { request in
                    _ = try await self.connection.request(request, waitForReadiness: false, timeout: .seconds(3))
                })
            }
        }
    }
    func history() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") { return }
        #endif
        guard !busy, !startingVoice, voiceID == nil, connection.reachable else { return }
        if await routePendingReplyIfPossible() || replyRoute.pending != nil { return }
        if let active = replyRoute.active {
            _ = await loadReplyTarget(active)
            return
        }
        _ = await loadHistory()
    }

    @discardableResult
    func openReplyTarget(_ target: JarvisReplyNotificationTarget) async -> Bool {
        target.store()
        replyRoute.receive(target)
        replyTargetMessageID = nil
        return await routePendingReplyIfPossible()
    }

    @discardableResult
    func routePendingReplyIfPossible() async -> Bool {
        guard let target = replyRoute.takeWhenAvailable(
            reachable: connection.reachable,
            busy: busy,
            startingVoice: startingVoice,
            voiceActive: voiceID != nil,
            dictating: dictationState != .idle
        ) else {
            return false
        }
        let opened = await loadReplyTarget(target)
        if opened {
            replyRoute.opened(target)
            target.activate()
        } else {
            replyRoute.failed(target)
        }
        if let pending = replyRoute.pending, pending != target {
            Task { await routePendingReplyIfPossible() }
        }
        return opened
    }

    func leaveReplyDeepLink() {
        let active = replyRoute.active
        let abandoned = replyRoute.leaveActive()
        active?.clearActive()
        abandoned?.clear()
        replyTargetMessageID = nil
    }

    private func loadReplyTarget(_ target: JarvisReplyNotificationTarget) async -> Bool {
        replyTargetMessageID = nil
        do {
            let data = try WatchCodec.encode(target)
            let reply = try await requestHistory(data: data)
            guard let reply, let decoded = try? JSONDecoder().decode([WatchHistoryMessage].self, from: reply) else {
                throw WatchFailure.failed
            }
            guard replyRoute.isCurrent(target) else { return false }
            messages = decoded.map { Message(id: $0.id, role: $0.role, text: $0.text) }
            guard decoded.contains(where: { $0.id == target.messageID }) else {
                historyError = "This exact reply is no longer available. Open Jarvis on your iPhone."
                return false
            }
            replyTargetMessageID = target.messageID
            historyError = nil
            return true
        } catch {
            historyError = (error as? WatchFailure)?.message ?? "History could not refresh. Check Jarvis on your iPhone."
            return false
        }
    }

    private func loadHistory() async -> Bool {
        let read = UUID(); historyRequest = read
        historyError = nil
        do {
            let history: [WatchHistoryMessage] = try await connection.load(.history)
            guard read == historyRequest, !busy, voiceID == nil else { return false }
            messages = history.map { Message(id: $0.id, role: $0.role, text: $0.text) }
            return true
        } catch {
            guard read == historyRequest, !busy, voiceID == nil else { return false }
            historyError = (error as? WatchFailure)?.message ?? "History could not refresh. Check Jarvis on your iPhone."
            return false
        }
    }

    private func requestHistory(data: Data) async throws -> Data? {
        let read = UUID()
        historyRequest = read
        historyError = nil
        let reply = try await connection.request(.init(action: .history, data: data))
        guard read == historyRequest, !busy, voiceID == nil else { return nil }
        return reply.data
    }

    func send() async {
        guard !busy, !startingVoice, voiceID == nil, dictationState == .idle, let text = composer.beginSend() else { return }
        leaveReplyDeepLink()
        historyRequest = UUID(); historyError = nil
        let request = WatchRequest(action: .sendTurn, text: text)
        busy = true; error = nil; turn = request.id
        let responseID = UUID().uuidString; replyID = responseID
        messages.append(.init(role: .dan, text: text))
        messages.append(.init(id: responseID, role: .jarvis, text: "Working…"))
        do {
            _ = try await connection.request(request)
            composer.finishSend(success: true)
            audioFailure = nil
        } catch {
            busy = false; turn = nil; composer.finishSend(success: false)
            messages.removeAll { $0.id == responseID }
            show(error)
            Task { await routePendingReplyIfPossible() }
        }
    }
    func startVoice() async {
        guard !startingVoice, !endingVoice, !busy, dictationState == .idle else { return }
        historyRequest = UUID(); historyError = nil
        let token = UUID(); voiceStartToken = token
        startingVoice = true; error = nil; audioFailure = nil
        let startedAt = Date()
        // A cancelled start clears these itself, so a late finish cannot reset a newer attempt.
        defer {
            if voiceStartToken == token { voiceStartToken = nil; startingVoice = false; waitingForVoiceConnection = false }
            Task { await routePendingReplyIfPossible() }
        }
        func elapsedMs() -> Int { Int(Date().timeIntervalSince(startedAt) * 1_000) }
        do {
            if try await hasActiveVoice() { return }
        } catch is CancellationError { return }
        catch WatchFailure.unavailable { recoverVoiceConnection(); return }
        catch { failVoice(voiceFailureMessage(error), reason: "heartbeat_failed"); return }
        guard voiceStartToken == token else { return }
        let epoch = UUID(); voiceGeneration = epoch
        let permitted = await VoiceAudioEngine.requestMicrophonePermission()
        guard epoch == voiceGeneration else { return }
        guard permitted else {
            audioFailure = .init(message: "Allow microphone access in Settings.", action: .voice)
            return
        }
        do {
            waitingForVoiceConnection = true
            try await connection.waitForVoiceConnection(timeout: 15)
            guard epoch == voiceGeneration else { return }
            waitingForVoiceConnection = false
            voiceLogger.info("Voice start: phone reachable after \(elapsedMs()) ms")
            let stream: AsyncStream<Data>
            do {
                // The phone can send playback before replying to start. Have the graph and callback ready first.
                stream = try await startAudioCapture(forVoice: true, onReady: {
                    self.configurePlaybackCompletion(epoch: epoch)
                }) { self.voiceGeneration == epoch }
            } catch {
                guard epoch == voiceGeneration else { return }
                voiceLogger.error("Voice capture could not start: \(String(describing: error), privacy: .public)")
                audioFailure = .init(message: "The microphone couldn’t start.", action: .voice)
                return
            }
            guard epoch == voiceGeneration else { return }
            let request = WatchRequest(action: .startVoice, flag: true)
            // Accept early state events while the phone opens the socket.
            voiceID = request.id; voiceState = "Connecting"; endingVoice = false
            seenVoiceDeliveryIDs.removeAll(keepingCapacity: true)
            var reply: WatchReply?
            var attempt = 1
            while reply == nil {
                do { reply = try await connection.request(request) }
                catch {
                    // The phone answers a repeated request ID from its reply cache or reports busy, so a quick failure is safe to repeat.
                    guard epoch == voiceGeneration, !endingVoice else { return }
                    guard WatchVoiceRecovery.shouldRetryStart(error, attempt: attempt, elapsed: Date().timeIntervalSince(startedAt)) else { throw error }
                    voiceLogger.info("Voice start retry \(attempt) after \(elapsedMs()) ms: \(String(describing: error), privacy: .public)")
                    attempt += 1
                    try await Task.sleep(for: WatchVoiceRecovery.startRetryDelay)
                    guard epoch == voiceGeneration, !endingVoice else { return }
                    try await connection.waitForVoiceConnection(timeout: 10)
                    guard epoch == voiceGeneration, !endingVoice else { return }
                }
            }
            guard epoch == voiceGeneration, !endingVoice else {
                // Cancelled while the phone was starting; make sure it does not keep a session nobody owns.
                if epoch != voiceGeneration {
                    _ = try? await connection.request(.init(action: .endVoice, itemID: request.id.uuidString), waitForReadiness: false)
                }
                return
            }
            guard let result = reply, let data = result.data else { throw WatchFailure.failed }
            voiceLogger.info("Voice start: phone session ready after \(elapsedMs()) ms, attempts=\(attempt)")
            voiceID = try JSONDecoder().decode(UUID.self, from: data)
            let pipeline = result.voicePipeline == true
            let audioStreamID = request.id.uuidString
            captureTerminationLogged = false
            audioBackpressure = WatchVoiceBackpressure(now: Date()); lastAudioMetrics = Date()
            audioSequence = 0
            captureLevel = WatchCaptureLevel()
            var lastCaptureAt = ContinuousClock.now
            capture = Task { [weak self] in
                var batch = Data()
                for await bytes in stream {
                    guard let self else { return }
                    guard !Task.isCancelled, self.voiceGeneration == epoch, let id = self.voiceID else { return }
                    lastCaptureAt = .now
                    if !self.connection.reachable { self.recoverVoiceConnection() }
                    if self.muted || self.voiceRecovery != nil || self.repairingAudio || self.endingVoice || self.voiceState == "Reconnecting" {
                        batch.removeAll(keepingCapacity: true)
                        self.audioBackpressure.progressed(at: Date())
                        continue
                    }
                    self.captureLevel.add(pcm: bytes)
                    // Voice processing may deliver digital silence while Dan is quiet.
                    if self.captureLevel.isDeaf && !self.audio.isVoiceProcessingEnabled {
                        self.voiceLogger.error("Voice microphone silent: samples=\(self.captureLevel.samples) peak=\(self.captureLevel.peak) capture_drops=\(self.audio.droppedCaptureChunks) \(self.audio.captureSummary, privacy: .public)")
                        self.failVoice(WatchMicrophoneFailure.silent.message, reason: "microphone_silent")
                        return
                    }
                    batch.append(bytes)
                    guard batch.count >= 12_000 else { continue } // ~250 ms at 24 kHz PCM16.
                    let packet = batch; batch.removeAll(keepingCapacity: true)
                    let sequence = self.audioSequence
                    self.audioSequence += 1
                    if self.audioSends.count < (pipeline ? 4 : 1) {
                        let request = WatchRequest(action: .audio, text: pipeline ? audioStreamID : nil, itemID: id.uuidString, data: packet, sequence: pipeline ? sequence : nil)
                        let started = Date()
                        self.audioSends.insert(request.id)
                        self.connection.sendVoiceAudio(request) { [weak self] result in
                            guard let self else { return }
                            guard self.voiceGeneration == epoch, self.audioSends.remove(request.id) != nil else { return }
                            switch result {
                            case .success:
                                self.audioBackpressure.progressed(at: Date())
                                let milliseconds = Int(Date().timeIntervalSince(started) * 1_000)
                                if Date().timeIntervalSince(self.lastAudioMetrics) >= 5 {
                                    self.voiceLogger.info("Voice link: rtt_ms=\(milliseconds) in_flight=\(self.audioSends.count) packet_drops=\(self.audioBackpressure.drops) capture_drops=\(self.audio.droppedCaptureChunks) capture_peak=\(self.captureLevel.peak)")
                                    self.lastAudioMetrics = Date()
                                }
                            case .failure:
                                self.audioBackpressure.dropped()
                            }
                        }
                    } else {
                        self.audioBackpressure.dropped()
                    }
                    if self.audioBackpressure.stalled(at: Date()) {
                        self.voiceLogger.error("Voice link stalled: in_flight=\(self.audioSends.count) packet_drops=\(self.audioBackpressure.drops) capture_drops=\(self.audio.droppedCaptureChunks)")
                        self.failVoice("The iPhone audio connection stopped responding.", reason: "audio_link_stalled")
                        return
                    }
                }
                guard let self, !Task.isCancelled, self.voiceGeneration == epoch, !self.endingVoice else { return }
                self.failVoice("The microphone stopped sending audio.", reason: "capture_stream_ended")
            }
            heartbeat = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, !Task.isCancelled, self.voiceGeneration == epoch, !self.endingVoice else { return }
                    if self.voiceRecovery != nil { continue }
                    if !self.connection.reachable { self.recoverVoiceConnection(); continue }
                    if !self.muted, !self.repairingAudio, lastCaptureAt.duration(to: .now) >= .seconds(10) {
                        self.failVoice(WatchMicrophoneFailure.noAudio.message, reason: "capture_no_buffers")
                        return
                    }
                    if !self.muted && self.voiceState != "Reconnecting" && !self.audioBackpressure.stalled(at: Date()) { continue }
                    do {
                        guard try await self.hasActiveVoice(timeout: .seconds(2)) else { return }
                    } catch WatchFailure.unavailable {
                        guard self.voiceGeneration == epoch else { return }
                        self.recoverVoiceConnection()
                    } catch {
                        guard self.voiceGeneration == epoch, !Task.isCancelled, self.voiceRecovery == nil else { return }
                        self.failVoice(self.voiceFailureMessage(error), reason: "heartbeat_failed")
                        return
                    }
                }
            }
        } catch {
            guard epoch == voiceGeneration, !endingVoice else { return }
            setVoiceFailure(error)
            guard let pendingID = voiceID else { return }
            stopLocalVoice(state: "Disconnected", captureEndReason: "startup_failed")
            // Release a call the phone may have started before its acknowledgement was lost.
            _ = try? await connection.request(.init(action: .endVoice, itemID: pendingID.uuidString),
                                              waitForReadiness: false, timeout: .seconds(2))
        }
    }
    func startDictation() async {
        guard dictationState == .idle, voiceID == nil, !busy, !startingVoice else { return }
        let epoch = UUID()
        dictationGeneration = epoch
        dictationState = .connecting
        error = nil; audioFailure = nil
        guard await VoiceAudioEngine.requestMicrophonePermission() else {
            if dictationGeneration == epoch {
                failDictation("Allow microphone access in Settings, or tap Message to type.")
            }
            return
        }
        guard dictationGeneration == epoch else { return }
        do {
            dictationAudio.removeAll()
            captureLevel = WatchCaptureLevel()
            // Dictation plays nothing, so it needs no voice processing; the other mode is the one-time recovery.
            let stream = try await startAudioCapture(forVoice: false) { self.dictationGeneration == epoch }
            guard dictationGeneration == epoch else { return }
            dictationState = .listening
            dictationCapture = Task { [weak self] in
                for await bytes in stream {
                    guard let self, self.dictationGeneration == epoch, !Task.isCancelled else { return false }
                    guard self.dictationAudio.count + bytes.count <= WatchLimits.dictationBytes else {
                        self.failDictation(WatchFailure.invalidRequest)
                        return false
                    }
                    self.dictationAudio.append(bytes)
                    self.captureLevel.add(pcm: bytes)
                }
                guard let self, self.dictationGeneration == epoch, self.dictationState == .finishing,
                      !self.audio.didDropCapture else {
                    if let self, self.dictationGeneration == epoch { self.failDictation(WatchFailure.failed) }
                    return false
                }
                return true
            }
            dictationTimeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(55))
                guard !Task.isCancelled, let self, self.dictationGeneration == epoch else { return }
                Task { await self.stopDictation() }
            }
        } catch {
            if dictationGeneration == epoch { failDictation("The microphone couldn’t start. Tap Message to type instead.") }
        }
    }
    func stopDictation() async {
        guard dictationState == .listening else { return }
        let epoch = dictationGeneration
        dictationState = .finishing
        dictationTimeout?.cancel(); dictationTimeout = nil
        cancelRouteRecovery()
        audio.stop()
        guard await dictationCapture?.value == true, dictationGeneration == epoch else { return }
        voiceLogger.info("Dictation captured: samples=\(self.captureLevel.samples) peak=\(self.captureLevel.peak) \(self.audio.captureSummary, privacy: .public)")
        if !captureLevel.hasAudio { failDictation(WatchMicrophoneFailure.noAudio); return }
        if captureLevel.isSilent { failDictation(WatchMicrophoneFailure.silent); return }
        do {
            let recording = dictationAudio
            dictationAudio.removeAll()
            let task = Task { try await transcribeDictation(recording, epoch: epoch) }
            dictationTranscription = task
            let text = try await task.value
            guard dictationGeneration == epoch else { return }
            composer.appendDictation(text)
            transcriptionDeadline.cancel()
            dictationID = nil; dictationCapture = nil; dictationTranscription = nil; dictationState = .idle
            Task { await routePendingReplyIfPossible() }
        } catch {
            if dictationGeneration == epoch { failDictation(error) }
        }
    }
    private func transcribeDictation(_ recording: Data, epoch: UUID) async throws -> String {
        guard !recording.isEmpty else { throw WatchFailure.failed }
        let direct: (@MainActor @Sendable () async throws -> String)?
        do {
            if connection.credentialStorageFailed { throw WatchFailure.credentialStorage }
            if try WatchDirectDictation.credential() != nil {
                direct = { try await WatchDirectDictation.transcribe(recording) }
            } else { direct = nil }
        } catch { direct = { throw error } }
        return try await WatchDictationRouting.transcribe(direct: direct, phone: {
            try await self.transcribeViaPhone(recording, epoch: epoch)
        })
    }
    private func transcribeViaPhone(_ recording: Data, epoch: UUID) async throws -> String {
        try Task.checkCancellation()
        guard dictationGeneration == epoch else { throw CancellationError() }
        // Bound the Watch-to-phone transfer separately. The finish request has its own reply timeout.
        transcriptionDeadline.start(duration: WatchLimits.dictationDuration) { [weak self] in
            guard let self, self.dictationGeneration == epoch, self.dictationState == .finishing else { return }
            self.failDictation(WatchDictationError.timedOut)
        }
        let request = WatchRequest(action: .startDictation)
        dictationID = request.id
        let reply = try await connection.request(request)
        guard let data = reply.data, try JSONDecoder().decode(UUID.self, from: data) == request.id else {
            throw WatchFailure.failed
        }
        for offset in stride(from: 0, to: recording.count, by: WatchLimits.payloadBytes) {
            try Task.checkCancellation()
            guard dictationGeneration == epoch else { throw CancellationError() }
            let chunk = recording.subdata(in: offset..<min(recording.count, offset + WatchLimits.payloadBytes))
            _ = try await connection.request(.init(action: .dictationAudio, itemID: request.id.uuidString, data: chunk))
        }
        try Task.checkCancellation()
        guard dictationGeneration == epoch else { throw CancellationError() }
        transcriptionDeadline.cancel()
        let result = try await connection.request(.init(action: .finishDictation, itemID: request.id.uuidString))
        guard let data = result.data else { throw WatchFailure.failed }
        return try JSONDecoder().decode(String.self, from: data)
    }
    func cancelDictation() {
        guard dictationState != .idle else { return }
        let id = dictationID
        dictationGeneration = UUID()
        dictationState = .idle; dictationID = nil
        dictationTimeout?.cancel(); dictationTimeout = nil
        transcriptionDeadline.cancel()
        dictationCapture?.cancel(); dictationCapture = nil
        dictationTranscription?.cancel(); dictationTranscription = nil
        dictationAudio.removeAll()
        cancelRouteRecovery()
        audio.stop()
        if let id {
            Task { _ = try? await connection.request(.init(action: .cancelDictation, itemID: id.uuidString)) }
        }
        Task { await routePendingReplyIfPossible() }
    }
    func interruptDictation() {
        // Finishing has released the microphone; neither a route interruption nor screen sleep should cancel the upload.
        guard dictationState == .connecting || dictationState == .listening else { return }
        failDictation("Dictation was interrupted. Tap Message to type instead.")
    }
    private func failDictation(_ message: String) {
        cancelDictation()
        audioFailure = .init(message: message, action: .dictation)
    }
    private func failDictation(_ failure: Error) {
        if let failure = failure as? WatchDictationError { failDictation(failure.message); return }
        if let failure = failure as? WatchMicrophoneFailure { failDictation(failure.message + " Tap Message to type."); return }
        failDictation("Dictation failed. " + ((failure as? WatchFailure)?.message ?? "No words were saved.") + " Tap Message to type.")
    }
    private func hasActiveVoice(timeout: Duration? = nil) async throws -> Bool {
        guard let id = voiceID else { return false }
        let epoch = voiceGeneration
        do {
            _ = try await connection.request(.init(action: .voiceHeartbeat, itemID: id.uuidString),
                                             waitForReadiness: timeout == nil, timeout: timeout)
            guard epoch == voiceGeneration else { throw CancellationError() }
            return true
        } catch WatchFailure.invalidRequest {
            guard epoch == voiceGeneration else { throw CancellationError() }
            stopLocalVoice(state: "Disconnected", captureEndReason: "phone_session_missing")
            if !startingVoice, audioFailure == nil {
                audioFailure = .init(message: "The voice session ended on the iPhone.", action: .voice)
            }
            return false
        }
    }
    func reconcileVoice() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--watch-voice-fixture=") }) { return }
        #endif
        guard !busy, !startingVoice, voiceRecovery == nil else { return }
        _ = try? await hasActiveVoice()
    }
    func setMuted() async {
        guard let id = voiceID else { return }
        let next = !muted
        do { _ = try await connection.request(.init(action: .muteVoice, itemID: id.uuidString, flag: next)); muted = next }
        catch { show(error) }
    }
    func endVoice(captureEndReason: String = "user_ended") async {
        guard let id = voiceID, !endingVoice else { return }
        let epoch = voiceGeneration
        beginLocalVoiceEnd(captureEndReason: captureEndReason)
        do {
            _ = try await connection.request(.init(action: .endVoice, itemID: id.uuidString), waitForReadiness: false)
            guard epoch == voiceGeneration, voiceID == id else { return }
            stopLocalVoice(state: "Ended", captureEndReason: captureEndReason)
        }
        catch {
            guard epoch == voiceGeneration, voiceID == id else { return }
            stopLocalVoice(state: "Disconnected", captureEndReason: "phone_end_failed")
            if audioFailure == nil {
                audioFailure = .init(message: "The Watch couldn’t confirm that voice ended on the iPhone.", action: .voice)
            }
        }
    }
    func cancelVoiceStart() async {
        guard startingVoice else { return }
        voiceLogger.info("Voice start cancelled by the user")
        voiceStartToken = nil; startingVoice = false; waitingForVoiceConnection = false
        if voiceID == nil {
            voiceGeneration = UUID()
            audio.stop()
            return
        }
        await endVoice(captureEndReason: "start_cancelled")
    }
    private func startAudioCapture(
        forVoice: Bool,
        onReady: @MainActor @Sendable () -> Void = {}, isCurrent: @MainActor @Sendable () -> Bool
    ) async throws -> AsyncStream<Data> {
        try await WatchVoiceRecovery.startCapture(isCurrent: isCurrent, start: { attempt in
            // A route can reject the processed graph at engine.start(), after accepting the I/O change.
            try audio.startCapture(tolerateDrops: forVoice, mode: forVoice ? .voiceChat : .default,
                                   alternateMode: forVoice ? .default : .voiceChat,
                                   useVoiceProcessing: forVoice && attempt == 1)
        }, onFailure: { attempt, error in
            audio.stop()
            voiceLogger.error("Audio capture start failed, attempt \(attempt): \(String(describing: error), privacy: .public)")
        }, onReady: onReady)
    }
    func recoverVoiceConnection() {
        guard voiceRecovery == nil, capture != nil, !endingVoice, let id = voiceID else { return }
        let epoch = voiceGeneration
        let lostAt = Date()
        audioSends.removeAll()
        voiceLogger.info("Voice: iPhone unreachable, waiting up to \(Int(WatchVoiceRecovery.reconnectGraceSeconds)) s")
        voiceRecovery = Task { [weak self] in
            guard let self else { return }
            let failure: Error?
            do {
                try await WatchVoiceRecovery.reconnect { timeout in
                    _ = try await self.connection.request(.init(action: .voiceHeartbeat, itemID: id.uuidString),
                                                          waitForReadiness: false, timeout: timeout)
                }
                failure = nil
            } catch is CancellationError { return }
            catch { failure = error }
            guard !Task.isCancelled, self.voiceGeneration == epoch, self.voiceID == id else { return }
            self.voiceRecovery = nil
            let gapMs = Int(Date().timeIntervalSince(lostAt) * 1_000)
            if let failure {
                self.voiceLogger.error("Voice: iPhone reconnection failed after \(gapMs) ms: \(String(describing: failure), privacy: .public)")
                let message = (failure as? WatchFailure) == .invalidRequest
                    ? "Voice ended while the iPhone was out of reach."
                    : self.voiceFailureMessage(failure)
                self.stopLocalVoice(state: "Disconnected", captureEndReason: "companion_disconnected")
                self.audioFailure = .init(message: message, action: .voice)
            } else {
                self.voiceLogger.info("Voice: iPhone reachable again after \(gapMs) ms")
                self.audioBackpressure.progressed(at: Date())
            }
        }
    }
    private func stopLocalVoice(state: String, captureEndReason: String = "cancelled") {
        voiceRecovery?.cancel(); voiceRecovery = nil
        cancelRouteRecovery()
        endingVoice = false
        voiceGeneration = UUID()
        if capture != nil { recordCaptureEnd(captureEndReason) }
        capture?.cancel(); capture = nil; heartbeat?.cancel(); heartbeat = nil
        audioSends.removeAll()
        audio.stop(); voiceID = nil; voiceState = state; muted = false
        // The shared conversation can already contain the complete turn when the live link ends mid-caption.
        Task { await history() }
    }
    private func beginLocalVoiceEnd(captureEndReason: String) {
        voiceRecovery?.cancel(); voiceRecovery = nil
        cancelRouteRecovery()
        endingVoice = true
        if capture != nil { recordCaptureEnd(captureEndReason) }
        heartbeat?.cancel(); heartbeat = nil
        audioSends.removeAll()
        audio.stop(); voiceState = "Ending…"; muted = false
    }
    func handleVoiceAudioInterruption(reason: UInt?) {
        let detail: String
        switch reason {
        case 1: detail = "audio_interrupted_app_suspended"
        case 2: detail = "audio_interrupted_microphone_muted"
        default: detail = "audio_interrupted"
        }
        failVoice("Voice was interrupted. Try again when audio is available.", reason: detail)
    }
    func handleAudioRouteChange(reason: UInt? = nil, changedEngine: AVAudioEngine? = nil) {
        let voice = voiceID != nil && !endingVoice
        guard voice || dictationState == .listening,
              audioRouteRecovery == nil, audio.needsRouteRecovery(changedEngine: changedEngine) else { return }
        let epoch = voice ? voiceGeneration : dictationGeneration
        audioRouteRecovery = Task { @MainActor [weak self] in
            guard let self else { return }
            let isCurrent: @MainActor @Sendable () -> Bool = {
                guard !Task.isCancelled else { return false }
                if voice { return self.voiceGeneration == epoch && !self.endingVoice }
                return self.dictationGeneration == epoch && self.dictationState == .listening
            }
            defer {
                if isCurrent() {
                    self.audioRouteRecovery = nil
                    self.repairingAudio = false
                }
            }
            do {
                let buffers = self.audio.capturedBuffers
                try await Task.sleep(for: WatchVoiceRecovery.RouteBudget.settleDelay)
                guard isCurrent() else { return }
                let needsRestart = self.audio.needsRouteRecovery(buffersBeforeSettling: buffers)
                switch self.audioRouteBudget.decide(needsRestart: needsRestart) {
                case .unchanged: return
                case .exhausted:
                    self.failRouteRecovery(voice: voice, reason: "audio_route_recovery_limit")
                    return
                case .restart: break
                }
                self.repairingAudio = true
                self.voiceLogger.info("Audio route recovery: reason=\(reason.map { String($0) } ?? "engine_configuration", privacy: .public)")
                try await WatchVoiceRecovery.startCapture(isCurrent: isCurrent, start: { attempt in
                    try self.audio.recoverRoute(attempt: attempt)
                }, onFailure: { attempt, error in
                    self.voiceLogger.error("Audio route restart failed, attempt \(attempt): \(String(describing: error), privacy: .public)")
                })
                guard isCurrent() else { return }
                if voice {
                    self.captureLevel = WatchCaptureLevel()
                    self.audioBackpressure.progressed(at: Date())
                }
                self.voiceLogger.info("Audio route recovered")
            } catch {
                guard isCurrent() else { return }
                self.failRouteRecovery(voice: voice, reason: "audio_route_restart_failed")
            }
        }
    }
    private func failRouteRecovery(voice: Bool, reason: String) {
        voiceLogger.error("Audio route recovery failed: \(reason, privacy: .public)")
        if voice { failVoice("Audio changed and voice couldn’t reconnect.", reason: reason) }
        else { failDictation("Audio changed and dictation couldn’t continue. Tap Message to type instead.") }
    }
    private func cancelRouteRecovery() {
        audioRouteRecovery?.cancel()
        audioRouteRecovery = nil
        audioRouteBudget = WatchVoiceRecovery.RouteBudget()
        repairingAudio = false
    }
    private func voiceFailureMessage(_ failure: Error) -> String {
        switch failure as? WatchFailure {
        case .unavailable: "The Watch couldn’t reach your iPhone. Keep it nearby."
        case .network: "Voice lost its network connection. Check your connection."
        case .signInRequired: WatchFailure.signInRequired.message
        case .busy: "The iPhone is already using voice or dictation."
        default: "Voice couldn’t connect. Check Jarvis on your iPhone."
        }
    }
    private func setVoiceFailure(_ failure: Error) {
        audioFailure = .init(message: voiceFailureMessage(failure), action: .voice)
    }
    private func failVoice(_ message: String, reason: String) {
        guard voiceID != nil, !endingVoice else { return }
        audioFailure = .init(message: message, action: .voice)
        let epoch = voiceGeneration
        Task {
            guard epoch == voiceGeneration else { return }
            await endVoice(captureEndReason: reason)
        }
    }
    func retryAudio() async {
        switch audioFailure?.action {
        case .dictation: await startDictation()
        case .voice: await startVoice()
        case nil: break
        }
    }
    private func recordCaptureEnd(_ reason: String) {
        guard capture != nil, !captureTerminationLogged else { return }
        captureTerminationLogged = true
        voiceLogger.error("Voice capture ended: \(reason, privacy: .public)")
    }
    private func receive(_ event: WatchEvent) {
        if event.requestID == turn {
            if let index = messages.firstIndex(where: { $0.id == replyID }) {
                switch event.kind {
                case .chatDelta:
                    if messages[index].text == "Working…" { messages[index].text = "" }
                    messages[index].text = String((messages[index].text + (event.text ?? "")).prefix(8_000))
                case .chatDone: messages[index].text = event.text ?? ""; busy = false; turn = nil
                case .chatError: error = event.text; busy = false; turn = nil
                default: break
                }
                if !busy { Task { await routePendingReplyIfPossible() } }
            }
        }
        guard event.requestID == voiceID else { return }
        guard seenVoiceDeliveryIDs.insert(event.deliveryID).inserted else { return }
        if seenVoiceDeliveryIDs.count > 8_192 {
            seenVoiceDeliveryIDs.removeAll(keepingCapacity: true)
            seenVoiceDeliveryIDs.insert(event.deliveryID)
        }
        switch event.kind {
        case .voiceState:
            if let muted = event.muted { self.muted = muted }
            if event.text == "Audio connection unavailable" {
                stopLocalVoice(state: "Disconnected", captureEndReason: "playback_link_stalled")
                audioFailure = .init(message: "The iPhone audio connection stopped responding.", action: .voice)
            } else if event.text == "Ended" {
                let unexpected = !endingVoice
                stopLocalVoice(state: "Ended", captureEndReason: "phone_ended")
                if unexpected, audioFailure == nil {
                    audioFailure = .init(message: "The voice session ended on the iPhone.", action: .voice)
                }
            } else if event.text == "End failed" || event.text == "Disconnected" {
                stopLocalVoice(state: "Disconnected", captureEndReason: "phone_end_failed")
                if audioFailure == nil {
                    audioFailure = .init(message: "The voice connection to the iPhone ended.", action: .voice)
                }
            }
            else if event.marksPlaybackEnd { audio.finishPlayback(responseID: event.responseID) }
            else { voiceState = event.text ?? "" }
        case .voiceAudio:
            guard !endingVoice, !repairingAudio else { return }
            do { try audio.enqueuePlayback(event.text ?? "", responseID: event.responseID) }
            catch { failVoice("The Watch couldn’t play the reply.", reason: "playback_failed") }
        case .voiceTranscript:
            let id = event.responseID ?? event.requestID.uuidString
            if let index = messages.lastIndex(where: { $0.id == id && $0.role == .jarvis }) {
                messages[index].text += event.text ?? ""
            }
            else { messages.append(.init(id: id, role: .jarvis, text: event.text ?? "")) }
        case .voiceUserTranscriptDelta:
            let id = event.responseID ?? event.requestID.uuidString
            if let index = messages.lastIndex(where: { $0.id == id && $0.role == .dan }) {
                messages[index].text += event.text ?? ""
            } else {
                messages.append(.init(id: id, role: .dan, text: event.text ?? ""))
            }
        case .voiceUserTranscript:
            let id = event.responseID ?? UUID().uuidString
            if let index = messages.lastIndex(where: { $0.id == id && $0.role == .dan }) {
                messages[index].text = event.text ?? ""
            } else {
                messages.append(.init(id: id, role: .dan, text: event.text ?? ""))
            }
        case .interrupt: audio.stopPlayback()
        default: break
        }
    }
    func show(_ error: Error) {
        if let failure = error as? WatchFailure, failure == .unavailable {
            self.error = "iPhone unavailable. Keep it nearby and try again."
        } else {
            self.error = (error as? WatchFailure)?.message ?? "Request failed. Check Jarvis on your iPhone."
        }
    }
}
