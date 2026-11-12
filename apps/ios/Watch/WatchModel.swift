import Combine
import AVFoundation
import Foundation
import JarvisCore

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
    private var capture: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var historyRequest = UUID()
    private var turn: UUID?
    private var replyID: String?
    private var voiceGeneration = UUID()
    private var dictationGeneration = UUID()
    private var dictationID: UUID?
    private var dictationCapture: Task<Bool, Never>?
    private var dictationTimeout: Task<Void, Never>?
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            messages = [.init(user: true, text: "What should I train today?"), .init(user: false, text: "Upper body: bench press, rows and shoulder press."), .init(user: true, text: "What weight for bench?"), .init(user: false, text: "Your last entry was 60 kg for 8 reps.")]
        }
        #endif
        connection.onEvent = { [weak self] in self?.receive($0) }
        connection.onDisconnect = { [weak self] in
            guard let self else { return }
            if self.dictationState != .idle { self.failDictation() }
            guard self.composer.handleConnectionLoss(
                    hasInFlightTurn: self.turn != nil, hasVoiceSession: self.voiceID != nil
                  ) else { return }
            self.stopLocalVoice(state: "Disconnected")
            self.busy = false; self.turn = nil
            self.error = "iPhone unavailable. Reconnect and check history before sending again."
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
        guard voiceID == nil, !busy, dictationState == .idle else { return }
        historyRequest = UUID(); historyError = nil
        busy = true; error = nil
        let epoch = UUID(); voiceGeneration = epoch
        defer { busy = false; waitingForVoiceConnection = false }
        guard await VoiceAudioEngine.requestMicrophonePermission() else { error = "Allow microphone access in Settings."; return }
        guard epoch == voiceGeneration else { return }
        do {
            waitingForVoiceConnection = true
            try await connection.waitForVoiceConnection()
            waitingForVoiceConnection = false
            guard epoch == voiceGeneration else { return }
            let request = WatchRequest(action: .startVoice)
            // Accept early state events while the phone opens the socket.
            voiceID = request.id; voiceState = "Connecting"
            let result = try await connection.request(request)
            guard epoch == voiceGeneration else { return }
            guard let data = result.data else { throw WatchFailure.failed }
            voiceID = try JSONDecoder().decode(UUID.self, from: data)
            configurePlaybackCompletion()
            let stream = try audio.startCapture()
            capture = Task { [weak self] in
                var batch = Data()
                for await bytes in stream {
                    guard let self, !Task.isCancelled, let id = self.voiceID else { return }
                    if self.muted { batch.removeAll(keepingCapacity: true); continue }
                    batch.append(bytes)
                    guard batch.count >= 4_800 else { continue } // ~100 ms at 24 kHz PCM16.
                    let packet = batch; batch.removeAll(keepingCapacity: true)
                    do { _ = try await self.connection.request(.init(action: .audio, itemID: id.uuidString, data: packet)) }
                    catch { await self.endVoice(); self.show(error); return }
                }
                if !Task.isCancelled, let self, self.voiceID != nil {
                    await self.endVoice()
                    self.error = "The connection is too slow for voice. Try again near your iPhone."
                }
            }
            heartbeat = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, !Task.isCancelled, let id = self.voiceID else { return }
                    do { _ = try await self.connection.request(.init(action: .voiceHeartbeat, itemID: id.uuidString)) }
                    catch { await self.endVoice(); self.show(error); return }
                }
            }
        } catch { await endVoice(); show(error) }
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
                error = NSLocalizedString("Allow microphone access in Settings, or tap Message to type.", comment: "")
            }
            return
        }
        guard dictationGeneration == epoch else { return }
        let request = WatchRequest(action: .startDictation)
        do {
            try await connection.waitForVoiceConnection()
            guard dictationGeneration == epoch else { return }
            dictationID = request.id
            let reply = try await connection.request(request)
            guard dictationGeneration == epoch else {
                _ = try? await connection.request(.init(action: .cancelDictation, itemID: request.id.uuidString))
                return
            }
            guard let data = reply.data, try JSONDecoder().decode(UUID.self, from: data) == request.id else {
                throw WatchFailure.failed
            }
            let stream = try audio.startCapture()
            dictationState = .listening
            dictationCapture = Task { [weak self] in
                var batch = Data()
                do {
                    for await bytes in stream {
                        guard let self, self.dictationGeneration == epoch, !Task.isCancelled else { return false }
                        batch.append(bytes)
                        if batch.count >= 4_800 {
                            _ = try await self.connection.request(.init(action: .dictationAudio, itemID: request.id.uuidString, data: batch))
                            batch.removeAll(keepingCapacity: true)
                        }
                    }
                    guard let self, self.dictationGeneration == epoch, self.dictationState == .finishing,
                          !self.audio.didDropCapture else {
                        if let self, self.dictationGeneration == epoch { self.failDictation() }
                        return false
                    }
                    if !batch.isEmpty {
                        _ = try await self.connection.request(.init(action: .dictationAudio, itemID: request.id.uuidString, data: batch))
                    }
                    return true
                } catch {
                    if let self, self.dictationGeneration == epoch { self.failDictation() }
                    return false
                }
            }
            dictationTimeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(55))
                guard !Task.isCancelled, let self, self.dictationGeneration == epoch else { return }
                Task { await self.stopDictation() }
            }
        } catch {
            if dictationGeneration == epoch { failDictation() }
        }
    }
    func stopDictation() async {
        guard dictationState == .listening, let id = dictationID else { return }
        let epoch = dictationGeneration
        dictationState = .finishing
        dictationTimeout?.cancel(); dictationTimeout = nil
        audio.stop()
        guard await dictationCapture?.value == true, dictationGeneration == epoch else { return }
        do {
            let reply = try await connection.request(.init(action: .finishDictation, itemID: id.uuidString))
            guard dictationGeneration == epoch else { return }
            guard let data = reply.data else { throw WatchFailure.failed }
            let text = try JSONDecoder().decode(String.self, from: data).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { throw WatchFailure.failed }
            draft = draft.isEmpty ? text : draft + " " + text
            dictationID = nil; dictationCapture = nil; dictationState = .idle
        } catch {
            if dictationGeneration == epoch { failDictation() }
        }
    }
    func cancelDictation() {
        guard dictationState != .idle else { return }
        let id = dictationID
        dictationGeneration = UUID()
        dictationState = .idle; dictationID = nil
        dictationTimeout?.cancel(); dictationTimeout = nil
        dictationCapture?.cancel(); dictationCapture = nil
        audio.stop()
        if let id {
            Task { _ = try? await connection.request(.init(action: .cancelDictation, itemID: id.uuidString)) }
        }
    }
    func interruptDictation() {
        guard dictationState != .idle else { return }
        cancelDictation()
        error = NSLocalizedString("Dictation stopped. Try again, or tap Message to type.", comment: "")
    }
    private func failDictation() {
        cancelDictation()
        error = NSLocalizedString("Dictation unavailable. Connect your iPhone and check the network, or tap Message to type.", comment: "")
    }
    func setMuted() async {
        guard let id = voiceID else { return }
        let next = !muted
        do { _ = try await connection.request(.init(action: .muteVoice, itemID: id.uuidString, flag: next)); muted = next }
        catch { show(error) }
    }
    func endVoice() async {
        let id = voiceID
        stopLocalVoice(state: "Ended")
        guard let id else { return }
        do { _ = try await connection.request(.init(action: .endVoice, itemID: id.uuidString)) }
        catch { self.error = "Audio stopped. The iPhone session will expire if unreachable." }
    }
    private func stopLocalVoice(state: String) {
        voiceGeneration = UUID(); capture?.cancel(); capture = nil; heartbeat?.cancel(); heartbeat = nil
        audio.stop(); voiceID = nil; voiceState = state; muted = false
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
            if event.text == "Ended" || event.text == "Disconnected" { stopLocalVoice(state: event.text ?? "Ended") }
            else if event.text == "Playback finished" { audio.finishPlayback(responseID: event.responseID) }
            else { voiceState = event.text ?? "" }
        case .voiceAudio:
            do { try audio.enqueuePlayback(event.text ?? "", responseID: event.responseID) }
            catch { Task { await endVoice() }; show(error) }
        case .voiceTranscript:
            let id = event.responseID ?? event.requestID.uuidString
            if messages.last?.id == id { messages[messages.count - 1].text = String((messages[messages.count - 1].text + (event.text ?? "")).prefix(8_000)) }
            else { messages.append(.init(id: id, user: false, text: event.text ?? "")) }
        case .voiceUserTranscript:
            messages.append(.init(id: event.responseID ?? UUID().uuidString, user: true, text: event.text ?? ""))
        case .interrupt: audio.stopPlayback()
        default: break
        }
    }
    func show(_ error: Error) {
        if let failure = error as? WatchFailure, failure == .unavailable {
            self.error = NSLocalizedString("iPhone unavailable. Keep it nearby and try again.", comment: "")
        } else {
            self.error = (error as? WatchFailure)?.message ?? "Request failed. Check Jarvis on your iPhone."
        }
    }
}
