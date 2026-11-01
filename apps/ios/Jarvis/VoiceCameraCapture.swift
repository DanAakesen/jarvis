import AVFoundation
import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import QuartzCore

enum JarvisCameraLens: String, CaseIterable, Identifiable {
    case ultraWide
    case wide
    case telephoto

    var id: String { rawValue }

    var deviceType: AVCaptureDevice.DeviceType {
        switch self {
        case .ultraWide: .builtInUltraWideCamera
        case .wide: .builtInWideAngleCamera
        case .telephoto: .builtInTelephotoCamera
        }
    }
}

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
    private var currentInput: AVCaptureDeviceInput?
    private var isVideoPaused = false
    private(set) var position: AVCaptureDevice.Position = .back
    private(set) var lens: JarvisCameraLens = .wide

    static var availablePositions: [AVCaptureDevice.Position] {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .builtInTrueDepthCamera],
            mediaType: .video,
            position: .unspecified
        )
        return [AVCaptureDevice.Position.front, .back].filter { position in
            discovery.devices.contains { $0.position == position }
        }
    }

    static func availableLenses(for position: AVCaptureDevice.Position) -> [JarvisCameraLens] {
        let lenses: [JarvisCameraLens] = position == .back
            ? JarvisCameraLens.allCases
            : [.wide]
        return lenses.filter { device(for: $0, position: position) != nil }
    }

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

    func start(position requestedPosition: AVCaptureDevice.Position, lens requestedLens: JarvisCameraLens) throws {
        let result: Result<Void, any Error> = queue.sync {
            session.beginConfiguration()
            do {
                session.sessionPreset = .high
                let position = Self.availablePositions.contains(requestedPosition)
                    ? requestedPosition
                    : (Self.availablePositions.first ?? requestedPosition)
                let lens = Self.availableLenses(for: position).contains(requestedLens)
                    ? requestedLens
                    : (Self.availableLenses(for: position).first ?? requestedLens)
                guard let device = Self.device(for: lens, position: position) else {
                    throw VoiceCameraError.unavailable
                }
                let input = try AVCaptureDeviceInput(device: device)
                guard session.canAddInput(input),
                      session.canAddOutput(output),
                      session.canAddOutput(stillPhotoOutput) else {
                    throw VoiceCameraError.unavailable
                }
                session.addInput(input)
                currentInput = input
                self.position = position
                self.lens = lens
                output.videoSettings = [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                ]
                output.alwaysDiscardsLateVideoFrames = true
                output.setSampleBufferDelegate(self, queue: queue)
                session.addOutput(output)
                session.addOutput(stillPhotoOutput)
                session.commitConfiguration()
                session.startRunning()
                return .success(())
            } catch {
                session.commitConfiguration()
                return .failure(error)
            }
        }
        try result.get()
    }

    func selectCamera(position: AVCaptureDevice.Position, lens: JarvisCameraLens) throws {
        let result: Result<Void, any Error> = queue.sync {
            guard let currentInput,
                  let device = Self.device(for: lens, position: position),
                  let replacement = try? AVCaptureDeviceInput(device: device) else {
                return .failure(VoiceCameraError.unavailable)
            }
            session.beginConfiguration()
            session.removeInput(currentInput)
            guard session.canAddInput(replacement) else {
                if session.canAddInput(currentInput) { session.addInput(currentInput) }
                session.commitConfiguration()
                return .failure(VoiceCameraError.unavailable)
            }
            session.addInput(replacement)
            session.commitConfiguration()
            self.currentInput = replacement
            self.position = position
            self.lens = lens
            return .success(())
        }
        try result.get()
    }

    func setVideoPaused(_ paused: Bool) {
        queue.sync {
            isVideoPaused = paused
        }
    }

    func stop() {
        queue.async { [session, output] in
            output.setSampleBufferDelegate(nil, queue: nil)
            if session.isRunning { session.stopRunning() }
            session.inputs.forEach { session.removeInput($0) }
            session.outputs.forEach { session.removeOutput($0) }
            self.currentInput = nil
            self.isVideoPaused = false
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
        guard !isVideoPaused,
              CACurrentMediaTime() - lastCapturedAt >= JarvisDesignTokens.voiceCameraFrameInterval,
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

    private static func device(
        for lens: JarvisCameraLens,
        position: AVCaptureDevice.Position
    ) -> AVCaptureDevice? {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [lens.deviceType],
            mediaType: .video,
            position: position
        )
        if let device = discovery.devices.first { return device }
        guard lens == .wide else { return nil }
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
    }
}

enum VoiceCameraError: Error {
    case unavailable
}
