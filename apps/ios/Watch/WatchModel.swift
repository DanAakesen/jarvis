import Combine
import AVFoundation
import Foundation
import JarvisCore

@MainActor
final class WatchModel: ObservableObject {
    struct Message: Identifiable { var id = UUID().uuidString; var user: Bool; var text: String }
    @Published var messages: [Message] = []
    @Published private var composer = WatchComposer()
    var draft: String {
        get { composer.draft }
        set { composer.draft = newValue }
    }
    @Published var busy = false
    @Published var error: String?
    @Published var voiceID: UUID?
    @Published var voiceState = ""
    @Published var muted = false
    let connection = WatchConnection()
    private let audio = VoiceAudioEngine()
    private var capture: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var turn: UUID?
    private var replyID: String?
    private var voiceGeneration = UUID()
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            messages = [.init(user: true, text: "What should I train today?"), .init(user: false, text: "Upper body: bench press, rows and shoulder press."), .init(user: true, text: "What weight for bench?"), .init(user: false, text: "Your last entry was 60 kg for 8 reps.")]
        }
        #endif
        connection.onEvent = { [weak self] in self?.receive($0) }
        connection.onDisconnect = { [weak self] in
            guard let self else { return }
            self.stopLocalVoice(state: "Disconnected")
            self.busy = false; self.turn = nil; self.composer.finishSend(success: false)
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
        guard !busy else { return }
        do {
            let history: [ChatHistoryMessage] = try await connection.load(.history)
            messages = history.map { Message(id: $0.id, user: $0.role == .dan, text: $0.text) }
        } catch { show(error) }
    }
    func send() async {
        guard !busy, voiceID == nil, let text = composer.beginSend() else { return }
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
        guard voiceID == nil, !busy else { return }
        busy = true; error = nil
        let epoch = UUID(); voiceGeneration = epoch
        defer { busy = false }
        guard await VoiceAudioEngine.requestMicrophonePermission() else { error = "Allow microphone access in Settings."; return }
        guard epoch == voiceGeneration else { return }
        do {
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
                for await bytes in stream {
                    guard let self, !Task.isCancelled, let id = self.voiceID else { return }
                    if self.muted { continue }
                    do { _ = try await self.connection.request(.init(action: .audio, itemID: id.uuidString, data: bytes)) }
                    catch { await self.endVoice(); self.show(error); return }
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
                    messages[index].text += event.text ?? ""
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
            if messages.last?.id == id { messages[messages.count - 1].text += event.text ?? "" }
            else { messages.append(.init(id: id, user: false, text: event.text ?? "")) }
        case .voiceUserTranscript:
            messages.append(.init(id: event.responseID ?? UUID().uuidString, user: true, text: event.text ?? ""))
        case .interrupt: audio.stopPlayback()
        default: break
        }
    }
    func show(_ error: Error) { self.error = (error as? WatchFailure)?.message ?? "Request failed. Check Jarvis on your iPhone." }
}
