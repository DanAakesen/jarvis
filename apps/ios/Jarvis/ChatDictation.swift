import AVFoundation
import Foundation
import JarvisCore
import Speech

/// On-device-first speech-to-text for the Chat composer's dictate button.
@MainActor
final class ChatDictation: ObservableObject {
    @Published private(set) var isListening = false
    /// Recent microphone levels (0...1, newest last), refreshed about 20 times a second while listening.
    @Published private(set) var levels = [Float](repeating: 0, count: ChatDictation.levelCount)

    static let levelCount = 48

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognition = DictationSession()

    static func requestAccess() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    /// Streams the transcript through `update`; `base` is the text already in the field.
    func start(locale: Locale, base: String, update: @escaping (String) -> Void) throws {
        stop()
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            throw ChatDictationError.unavailable
        }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request

        let input = engine.inputNode
        input.removeTap(onBus: 0)
        let recognitionID = recognition.start(base: base)
        let meter = LevelMeter { [weak self] level in
            Task { @MainActor in
                guard let self, self.recognition.isActive(recognitionID) else { return }
                self.push(level)
            }
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
            meter.consume(buffer)
        }
        levels = [Float](repeating: 0, count: Self.levelCount)
        engine.prepare()
        do { try engine.start() } catch {
            stop()
            throw error
        }
        isListening = true

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let finished = result?.isFinal == true || error != nil
            Task { @MainActor in
                guard let self, self.recognition.isActive(recognitionID) else { return }
                if let text, let value = self.recognition.update(text, sessionID: recognitionID) {
                    update(value)
                }
                if finished { self.stop() }
            }
        }
    }

    private func push(_ level: Float) {
        guard isListening else { return }
        levels.removeFirst()
        levels.append(level)
    }

    func stop() {
        // Invalidate first: cancellation/endAudio can enqueue one final recognition callback.
        recognition.stop()
        guard isListening || request != nil else { return }
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        isListening = false
        levels = [Float](repeating: 0, count: Self.levelCount)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

enum ChatDictationError: Error {
    case unavailable
}

/// Turns audio buffers into a smoothed 0...1 level, emitted at most every 50 ms. Called on the audio thread.
private final class LevelMeter: @unchecked Sendable {
    private let emit: @Sendable (Float) -> Void
    private var lastEmit = Date.distantPast
    private var smoothed: Float = 0

    init(emit: @escaping @Sendable (Float) -> Void) { self.emit = emit }

    func consume(_ buffer: AVAudioPCMBuffer) {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
        let rms = (sum / Float(buffer.frameLength)).squareRoot()
        let decibels = 20 * log10(max(rms, 0.000_01))
        let level = min(max((decibels + 50) / 50, 0), 1)
        smoothed = max(level, smoothed * 0.7)
        let now = Date()
        guard now.timeIntervalSince(lastEmit) >= 0.05 else { return }
        lastEmit = now
        emit(smoothed)
    }
}
