import AVFoundation
import Combine
import JarvisCore
import Speech

enum ChatDictationFailure: Error, Equatable {
    case speechPermission
    case microphonePermission
    case unavailable
    case audioSession
    case recognition
    case cancelled
}

@MainActor
final class ChatDictationController: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var isPreparing = false
    @Published private(set) var draft = ""
    @Published var failure: ChatDictationFailure?

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var generation = UUID()

    func start(language: JarvisAppLanguage, initialDraft: String) async throws {
        guard !isRecording, !isPreparing else { return }
        let currentGeneration = UUID()
        generation = currentGeneration
        isPreparing = true
        failure = nil
        defer {
            if generation == currentGeneration { isPreparing = false }
        }

        let authorization = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard generation == currentGeneration else { throw ChatDictationFailure.cancelled }
        guard authorization == .authorized else { throw ChatDictationFailure.speechPermission }
        guard await VoiceAudioEngine.requestMicrophonePermission() else {
            throw ChatDictationFailure.microphonePermission
        }
        guard generation == currentGeneration else { throw ChatDictationFailure.cancelled }

        let locale = Locale(identifier: language == .da ? "da-DK" : "en-GB")
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            throw ChatDictationFailure.unavailable
        }

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement)
            try audioSession.setActive(true)
        } catch {
            try? audioSession.setActive(false, options: [.notifyOthersOnDeactivation])
            throw ChatDictationFailure.audioSession
        }

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            try? audioSession.setActive(false, options: [.notifyOthersOnDeactivation])
            throw ChatDictationFailure.audioSession
        }
        input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            try? audioSession.setActive(false, options: [.notifyOthersOnDeactivation])
            throw ChatDictationFailure.audioSession
        }

        audioEngine = engine
        recognitionRequest = request
        draft = initialDraft
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let transcript = result?.bestTranscription.formattedString
            let isComplete = result?.isFinal == true || error != nil
            Task { @MainActor [weak self] in
                guard let self, self.generation == currentGeneration else { return }
                if let transcript, !transcript.isEmpty {
                    let separator = initialDraft.isEmpty || initialDraft.last?.isWhitespace == true ? "" : " "
                    self.draft = initialDraft + separator + transcript
                }
                if isComplete {
                    if error != nil { self.failure = .recognition }
                    self.stop()
                }
            }
        }
        isRecording = true
    }

    func stop() {
        generation = UUID()
        isPreparing = false
        isRecording = false
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        let shouldDeactivateAudioSession = audioEngine != nil
        if let audioEngine {
            audioEngine.inputNode.removeTap(onBus: 0)
            audioEngine.stop()
            self.audioEngine = nil
        }
        if shouldDeactivateAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }
}
