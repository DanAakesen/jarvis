import Combine
import AVFoundation
import Foundation
import JarvisCore
import OSLog

@MainActor
final class WatchModel: ObservableObject {
    struct Message: Identifiable { var id = UUID().uuidString; var user: Bool; var text: String }
    enum DictationState { case idle, connecting, listening, finishing }
    @Published var messages: [Message] = []
    @Published private var composer = WatchComposer()
    var draft: String {
        get { composer.draft }
        set { composer.draft = newValue }
    }
    @Published var busy = false
    @Published var error: String?
    @Published private(set) var historyError: String?
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
    private var heartbeat: Task<Void, Never>?
    private var historyRequest = UUID()
    private var turn: UUID?
    private var replyID: String?
    private var voiceGeneration = UUID()
    private var voiceStartToken: UUID?
    private var voiceRecovery: Task<Void, Never>?
    private var dictationGeneration = UUID()
    private var dictationID: UUID?
    private var dictationCapture: Task<Bool, Never>?
    private var dictationTimeout: Task<Void, Never>?
    private let transcriptionDeadline = WatchDictationDeadline()
    private var dictationAudio = Data()
    private var dictationTranscription: Task<String, Error>?
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            messages = [.init(user: true, text: "What should I train today?"), .init(user: false, text: "Upper body: bench press, rows and shoulder press."), .init(user: true, text: "What weight for bench?"), .init(user: false, text: "Your last entry was 60 kg for 8 reps.")]
            if let state = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--watch-voice-fixture=") }) {
                voiceID = UUID(); muted = state.hasSuffix("muted")
                voiceState = state.hasSuffix("speaking") ? "Speaking" : "Listening"
                messages = [.init(user: false, text: state.hasSuffix("listening") ? "Your next meeting starts at 10:30." : "You have time to review your notes.")]
            }
            if ProcessInfo.processInfo.arguments.contains("--watch-chat-long") {
                messages = [.init(user: false, text: "Hello Dan, nice to be talking with you."), .init(user: true, text: "What is next today?"),
                            .init(user: false, text: "Your next meeting starts at 10:30. You have time to review the notes before you leave."),
                            .init(user: false, text: "I can help you prepare."), .init(user: false, text: "Would you like me to summarise them?")]
            }
        }
        #endif
        connection.onEvent = { [weak self] in self?.receive($0) }
        connection.onSignOut = { [weak self] in
            guard let self else { return }
            let active = self.dictationState != .idle
            self.cancelDictation()
            if active { self.error = WatchFailure.signInRequired.message + " Tap Message to type." }
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
    private func configurePlaybackCompletion() {
        audio.setPlaybackFinishedHandler { [weak self] responseID, audible in
            Task { @MainActor in
                guard let self, let id = self.voiceID else { return }
                _ = try? await self.connection.request(.init(action: .playbackCompleted, text: id.uuidString, itemID: responseID, flag: audible))
            }
        }
    }
    func history() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") { return }
        #endif
        guard !busy, !startingVoice, voiceID == nil, connection.reachable else { return }
        let read = UUID(); historyRequest = read
        historyError = nil
        do {
            let history: [WatchHistoryMessage] = try await connection.load(.history)
            guard read == historyRequest, !busy, voiceID == nil else { return }
            messages = history.map { Message(id: $0.id, user: $0.user, text: $0.text) }
        } catch {
            guard read == historyRequest, !busy, voiceID == nil else { return }
            historyError = (error as? WatchFailure)?.message ?? "History could not refresh. Check Jarvis on your iPhone."
        }
    }
    func send() async {
        guard !busy, !startingVoice, voiceID == nil, dictationState == .idle, let text = composer.beginSend() else { return }
        historyRequest = UUID(); historyError = nil
        let request = WatchRequest(action: .sendTurn, text: text)
        busy = true; error = nil; turn = request.id
        let responseID = UUID().uuidString; replyID = responseID
        messages.append(.init(user: true, text: text)); messages.append(.init(id: responseID, user: false, text: "Working…"))
        do {
            _ = try await connection.request(request)
            composer.finishSend(success: true)
        } catch {
            busy = false; turn = nil; composer.finishSend(success: false)
            messages.removeAll { $0.id == responseID }
            show(error)
        }
    }
    func startVoice() async {
        guard !startingVoice, !busy, dictationState == .idle else { return }
        historyRequest = UUID(); historyError = nil
        let token = UUID(); voiceStartToken = token
        startingVoice = true; error = nil
        let startedAt = Date()
        // A cancelled start clears these itself, so a late finish cannot reset a newer attempt.
        defer {
            if voiceStartToken == token { voiceStartToken = nil; startingVoice = false; waitingForVoiceConnection = false }
        }
        func elapsedMs() -> Int { Int(Date().timeIntervalSince(startedAt) * 1_000) }
        do {
            if try await hasActiveVoice() { return }
        } catch is CancellationError { return }
        catch { show(error); return }
        let epoch = UUID(); voiceGeneration = epoch
        guard await VoiceAudioEngine.requestMicrophonePermission() else { error = "Allow microphone access in Settings."; return }
        guard epoch == voiceGeneration else { return }
        do {
            waitingForVoiceConnection = true
            try await connection.waitForVoiceConnection(timeout: 15)
            waitingForVoiceConnection = false
            guard epoch == voiceGeneration else { return }
            voiceLogger.info("Voice start: phone reachable after \(elapsedMs()) ms")
            let request = WatchRequest(action: .startVoice, flag: true)
            // Accept early state events while the phone opens the socket.
            voiceID = request.id; voiceState = "Connecting"
            var reply: WatchReply?
            var attempt = 1
            while reply == nil {
                do { reply = try await connection.request(request) }
                catch {
                    // The phone answers a repeated request ID from its reply cache or reports busy, so a quick failure is safe to repeat.
                    guard epoch == voiceGeneration else { return }
                    guard WatchVoiceRecovery.shouldRetryStart(error, attempt: attempt, elapsed: Date().timeIntervalSince(startedAt)) else { throw error }
                    voiceLogger.info("Voice start retry \(attempt) after \(elapsedMs()) ms: \(String(describing: error), privacy: .public)")
                    attempt += 1
                    try await Task.sleep(for: WatchVoiceRecovery.startRetryDelay)
                    guard epoch == voiceGeneration else { return }
                    try await connection.waitForVoiceConnection(timeout: 10)
                }
            }
            waitingForVoiceConnection = false
            guard epoch == voiceGeneration else {
                // Cancelled while the phone was starting; make sure it does not keep a session nobody owns.
                _ = try? await connection.request(.init(action: .endVoice, itemID: request.id.uuidString), waitForReadiness: false)
                return
            }
            guard let result = reply, let data = result.data else { throw WatchFailure.failed }
            voiceLogger.info("Voice start: phone session ready after \(elapsedMs()) ms, attempts=\(attempt)")
            voiceID = try JSONDecoder().decode(UUID.self, from: data)
            let pipeline = result.voicePipeline == true
            let audioStreamID = request.id.uuidString
            configurePlaybackCompletion()
            let stream: AsyncStream<Data>
            do {
                stream = try await startAudioCapture(tolerateDrops: true) { self.voiceGeneration == epoch }
            } catch {
                // A cancelled start must not report an error or touch a newer attempt's audio.
                guard epoch == voiceGeneration else { return }
                voiceLogger.error("Voice capture could not start: \(String(describing: error), privacy: .public)")
                self.error = NSLocalizedString("Microphone audio could not start. Try voice again.", comment: "")
                await endVoice(captureEndReason: "capture_start_error")
                return
            }
            captureTerminationLogged = false
            audioBackpressure = WatchVoiceBackpressure(now: Date()); lastAudioMetrics = Date()
            audioSequence = 0
            capture = Task { [weak self] in
                var batch = Data()
                for await bytes in stream {
                    guard let self else { return }
                    guard !Task.isCancelled, self.voiceGeneration == epoch,
                          let id = self.voiceID else {
                        self.recordCaptureEnd(self.voiceGeneration == epoch ? "cancelled" : "session_cancelled")
                        return
                    }
                    if self.muted || self.voiceRecovery != nil {
                        batch.removeAll(keepingCapacity: true)
                        self.audioBackpressure.progressed(at: Date())
                        continue
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
                                    self.voiceLogger.info("Voice link: rtt_ms=\(milliseconds) in_flight=\(self.audioSends.count) packet_drops=\(self.audioBackpressure.drops) capture_drops=\(self.audio.droppedCaptureChunks)")
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
                        self.error = "Voice stopped because the iPhone audio connection was unavailable. Try again."
                        await self.endVoice(captureEndReason: "audio_link_stalled")
                        return
                    }
                }
                guard let self else { return }
                guard !Task.isCancelled, self.voiceGeneration == epoch, self.voiceID != nil else {
                    self.recordCaptureEnd(self.voiceGeneration == epoch ? "cancelled" : "session_cancelled")
                    return
                }
                self.recordCaptureEnd("capture_stream_ended")
                self.error = NSLocalizedString("Audio capture stopped unexpectedly. Tap the voice icon to try again.", comment: "")
                await self.endVoice()
            }
            heartbeat = Task { [weak self] in
                var failureSince: Date?
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, !Task.isCancelled, self.voiceID != nil else { return }
                    if self.voiceRecovery != nil { continue }
                    if !self.muted && !self.audioBackpressure.stalled(at: Date()) {
                        failureSince = nil
                        continue
                    }
                    do {
                        guard try await self.hasActiveVoice() else { return }
                        failureSince = nil
                    } catch {
                        guard self.voiceGeneration == epoch else { return }
                        if failureSince == nil { failureSince = Date() }
                        if let failureSince, Date().timeIntervalSince(failureSince) >= 5 {
                            await self.endVoice(); self.show(error); return
                        }
                    }
                }
            }
        } catch {
            guard epoch == voiceGeneration else { return }
            show(error)
            await endVoice(captureEndReason: "startup_failed")
        }
    }
    func startDictation() async {
        guard dictationState == .idle, voiceID == nil, !busy, !startingVoice else { return }
        let epoch = UUID()
        dictationGeneration = epoch
        dictationState = .connecting
        error = nil
        guard await VoiceAudioEngine.requestMicrophonePermission() else {
            if dictationGeneration == epoch {
                cancelDictation()
                error = "Allow microphone access in Settings, or tap Message to type."
            }
            return
        }
        guard dictationGeneration == epoch else { return }
        do {
            dictationAudio.removeAll()
            let stream = try await startAudioCapture(tolerateDrops: false) { self.dictationGeneration == epoch }
            dictationState = .listening
            dictationCapture = Task { [weak self] in
                for await bytes in stream {
                    guard let self, self.dictationGeneration == epoch, !Task.isCancelled else { return false }
                    guard self.dictationAudio.count + bytes.count <= WatchLimits.dictationBytes else {
                        self.failDictation(WatchFailure.invalidRequest)
                        return false
                    }
                    self.dictationAudio.append(bytes)
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
            if dictationGeneration == epoch { failDictation(error) }
        }
    }
    func stopDictation() async {
        guard dictationState == .listening else { return }
        let epoch = dictationGeneration
        dictationState = .finishing
        dictationTimeout?.cancel(); dictationTimeout = nil
        transcriptionDeadline.start { [weak self] in
            guard let self, self.dictationGeneration == epoch, self.dictationState == .finishing else { return }
            self.cancelDictation()
            self.error = WatchDictationError.timedOut.message
        }
        audio.stop()
        guard await dictationCapture?.value == true, dictationGeneration == epoch else { return }
        do {
            let recording = dictationAudio
            dictationAudio.removeAll()
            let task = Task { try await transcribeDictation(recording, epoch: epoch) }
            dictationTranscription = task
            let text = try await task.value
            guard dictationGeneration == epoch else { return }
            guard !text.isEmpty else { throw WatchFailure.failed }
            draft = draft.isEmpty ? text : draft + " " + text
            transcriptionDeadline.cancel()
            dictationID = nil; dictationCapture = nil; dictationTranscription = nil; dictationState = .idle
        } catch {
            if dictationGeneration == epoch { failDictation(error) }
        }
    }
    private func transcribeDictation(_ recording: Data, epoch: UUID) async throws -> String {
        guard !recording.isEmpty else { throw WatchFailure.failed }
        let direct: (@MainActor () async throws -> String)?
        do {
            if connection.credentialStorageFailed { throw WatchFailure.credentialStorage }
            if try WatchDirectDictation.credential() != nil {
                direct = { try await WatchDirectDictation.transcribe(recording) }
            } else { direct = nil }
        } catch { direct = { throw error } }
        // A slow direct request leaves the phone most of the overall deadline; without a reachable phone it keeps the full window.
        return try await WatchDictationRouting.transcribe(direct: direct, phone: {
            try await self.transcribeViaPhone(recording, epoch: epoch)
        }, directWindow: connection.reachable
            ? WatchDictationDeadline.directWithPhoneFallbackDuration : WatchDictationDeadline.directDuration)
    }
    private func transcribeViaPhone(_ recording: Data, epoch: UUID) async throws -> String {
        try Task.checkCancellation()
        guard dictationGeneration == epoch else { throw CancellationError() }
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
        let result = try await connection.request(.init(action: .finishDictation, itemID: request.id.uuidString))
        guard let data = result.data else { throw WatchFailure.failed }
        return try JSONDecoder().decode(String.self, from: data).trimmingCharacters(in: .whitespacesAndNewlines)
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
        audio.stop()
        if let id {
            Task { _ = try? await connection.request(.init(action: .cancelDictation, itemID: id.uuidString)) }
        }
    }
    func interruptDictation() {
        guard dictationState != .idle else { return }
        cancelDictation()
        error = "Dictation stopped. Try again, or tap Message to type."
    }
    private func failDictation(_ failure: Error) {
        cancelDictation()
        if let failure = failure as? WatchDictationError { error = failure.message; return }
        error = "Dictation failed. " + ((failure as? WatchFailure)?.message ?? "Try again.") + " Tap Message to type."
    }
    private func hasActiveVoice() async throws -> Bool {
        guard let id = voiceID else { return false }
        let epoch = voiceGeneration
        do {
            _ = try await connection.request(.init(action: .voiceHeartbeat, itemID: id.uuidString))
            guard epoch == voiceGeneration else { throw CancellationError() }
            return true
        } catch WatchFailure.invalidRequest {
            guard epoch == voiceGeneration else { throw CancellationError() }
            stopLocalVoice(state: "Ended", captureEndReason: "phone_session_ended")
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
        let id = voiceID
        stopLocalVoice(state: "Ended", captureEndReason: captureEndReason)
        guard let id else { return }
        do { _ = try await connection.request(.init(action: .endVoice, itemID: id.uuidString), waitForReadiness: false) }
        catch {
            if self.error == nil { self.error = "Audio stopped. The iPhone session will expire if unreachable." }
        }
    }
    func cancelVoiceStart() async {
        guard startingVoice else { return }
        voiceLogger.info("Voice start cancelled by the user")
        voiceStartToken = nil; startingVoice = false; waitingForVoiceConnection = false
        await endVoice(captureEndReason: "start_cancelled")
    }
    private func startAudioCapture(tolerateDrops: Bool, isCurrent: () -> Bool) async throws -> AsyncStream<Data> {
        // The first activation of the audio session can fail while the route settles.
        // Currency is checked before every start so a cancelled caller never touches the shared engine.
        var attempt = 1
        while true {
            guard isCurrent() else { throw CancellationError() }
            do { return try audio.startCapture(tolerateDrops: tolerateDrops) }
            catch {
                guard isCurrent() else { throw CancellationError() }
                audio.stop()
                guard attempt < 3 else { throw error }
                voiceLogger.error("Audio capture start failed, attempt \(attempt): \(String(describing: error), privacy: .public)")
                attempt += 1
                try await Task.sleep(for: .milliseconds(300))
            }
        }
    }
    private func recoverVoiceConnection() {
        guard voiceRecovery == nil, let id = voiceID else { return }
        let epoch = voiceGeneration
        let resumeState = voiceState
        let lostAt = Date()
        voiceState = "Reconnecting to iPhone…"
        voiceLogger.info("Voice: iPhone unreachable, waiting up to \(Int(WatchVoiceRecovery.reconnectGraceSeconds)) s")
        voiceRecovery = Task { [weak self] in
            guard let self else { return }
            var recovered = false
            var phoneEnded = false
            do {
                try await self.connection.waitForVoiceConnection(timeout: WatchVoiceRecovery.reconnectGraceSeconds)
                _ = try await self.connection.request(.init(action: .voiceHeartbeat, itemID: id.uuidString), waitForReadiness: false)
                recovered = true
            } catch is CancellationError { return }
            catch { phoneEnded = (error as? WatchFailure) == .invalidRequest }
            guard !Task.isCancelled, self.voiceGeneration == epoch, self.voiceID == id else { return }
            self.voiceRecovery = nil
            let gapMs = Int(Date().timeIntervalSince(lostAt) * 1_000)
            if recovered {
                self.voiceLogger.info("Voice: iPhone reachable again after \(gapMs) ms")
                self.audioBackpressure = WatchVoiceBackpressure(now: Date())
                if self.voiceState == "Reconnecting to iPhone…" { self.voiceState = resumeState }
                return
            }
            self.voiceLogger.error("Voice: iPhone still unreachable after \(gapMs) ms, phone_ended=\(phoneEnded)")
            _ = self.composer.handleConnectionLoss(hasInFlightTurn: self.turn != nil, hasVoiceSession: true)
            self.stopLocalVoice(state: "Disconnected", captureEndReason: "companion_disconnected")
            self.busy = false; self.turn = nil
            if self.error == nil {
                self.error = phoneEnded
                    ? NSLocalizedString("Voice ended while the iPhone was out of reach. Tap the voice icon to start again.", comment: "")
                    : NSLocalizedString("Voice stopped because the iPhone companion disconnected. Reconnect and try again.", comment: "")
            }
        }
    }
    private func stopLocalVoice(state: String, captureEndReason: String = "cancelled") {
        voiceRecovery?.cancel(); voiceRecovery = nil
        voiceGeneration = UUID()
        if capture != nil { recordCaptureEnd(captureEndReason) }
        capture?.cancel(); capture = nil; heartbeat?.cancel(); heartbeat = nil
        audioSends.removeAll()
        audio.stop(); voiceID = nil; voiceState = state; muted = false
    }
    func handleVoiceAudioInterruption(reason: UInt?) {
        let detail: String
        switch reason {
        case 1: detail = "audio_interrupted_app_suspended"
        case 2: detail = "audio_interrupted_microphone_muted"
        default: detail = "audio_interrupted"
        }
        stopVoice(reason: detail, message: "Voice stopped because audio was interrupted. Try again when audio is available.")
    }
    func handleVoiceAudioRouteChange(reason: UInt?) {
        guard capture != nil else { return }
        let detail = reason.map { "audio_route_changed_\($0)" } ?? "audio_route_changed"
        stopVoice(reason: detail, message: "Voice stopped because the audio route changed. Tap the voice icon to try again.")
    }
    private func stopVoice(reason: String, message: String) {
        guard voiceID != nil else { return }
        recordCaptureEnd(reason)
        error = NSLocalizedString(message, comment: "")
        Task { await endVoice(captureEndReason: reason) }
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
            }
        }
        guard event.requestID == voiceID else { return }
        switch event.kind {
        case .voiceState:
            if let muted = event.muted { self.muted = muted }
            if event.text == "Audio connection unavailable" {
                stopLocalVoice(state: "Ended", captureEndReason: "playback_link_stalled")
                error = "Voice stopped because the iPhone audio connection was unavailable. Try again."
            } else if event.text == "Ended" || event.text == "Disconnected" {
                stopLocalVoice(state: event.text ?? "Ended", captureEndReason: event.text == "Disconnected" ? "phone_disconnected" : "phone_ended")
            }
            else if event.text == "Playback finished" { audio.finishPlayback(responseID: event.responseID) }
            else { voiceState = event.text ?? "" }
        case .voiceAudio:
            do { try audio.enqueuePlayback(event.text ?? "", responseID: event.responseID) }
            catch { Task { await endVoice() }; show(error) }
        case .voiceTranscript:
            let id = event.responseID ?? event.requestID.uuidString
            if let index = messages.lastIndex(where: { $0.id == id && !$0.user }) {
                messages[index].text += event.text ?? ""
            }
            else { messages.append(.init(id: id, user: false, text: event.text ?? "")) }
        case .voiceUserTranscriptDelta:
            let id = event.responseID ?? event.requestID.uuidString
            if let index = messages.lastIndex(where: { $0.id == id && $0.user }) {
                messages[index].text += event.text ?? ""
            } else {
                messages.append(.init(id: id, user: true, text: event.text ?? ""))
            }
        case .voiceUserTranscript:
            let id = event.responseID ?? UUID().uuidString
            if let index = messages.lastIndex(where: { $0.id == id && $0.user }) {
                messages[index].text = event.text ?? ""
            } else {
                messages.append(.init(id: id, user: true, text: event.text ?? ""))
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
