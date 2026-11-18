import AVFoundation
import Foundation
import JarvisCore
import OSLog

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
    private var captureDropped = false
    private var captureDropCount = 0
    private var playbackProgress: [String: PlaybackProgress] = [:]
    private var playbackFinished: (@Sendable (String, Bool) -> Void)?
    private var hasCaptureTap = false
    private var hasPlaybackGraph = false
    private var ownsActiveSession = false
    private let controlLock = NSLock()
    private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Jarvis", category: "WatchAudio")
    private var stats = CaptureStats()
    private var activeMode: AVAudioSession.Mode = .voiceChat
    private var activeTolerateDrops = false
    private var silenceRecovered = false
    private var monoFormat: AVAudioFormat?
    private var monoScratch: AVAudioPCMBuffer?

    /// What the microphone tap actually delivered, measured before any conversion.
    struct CaptureStats {
        var buffers = 0
        var channels = 0
        var sampleRate = 0.0
        var peak: Float = 0
    }

    static func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    /// `mode` is tried first. With `alternateMode`, a microphone that delivers exact digital silence for the first
    /// seconds is restarted once in that mode, because a session mode can leave the input dead without any error.
    func startCapture(
        tolerateDrops: Bool = false, mode: AVAudioSession.Mode = .voiceChat, alternateMode: AVAudioSession.Mode? = nil
    ) throws -> AsyncStream<Data> {
        controlLock.lock()
        defer { controlLock.unlock() }
        let stream = AsyncStream<Data>(bufferingPolicy: tolerateDrops ? .bufferingNewest(16) : .bufferingOldest(16)) { continuation in
            lock.lock()
            captureDropped = false
            captureDropCount = 0
            captureContinuation = continuation
            stats = CaptureStats()
            silenceRecovered = false
            lock.unlock()
        }
        activeTolerateDrops = tolerateDrops
        do {
            try attachInput(mode: mode)
        } catch {
            lock.lock()
            captureContinuation?.finish()
            captureContinuation = nil
            lock.unlock()
            throw error
        }
        if let alternateMode { scheduleSilenceCheck(alternate: alternateMode) }
        return stream
    }

    /// Session, graph, tap and engine start. Shared by the first start and the silence recovery, which keeps the
    /// consumer's stream: it only ever sees audio, never the restart.
    private func attachInput(mode: AVAudioSession.Mode) throws {
        // Activating playAndRecord can change the hardware route on first use.
        // Build the graph only after that, rather than against the previous session.
        try configureSession(mode: mode)
        activeMode = mode
        if !hasPlaybackGraph {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: targetFormat)
            hasPlaybackGraph = true
        }
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0,
              let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw VoiceAudioEngineError.captureUnavailable
        }
        lock.lock()
        self.converter = converter
        stats = CaptureStats()
        lock.unlock()
        input.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.measure(buffer)
            guard let data = self.convert(buffer) else { return }
            self.lock.lock()
            let continuation = self.captureContinuation
            let tolerate = self.activeTolerateDrops
            self.lock.unlock()
            #if os(watchOS)
            if let result = continuation?.yield(data), case .dropped = result {
                self.lock.lock()
                self.captureDropped = true
                self.captureDropCount += 1
                self.lock.unlock()
                if !tolerate { continuation?.finish() }
            }
            #else
            continuation?.yield(data)
            #endif
        }
        hasCaptureTap = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            hasCaptureTap = false
            throw error
        }
        log.info("Capture started: \(self.sessionDescription(inputFormat: inputFormat), privacy: .public)")
    }

    private func measure(_ buffer: AVAudioPCMBuffer) {
        var peak: Float = 0
        if let channels = buffer.floatChannelData {
            for channel in 0..<Int(buffer.format.channelCount) {
                for frame in 0..<Int(buffer.frameLength) { peak = max(peak, abs(channels[channel][frame])) }
            }
        }
        lock.lock()
        stats.buffers += 1
        stats.channels = Int(buffer.format.channelCount)
        stats.sampleRate = buffer.format.sampleRate
        stats.peak = max(stats.peak, peak)
        lock.unlock()
    }

    /// Facts for the log and for an honest silence message: where the signal was lost, never audio or text.
    var captureSummary: String {
        lock.lock()
        let value = stats
        lock.unlock()
        return "mode=\(activeMode.rawValue) buffers=\(value.buffers) input_channels=\(value.channels) input_rate=\(Int(value.sampleRate)) input_peak=\(String(format: "%.5f", value.peak)) recovered=\(silenceRecovered)"
    }

    private func sessionDescription(inputFormat: AVAudioFormat) -> String {
        let session = AVAudioSession.sharedInstance()
        let inputs = session.currentRoute.inputs.map { "\($0.portType.rawValue)" }.joined(separator: ",")
        let permission = AVAudioApplication.shared.recordPermission
        return "category=\(session.category.rawValue) mode=\(session.mode.rawValue) input_available=\(session.isInputAvailable) route_inputs=[\(inputs)] hw_rate=\(Int(session.sampleRate)) format_channels=\(inputFormat.channelCount) format_rate=\(Int(inputFormat.sampleRate)) permission=\(permission.rawValue)"
    }

    private func scheduleSilenceCheck(alternate: AVAudioSession.Mode) {
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 2.5) { [weak self] in
            self?.recoverIfSilent(alternate: alternate)
        }
    }

    private func recoverIfSilent(alternate: AVAudioSession.Mode) {
        controlLock.lock()
        defer { controlLock.unlock() }
        lock.lock()
        let live = captureContinuation != nil
        let silent = stats.peak < 0.000_001
        let already = silenceRecovered
        lock.unlock()
        guard live, hasCaptureTap, silent, !already, activeMode != alternate else { return }
        log.error("Microphone delivered no signal in mode \(self.activeMode.rawValue, privacy: .public): \(self.captureSummary, privacy: .public). Restarting in \(alternate.rawValue, privacy: .public)")
        lock.lock(); silenceRecovered = true; lock.unlock()
        engine.inputNode.removeTap(onBus: 0)
        hasCaptureTap = false
        engine.stop()
        do { try attachInput(mode: alternate) }
        catch {
            log.error("Microphone restart failed: \(String(describing: error), privacy: .public)")
            lock.lock()
            captureContinuation?.finish()
            captureContinuation = nil
            lock.unlock()
        }
    }

    var didDropCapture: Bool {
        lock.lock()
        defer { lock.unlock() }
        return captureDropped
    }

    var droppedCaptureChunks: Int {
        lock.lock()
        defer { lock.unlock() }
        return captureDropCount
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
        controlLock.lock()
        defer { controlLock.unlock() }
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
        if ownsActiveSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            ownsActiveSession = false
        }
    }

    private func configureSession(mode: AVAudioSession.Mode) throws {
        let session = AVAudioSession.sharedInstance()
        #if os(watchOS)
        try session.setCategory(.playAndRecord, mode: mode)
        #else
        try session.setCategory(.playAndRecord, mode: mode, options: [.defaultToSpeaker])
        #endif
        try session.setActive(true)
        ownsActiveSession = true
    }

    // Hardware formats can change after the engine starts (route or voice-processing changes); convert from the buffer's real format.
    private func captureConverter(for format: AVAudioFormat) -> AVAudioConverter? {
        lock.lock()
        defer { lock.unlock() }
        guard captureContinuation != nil else { return nil }
        if let converter, converter.inputFormat == format { return converter }
        converter = AVAudioConverter(from: format, to: targetFormat)
        return converter
    }

    /// watchOS: fold several microphone channels to mono explicitly (see `WatchMonoMixer`).
    private func monoMixed(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
        #if os(watchOS)
        guard input.format.channelCount > 1, !input.format.isInterleaved,
              input.format.commonFormat == .pcmFormatFloat32, let source = input.floatChannelData else { return input }
        if monoFormat?.sampleRate != input.format.sampleRate {
            monoFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: input.format.sampleRate, channels: 1, interleaved: false)
            monoScratch = nil
        }
        guard let monoFormat else { return input }
        if monoScratch == nil || monoScratch!.frameCapacity < input.frameLength {
            monoScratch = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: max(input.frameCapacity, input.frameLength))
        }
        guard let scratch = monoScratch, let destination = scratch.floatChannelData?[0] else { return input }
        let channels = (0..<Int(input.format.channelCount)).map { UnsafePointer(source[$0]) }
        WatchMonoMixer.mix(channels: channels, frames: Int(input.frameLength), into: destination)
        scratch.frameLength = input.frameLength
        return scratch
        #else
        return input
        #endif
    }

    private func convert(_ capture: AVAudioPCMBuffer) -> Data? {
        let input = monoMixed(capture)
        guard let converter = captureConverter(for: input.format),
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
