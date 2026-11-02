import CoreImage
import ImageIO
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private let fileManager = FileManager.default
    private let context = CIContext()
    private var lastFrameTime: TimeInterval = 0
    private var heartbeat: DispatchSourceTimer?

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard let containerURL = VoiceScreenShareContract.containerURL() else { return }
        try? fileManager.removeItem(
            at: containerURL.appendingPathComponent(VoiceScreenShareContract.stopFileName)
        )
        try? fileManager.removeItem(
            at: containerURL.appendingPathComponent(VoiceScreenShareContract.frameFileName)
        )
        try? Data().write(
            to: containerURL.appendingPathComponent(VoiceScreenShareContract.activeFileName),
            options: .atomic
        )
        startHeartbeat(in: containerURL)
    }

    /// ReplayKit only delivers frames when the screen changes. Without this timer the marker and the last frame
    /// go stale on a still screen, the app reports "stopped" and Jarvis stops receiving the unchanged screen.
    private func startHeartbeat(in containerURL: URL) {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + 1, repeating: VoiceScreenShareContract.heartbeatInterval)
        timer.setEventHandler { [fileManager] in
            let now = Date()
            for name in [VoiceScreenShareContract.activeFileName, VoiceScreenShareContract.frameFileName] {
                let url = containerURL.appendingPathComponent(name)
                if fileManager.fileExists(atPath: url.path) {
                    try? fileManager.setAttributes([.modificationDate: now], ofItemAtPath: url.path)
                }
            }
        }
        heartbeat = timer
        timer.resume()
    }

    override func broadcastFinished() {
        heartbeat?.cancel()
        heartbeat = nil
        guard let containerURL = VoiceScreenShareContract.containerURL() else { return }
        try? fileManager.removeItem(
            at: containerURL.appendingPathComponent(VoiceScreenShareContract.activeFileName)
        )
        try? fileManager.removeItem(
            at: containerURL.appendingPathComponent(VoiceScreenShareContract.stopFileName)
        )
        try? fileManager.removeItem(
            at: containerURL.appendingPathComponent(VoiceScreenShareContract.frameFileName)
        )
    }

    override func processSampleBuffer(
        _ sampleBuffer: CMSampleBuffer,
        with sampleBufferType: RPSampleBufferType
    ) {
        guard sampleBufferType == .video,
              let containerURL = VoiceScreenShareContract.containerURL() else {
            return
        }
        let stopURL = containerURL.appendingPathComponent(VoiceScreenShareContract.stopFileName)
        if fileManager.fileExists(atPath: stopURL.path) {
            JarvisStopBroadcast(self)
            return
        }
        let now = Date.timeIntervalSinceReferenceDate
        guard now - lastFrameTime >= VoiceScreenShareContract.frameInterval,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }
        lastFrameTime = now
        try? Data().write(
            to: containerURL.appendingPathComponent(VoiceScreenShareContract.activeFileName),
            options: .atomic
        )
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        let scale = min(
            1,
            VoiceScreenShareContract.maximumFrameWidth / image.extent.width,
            VoiceScreenShareContract.maximumFrameHeight / image.extent.height
        )
        let scaledImage = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let jpeg = context.jpegRepresentation(
            of: scaledImage,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [
                CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String):
                    VoiceScreenShareContract.jpegQuality
            ]
        ),
              jpeg.count <= VoiceScreenShareContract.maximumFrameBytes else {
            return
        }
        try? jpeg.write(
            to: containerURL.appendingPathComponent(VoiceScreenShareContract.frameFileName),
            options: .atomic
        )
    }
}
