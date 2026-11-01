import AVFoundation
import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import JarvisCore
import QuartzCore

enum VoiceCameraLens: String, CaseIterable, Identifiable, Sendable {
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

    var localizationKey: JarvisChatLocalizationKey {
        switch self {
        case .ultraWide: .lensUltraWide
        case .wide: .lensWide
        case .telephoto: .lensTelephoto
        }
    }
}

/// Last camera and lens Dan chose; kept in memory for the app session only.
private let cameraChoiceLock = NSLock()
nonisolated(unsafe) private var rememberedPosition: AVCaptureDevice.Position = .back
nonisolated(unsafe) private var rememberedLens: VoiceCameraLens = .wide

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

    static var rememberedChoice: (position: AVCaptureDevice.Position, lens: VoiceCameraLens) {
        cameraChoiceLock.lock()
        defer { cameraChoiceLock.unlock() }
        return (rememberedPosition, rememberedLens)
    }

    /// Lenses the device actually offers for a camera position, found with device discovery.
    static func availableLenses(position: AVCaptureDevice.Position) -> [VoiceCameraLens] {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: VoiceCameraLens.allCases.map(\.deviceType),
            mediaType: .video,
            position: position
        )
        let types = Set(discovery.devices.map(\.deviceType))
        return VoiceCameraLens.allCases.filter { types.contains($0.deviceType) }
    }

    static func hasCamera(position: AVCaptureDevice.Position) -> Bool {
        !availableLenses(position: position).isEmpty
    }

    static func device(position: AVCaptureDevice.Position, lens: VoiceCameraLens) -> AVCaptureDevice? {
        if let exact = AVCaptureDevice.default(lens.deviceType, for: .video, position: position) {
            return exact
        }
        if let first = availableLenses(position: position).first,
           let fallback = AVCaptureDevice.default(first.deviceType, for: .video, position: position) {
            return fallback
        }
        return AVCaptureDevice.default(for: .video)
    }

    private(set) var position: AVCaptureDevice.Position = .back
    private(set) var lens: VoiceCameraLens = .wide

    static var isAuthorized: Bool {
        AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    }

    func start() throws {
        var result: Result<Void, any Error> = .success(())
        queue.sync {
            session.beginConfiguration()
            do {
                session.sessionPreset = .high
                let choice = Self.rememberedChoice
                guard let device = Self.device(position: choice.position, lens: choice.lens) else {
                    throw VoiceCameraError.unavailable
                }
                position = device.position == .unspecified ? choice.position : device.position
                lens = VoiceCameraLens.allCases.first { $0.deviceType == device.deviceType } ?? choice.lens
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

    /// Swaps the active camera without restarting the session and remembers the choice.
    func select(position newPosition: AVCaptureDevice.Position, lens newLens: VoiceCameraLens) throws {
        var result: Result<Void, any Error> = .success(())
        queue.sync {
            session.beginConfiguration()
            defer { session.commitConfiguration() }
            do {
                guard let device = Self.device(position: newPosition, lens: newLens) else {
                    throw VoiceCameraError.unavailable
                }
                let input = try AVCaptureDeviceInput(device: device)
                let previous = session.inputs
                previous.forEach { session.removeInput($0) }
                guard session.canAddInput(input) else {
                    previous.forEach { if session.canAddInput($0) { session.addInput($0) } }
                    throw VoiceCameraError.unavailable
                }
                session.addInput(input)
                position = device.position == .unspecified ? newPosition : device.position
                lens = VoiceCameraLens.allCases.first { $0.deviceType == device.deviceType } ?? newLens
                cameraChoiceLock.lock()
                rememberedPosition = position
                rememberedLens = lens
                cameraChoiceLock.unlock()
            } catch {
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
