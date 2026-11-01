import AVFoundation
import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import QuartzCore

final class VoiceCameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()

    private let queue = DispatchQueue(label: "com.danaakesen.jarvis.voice-camera")
    private let context = CIContext()
    private let output = AVCaptureVideoDataOutput()
    private let stillPhotoOutput = AVCapturePhotoOutput()
    private let lock = NSLock()
    private var latestJPEG: Data?
    private var photoContinuation: CheckedContinuation<Data, any Error>?
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
                guard session.canAddInput(input),
                      session.canAddOutput(output),
                      session.canAddOutput(stillPhotoOutput) else {
                    throw VoiceCameraError.unavailable
                }
                session.addInput(input)
                output.videoSettings = [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                ]
                output.alwaysDiscardsLateVideoFrames = true
                output.setSampleBufferDelegate(self, queue: queue)
                session.addOutput(output)
                session.addOutput(stillPhotoOutput)
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
            let continuation = self.photoContinuation
            self.photoContinuation = nil
            self.lock.unlock()
            continuation?.resume(throwing: CancellationError())
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

    func captureStillPhoto() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                guard self.session.isRunning else {
                    continuation.resume(throwing: VoiceCameraError.unavailable)
                    return
                }
                self.lock.lock()
                guard self.photoContinuation == nil else {
                    self.lock.unlock()
                    continuation.resume(throwing: VoiceCameraError.unavailable)
                    return
                }
                self.photoContinuation = continuation
                self.lock.unlock()
                self.stillPhotoOutput.capturePhoto(
                    with: AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg]),
                    delegate: self
                )
            }
        }
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: (any Error)?
    ) {
        lock.lock()
        let continuation = photoContinuation
        photoContinuation = nil
        lock.unlock()
        guard let continuation else { return }
        if let error {
            continuation.resume(throwing: error)
        } else if let data = photo.fileDataRepresentation() {
            continuation.resume(returning: data)
        } else {
            continuation.resume(throwing: VoiceCameraError.unavailable)
        }
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
            options: [
                CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String):
                    JarvisDesignTokens.voiceCameraJPEGQuality
            ]
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
