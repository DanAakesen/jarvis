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
    @Published var muted = false
    @Published private(set) var dictationState: DictationState = .idle
    let connection = WatchConnection.shared
    private let audio = VoiceAudioEngine()
    private let voiceLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Jarvis", category: "WatchVoice")
    private var capture: Task<Void, Never>?
    private var captureTerminationLogged = false
    private var heartbeat: Task<Void, Never>?
    private var historyRequest = UUID()
    private var turn: UUID?
    private var replyID: String?
    private var voiceGeneration = UUID()
    private var dictationGeneration = UUID()
    private var dictationID: UUID?
    private var dictationCapture: Task<Bool, Never>?
    private var dictationTimeout: Task<Void, Never>?
    private var dictationAudio = Data()
    private var dictationTranscription: Task<String, Error>?
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            messages = [.init(user: true, text: "What should I train today?"), .init(user: false, text: "Upper body: bench press, rows and shoulder press."), .init(user: true, text: "What weight for bench?"), .init(user: false, text: "Your last entry was 60 kg for 8 reps.")]
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
            let hadVoiceSession = self.voiceID != nil
            guard self.composer.handleConnectionLoss(
                    hasInFlightTurn: self.turn != nil, hasVoiceSession: hadVoiceSession
                  ) else { return }
            self.stopLocalVoice(state: "Disconnected", captureEndReason: "companion_disconnected")
            self.busy = false; self.turn = nil
            if self.error == nil {
                self.error = hadVoiceSession
                    ? NSLocalizedString("Voice stopped because the iPhone companion disconnected. Reconnect and try again.", comment: "")
                    : "iPhone unavailable. Reconnect and check history before sending again."
            }
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
        guard !busy, voiceID == nil, connection.reachable else { return }
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
        guard !busy, voiceID == nil, dictationState == .idle, let text = composer.beginSend() else { return }
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
        guard !busy, dictationState == .idle else { return }
        historyRequest = UUID(); historyError = nil
        busy = true; error = nil
        defer { busy = false; waitingForVoiceConnection = false }
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
            let request = WatchRequest(action: .startVoice)
            // Accept early state events while the phone opens the socket.
            voiceID = request.id; voiceState = "Connecting"
            let result = try await connection.request(request)
            waitingForVoiceConnection = false
            guard epoch == voiceGeneration else { return }
            guard let data = result.data else { throw WatchFailure.failed }
            voiceID = try JSONDecoder().decode(UUID.self, from: data)
            configurePlaybackCompletion()
            let stream: AsyncStream<Data>
            do {
                stream = try audio.startCapture()
            } catch {
                voiceLogger.error("Voice capture could not start: \(String(describing: error), privacy: .public)")
                self.error = NSLocalizedString("Microphone audio could not start. Try voice again.", comment: "")
                await endVoice(captureEndReason: "capture_start_error")
                return
            }
            captureTerminationLogged = false
            capture = Task { [weak self] in
                var batch = Data()
                for await bytes in stream {
                    guard let self else { return }
                    guard !Task.isCancelled, self.voiceGeneration == epoch,
                          let id = self.voiceID else {
                        self.recordCaptureEnd(self.voiceGeneration == epoch ? "cancelled" : "session_cancelled")
                        return
                    }
                    if self.muted { batch.removeAll(keepingCapacity: true); continue }
                    batch.append(bytes)
                    guard batch.count >= 4_800 else { continue } // ~100 ms at 24 kHz PCM16.
                    let packet = batch; batch.removeAll(keepingCapacity: true)
                    do { _ = try await self.connection.request(.init(action: .audio, itemID: id.uuidString, data: packet)) }
                    catch {
                        guard self.voiceGeneration == epoch else { return }
                        self.recordCaptureEnd("audio_send_error")
                        self.show(error); await self.endVoice(); return
                    }
                }
                guard let self else { return }
                guard !Task.isCancelled, self.voiceGeneration == epoch, self.voiceID != nil else {
                    self.recordCaptureEnd(self.voiceGeneration == epoch ? "cancelled" : "session_cancelled")
                    return
                }
                let reason = self.audio.didDropCapture ? "capture_buffer_overflow" : "capture_stream_ended"
                self.recordCaptureEnd(reason)
                if reason == "capture_buffer_overflow" {
                    self.error = NSLocalizedString("Audio capture fell behind. Try starting voice again.", comment: "")
                } else {
                    self.error = NSLocalizedString("Audio capture stopped unexpectedly. Tap the voice icon to try again.", comment: "")
                }
                await self.endVoice()
            }
            heartbeat = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, !Task.isCancelled, self.voiceID != nil else { return }
                    do {
                        guard try await self.hasActiveVoice() else { return }
                    } catch {
                        guard self.voiceGeneration == epoch else { return }
                        await self.endVoice(); self.show(error); return
                    }
                }
            }
        } catch {
            show(error)
            await endVoice(captureEndReason: "startup_failed")
        }
    }
    func startDictation() async {
        guard dictationState == .idle, voiceID == nil, !busy else { return }
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
            let stream = try audio.startCapture()
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
            dictationID = nil; dictationCapture = nil; dictationTranscription = nil; dictationState = .idle
        } catch {
            if dictationGeneration == epoch { failDictation(error) }
        }
    }
    private func transcribeDictation(_ recording: Data, epoch: UUID) async throws -> String {
        guard !recording.isEmpty else { throw WatchFailure.failed }
        let direct: (() async throws -> String)?
        do {
            if connection.credentialStorageFailed { throw WatchFailure.credentialStorage }
            if try WatchDirectDictation.credential() != nil {
                direct = { try await WatchDirectDictation.transcribe(recording) }
            } else { direct = nil }
        } catch { direct = { throw error } }
        return try await WatchDictationRouting.transcribe(direct: direct, phone: {
            try await self.transcribeViaPhone(recording, epoch: epoch)
        }, onDirectFailure: { failure in
            guard self.dictationGeneration == epoch else { throw CancellationError() }
            if failure as? WatchFailure == .signInRequired {
                self.error = "Sign in to Jarvis on your iPhone to refresh direct dictation."
            } else if failure as? WatchFailure == .credentialStorage {
                self.error = WatchFailure.credentialStorage.message
            }
        })
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
        error = ((failure as? WatchFailure)?.message ?? "Dictation failed.") + " Tap Message to type."
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
        guard !busy else { return }
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
    private func stopLocalVoice(state: String, captureEndReason: String = "cancelled") {
        voiceGeneration = UUID()
        if capture != nil { recordCaptureEnd(captureEndReason) }
        capture?.cancel(); capture = nil; heartbeat?.cancel(); heartbeat = nil
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
            if event.text == "Ended" || event.text == "Disconnected" {
                stopLocalVoice(state: event.text ?? "Ended", captureEndReason: event.text == "Disconnected" ? "phone_disconnected" : "phone_ended")
            }
            else if event.text == "Playback finished" { audio.finishPlayback(responseID: event.responseID) }
            else { voiceState = event.text ?? "" }
        case .voiceAudio:
            do { try audio.enqueuePlayback(event.text ?? "", responseID: event.responseID) }
            catch { Task { await endVoice() }; show(error) }
        case .voiceTranscript:
            let id = event.responseID ?? event.requestID.uuidString
            if messages.last?.id == id { messages[messages.count - 1].text += event.text ?? "" }
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
