import Foundation

/// Folds a multi-channel microphone buffer to mono before sample-rate conversion.
///
/// The Watch can expose more than one microphone channel. A channel-count conversion without a channel layout
/// is not guaranteed to carry the channel that holds the voice, so the mix is explicit: the mean of the channels
/// that carry any signal in the buffer. A channel that is exactly silent is left out instead of halving the level.
public enum WatchMonoMixer {
    public static func mix(
        channels: [UnsafePointer<Float>], frames: Int, into output: UnsafeMutablePointer<Float>
    ) {
        guard frames > 0 else { return }
        var active: [UnsafePointer<Float>] = []
        for channel in channels {
            var carriesSignal = false
            for frame in 0..<frames where channel[frame] != 0 { carriesSignal = true; break }
            if carriesSignal { active.append(channel) }
        }
        guard !active.isEmpty else {
            output.update(repeating: 0, count: frames)
            return
        }
        let scale = 1 / Float(active.count)
        for frame in 0..<frames {
            var sum: Float = 0
            for channel in active { sum += channel[frame] }
            output[frame] = sum * scale
        }
    }

    public static func mix(_ channels: [[Float]]) -> [Float] {
        let frames = channels.map(\.count).min() ?? 0
        guard frames > 0 else { return [] }
        var output = [Float](repeating: 0, count: frames)
        var pointers: [UnsafePointer<Float>] = []
        var storage: [UnsafeMutableBufferPointer<Float>] = []
        defer { storage.forEach { $0.deallocate() } }
        for channel in channels {
            let copy = UnsafeMutableBufferPointer<Float>.allocate(capacity: frames)
            _ = copy.initialize(from: channel.prefix(frames))
            storage.append(copy)
            pointers.append(UnsafePointer(copy.baseAddress!))
        }
        output.withUnsafeMutableBufferPointer { mix(channels: pointers, frames: frames, into: $0.baseAddress!) }
        return output
    }
}
