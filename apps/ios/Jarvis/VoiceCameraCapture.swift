import AVFoundation
import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import QuartzCore

final class VoiceCameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()

    private let queue = DispatchQueue(label: "com.danaakesen.jarvis.voice-camera")
    private let context = CIContext()
    private let output = AVCaptureVideoDataOutput()
    private let lock = NSLock()
    private var latestJPEG: Data?
    private var lastCapturedAt: CFTimeInterval = 0

    static func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .video) { continuation.resume(returning: $0) }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }

    static var isAuthorized: Bool {
        AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    }

    func start() throws {
        var result: Result<Void, any Error> = .success(())
        queue.sync {
            session.beginConfiguration()
            do {
                session.sessionPreset = .high
                guard let device = AVCaptureDevice.default(for: .video) else {
                    throw VoiceCameraError.unavailable
                }
                let input = try AVCaptureDeviceInput(device: device)
                guard session.canAddInput(input), session.canAddOutput(output) else {
                    throw VoiceCameraError.unavailable
                }
                session.addInput(input)
                output.videoSettings = [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                ]
                output.alwaysDiscardsLateVideoFrames = true
                output.setSampleBufferDelegate(self, queue: queue)
                session.addOutput(output)
                session.commitConfiguration()
                session.startRunning()
            } catch {
                session.commitConfiguration()
                result = .failure(error)
            }
        }
        try result.get()
    }

    func stop() {
        queue.async { [session, output] in
            output.setSampleBufferDelegate(nil, queue: nil)
            if session.isRunning { session.stopRunning() }
            session.inputs.forEach { session.removeInput($0) }
            session.outputs.forEach { session.removeOutput($0) }
            self.lock.lock()
            self.latestJPEG = nil
            self.lock.unlock()
        }
    }

    func latestFrame() -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return latestJPEG
    }

    func capturePhoto() -> Data? {
        latestFrame()
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard CACurrentMediaTime() - lastCapturedAt >= JarvisDesignTokens.voiceCameraFrameInterval,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }
        lastCapturedAt = CACurrentMediaTime()
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        let scale = min(
            1,
            JarvisDesignTokens.voiceCameraMaximumFrameWidth / image.extent.width,
            JarvisDesignTokens.voiceCameraMaximumFrameHeight / image.extent.height
        )
        let scaledImage = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let jpeg = context.jpegRepresentation(
            of: scaledImage,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [.lossyCompressionQuality: JarvisDesignTokens.voiceCameraJPEGQuality]
        ),
              jpeg.count <= JarvisDesignTokens.voiceCameraMaximumFrameBytes else {
            return
        }
        lock.lock()
        latestJPEG = jpeg
        lock.unlock()
    }
}

enum VoiceCameraError: Error {
    case unavailable
}
