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
    }

    override func broadcastFinished() {
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
