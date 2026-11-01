import AVFoundation
import Foundation
import JarvisCore

final class VoiceAudioEngine: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: Double(VoiceAudioFormat.sampleRate),
        channels: AVAudioChannelCount(VoiceAudioFormat.channels),
        interleaved: false
    )!
    private let lock = NSLock()
    private var converter: AVAudioConverter?
    private var captureContinuation: AsyncStream<Data>.Continuation?
    private var playbackProgress: [String: PlaybackProgress] = [:]
    private var playbackFinished: (@Sendable (String, Bool) -> Void)?
    private var hasCaptureTap = false

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: targetFormat)
    }

    static func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    func startCapture() throws -> AsyncStream<Data> {
        try configureSession()
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0,
              let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw VoiceAudioEngineError.captureUnavailable
        }
        self.converter = converter
        let stream = AsyncStream<Data>(bufferingPolicy: .bufferingOldest(16)) { continuation in
            lock.lock()
            captureContinuation = continuation
            lock.unlock()
        }
        input.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { [weak self] buffer, _ in
            guard let self, let data = self.convert(buffer) else { return }
            self.lock.lock()
            let continuation = self.captureContinuation
            self.lock.unlock()
            continuation?.yield(data)
        }
        hasCaptureTap = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            hasCaptureTap = false
            lock.lock()
            captureContinuation?.finish()
            captureContinuation = nil
            lock.unlock()
            throw error
        }
        return stream
    }

    func setPlaybackFinishedHandler(_ handler: @escaping @Sendable (String, Bool) -> Void) {
        lock.lock()
        playbackFinished = handler
        lock.unlock()
    }

    func enqueuePlayback(_ base64: String, responseID: String?) throws {
        let bytes = try VoiceAudioCodec.decodePCM16(base64)
        let frameCount = AVAudioFrameCount(bytes.count / MemoryLayout<Int16>.size)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCount),
              let channel = buffer.floatChannelData?[0] else {
            throw VoiceAudioEngineError.playbackUnavailable
        }
        buffer.frameLength = frameCount
        for frame in 0..<Int(frameCount) {
            let offset = frame * 2
            let sample = UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
            channel[frame] = Float(Int16(bitPattern: sample)) / Float(Int16.max)
        }
        if let responseID {
            lock.lock()
            var progress = playbackProgress[responseID, default: PlaybackProgress()]
            progress.pending += 1
            progress.scheduled = true
            playbackProgress[responseID] = progress
            lock.unlock()
        }
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self, let responseID else { return }
            self.bufferPlayed(responseID)
        }
        if !player.isPlaying { player.play() }
    }

    func finishPlayback(responseID: String?) {
        guard let responseID else { return }
        var handler: (@Sendable (String, Bool) -> Void)?
        lock.lock()
        var progress = playbackProgress[responseID, default: PlaybackProgress()]
        progress.finished = true
        if progress.pending == 0 {
            playbackProgress.removeValue(forKey: responseID)
            handler = playbackFinished
        } else {
            playbackProgress[responseID] = progress
        }
        lock.unlock()
        handler?(responseID, progress.scheduled)
    }

    func stopPlayback() {
        player.stop()
        lock.lock()
        playbackProgress.removeAll()
        lock.unlock()
    }

    func stop() {
        if hasCaptureTap {
            engine.inputNode.removeTap(onBus: 0)
            hasCaptureTap = false
        }
        engine.stop()
        player.stop()
        lock.lock()
        captureContinuation?.finish()
        captureContinuation = nil
        playbackProgress.removeAll()
        playbackFinished = nil
        converter = nil
        lock.unlock()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
        try session.setActive(true)
    }

    private func convert(_ input: AVAudioPCMBuffer) -> Data? {
        guard let converter,
              let output = AVAudioPCMBuffer(
                pcmFormat: targetFormat,
                frameCapacity: AVAudioFrameCount(
                    ceil(Double(input.frameLength) * Double(VoiceAudioFormat.sampleRate) / input.format.sampleRate) + 1
                )
              ),
              let samples = output.floatChannelData?[0] else {
            return nil
        }
        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            guard !suppliedInput else {
                inputStatus.pointee = .noDataNow
                return nil
            }
            suppliedInput = true
            inputStatus.pointee = .haveData
            return input
        }
        guard status != .error, output.frameLength > 0 else { return nil }
        var data = Data()
        data.reserveCapacity(Int(output.frameLength) * MemoryLayout<Int16>.size)
        for frame in 0..<Int(output.frameLength) {
            let clamped = max(-1, min(1, samples[frame]))
            let sample = Int16(clamped * Float(Int16.max))
            let littleEndian = UInt16(bitPattern: sample).littleEndian
            data.append(UInt8(truncatingIfNeeded: littleEndian))
            data.append(UInt8(truncatingIfNeeded: littleEndian >> 8))
        }
        return data
    }

    private func bufferPlayed(_ responseID: String) {
        var handler: (@Sendable (String, Bool) -> Void)?
        lock.lock()
        guard var progress = playbackProgress[responseID] else {
            lock.unlock()
            return
        }
        progress.pending = max(0, progress.pending - 1)
        if progress.finished && progress.pending == 0 {
            playbackProgress.removeValue(forKey: responseID)
            handler = playbackFinished
        } else {
            playbackProgress[responseID] = progress
        }
        lock.unlock()
        handler?(responseID, progress.scheduled)
    }

    private struct PlaybackProgress {
        var pending = 0
        var finished = false
        var scheduled = false
    }
}

enum VoiceAudioEngineError: Error {
    case captureUnavailable
    case playbackUnavailable
}
