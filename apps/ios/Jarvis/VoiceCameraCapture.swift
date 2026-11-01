import AVFoundation
import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import QuartzCore

enum VoiceCameraLens: String, CaseIterable, Identifiable {
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

private final class VoiceCameraPreferences: @unchecked Sendable {
    static let session = VoiceCameraPreferences()

    private let lock = NSLock()
    private var lastPosition: AVCaptureDevice.Position?
    private var lastLenses: [AVCaptureDevice.Position: VoiceCameraLens] = [:]

    func position() -> AVCaptureDevice.Position? {
        lock.lock()
        defer { lock.unlock() }
        return lastPosition
    }

    func lens(for position: AVCaptureDevice.Position) -> VoiceCameraLens? {
        lock.lock()
        defer { lock.unlock() }
        return lastLenses[position]
    }

    func select(position: AVCaptureDevice.Position, lens: VoiceCameraLens) {
        lock.lock()
        lastPosition = position
        lastLenses[position] = lens
        lock.unlock()
    }
}

final class VoiceCameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()

    private static let preferences = VoiceCameraPreferences.session
    private let devicesByPosition: [AVCaptureDevice.Position: [AVCaptureDevice]]
    private let queue = DispatchQueue(label: "com.danaakesen.jarvis.voice-camera")
    private let context = CIContext()
    private let output = AVCaptureVideoDataOutput()
    private let stillPhotoOutput = AVCapturePhotoOutput()
    private let lock = NSLock()
    private var latestJPEG: Data?
    private var photoContinuation: CheckedContinuation<Data, any Error>?
    private var lastCapturedAt: CFTimeInterval = 0
    private var videoInput: AVCaptureDeviceInput?
    private var activePosition: AVCaptureDevice.Position = .back
    private var selectedLenses: [AVCaptureDevice.Position: VoiceCameraLens] = [:]

    override init() {
        devicesByPosition = [
            .back: AVCaptureDevice.DiscoverySession(
                deviceTypes: Self.backCameraTypes,
                mediaType: .video,
                position: .back
            ).devices,
            .front: AVCaptureDevice.DiscoverySession(
                deviceTypes: [.builtInWideAngleCamera, .builtInTrueDepthCamera],
                mediaType: .video,
                position: .front
            ).devices,
        ]
        super.init()
    }

    var position: AVCaptureDevice.Position {
        queue.sync { activePosition }
    }

    var lens: VoiceCameraLens {
        queue.sync { selectedLenses[activePosition] ?? .wide }
    }

    var canSwitchCamera: Bool {
        availablePositions.count > 1
    }

    var availableLenses: [VoiceCameraLens] {
        availableLenses(for: position)
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

    func start() throws {
        var result: Result<Void, any Error> = .success(())
        queue.sync {
            session.beginConfiguration()
            do {
                session.sessionPreset = .high
                let availablePositions = self.availablePositions
                guard let position = Self.preferences.position().flatMap({
                          availablePositions.contains($0) ? $0 : nil
                      }) ?? availablePositions.first(where: { $0 == .back })
                        ?? availablePositions.first,
                      let lens = Self.preferences.lens(for: position).flatMap({
                          self.availableLenses(for: position).contains($0) ? $0 : nil
                      }) ?? self.preferredLens(for: position),
                      let device = self.device(for: lens, position: position) else {
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
                videoInput = input
                activePosition = position
                selectedLenses[position] = lens
                session.addOutput(output)
                session.addOutput(stillPhotoOutput)
                session.commitConfiguration()
                session.startRunning()
                Self.preferences.select(position: position, lens: lens)
            } catch {
                session.commitConfiguration()
                result = .failure(error)
            }
        }
        try result.get()
    }

    func switchCamera() throws {
        var result: Result<Void, any Error> = .success(())
        queue.sync {
            result = Result {
                let position: AVCaptureDevice.Position = self.activePosition == .back ? .front : .back
                guard self.availablePositions.contains(position),
                      let lens = (self.selectedLenses[position] ?? Self.preferences.lens(for: position)).flatMap({
                          self.availableLenses(for: position).contains($0) ? $0 : nil
                      }) ?? self.preferredLens(for: position) else {
                    throw VoiceCameraError.unavailable
                }
                try self.replaceVideoInput(position: position, lens: lens)
            }
        }
        try result.get()
    }

    func selectLens(_ lens: VoiceCameraLens) throws {
        var result: Result<Void, any Error> = .success(())
        queue.sync {
            result = Result {
                guard self.availableLenses(for: self.activePosition).contains(lens) else {
                    throw VoiceCameraError.unavailable
                }
                try self.replaceVideoInput(position: self.activePosition, lens: lens)
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

    private func replaceVideoInput(position: AVCaptureDevice.Position, lens: VoiceCameraLens) throws {
        guard let device = device(for: lens, position: position) else {
            throw VoiceCameraError.unavailable
        }
        let input = try AVCaptureDeviceInput(device: device)
        if videoInput?.device.uniqueID == device.uniqueID {
            activePosition = position
            selectedLenses[position] = lens
            Self.preferences.select(position: position, lens: lens)
            return
        }

        session.beginConfiguration()
        defer { session.commitConfiguration() }
        if let videoInput {
            session.removeInput(videoInput)
        }
        guard session.canAddInput(input) else {
            if let videoInput, session.canAddInput(videoInput) {
                session.addInput(videoInput)
            }
            throw VoiceCameraError.unavailable
        }
        session.addInput(input)
        videoInput = input
        activePosition = position
        selectedLenses[position] = lens
        Self.preferences.select(position: position, lens: lens)
    }

    private static let backCameraTypes: [AVCaptureDevice.DeviceType] = [
        .builtInUltraWideCamera,
        .builtInWideAngleCamera,
        .builtInTelephotoCamera,
    ]

    private func cameraDevices(for position: AVCaptureDevice.Position) -> [AVCaptureDevice] {
        devicesByPosition[position] ?? []
    }

    private var availablePositions: [AVCaptureDevice.Position] {
        [AVCaptureDevice.Position.back, .front].filter { !cameraDevices(for: $0).isEmpty }
    }

    private func availableLenses(for position: AVCaptureDevice.Position) -> [VoiceCameraLens] {
        let types = Set(cameraDevices(for: position).map(\.deviceType))
        return VoiceCameraLens.allCases.filter { lens in
            if position == .front, lens == .wide {
                return types.contains(.builtInWideAngleCamera) || types.contains(.builtInTrueDepthCamera)
            }
            return types.contains(lens.deviceType)
        }
    }

    private func preferredLens(for position: AVCaptureDevice.Position) -> VoiceCameraLens? {
        let lenses = availableLenses(for: position)
        return lenses.contains(.wide) ? .wide : lenses.first
    }

    private func device(
        for lens: VoiceCameraLens,
        position: AVCaptureDevice.Position
    ) -> AVCaptureDevice? {
        let devices = cameraDevices(for: position)
        if position == .front, lens == .wide {
            return devices.first(where: { $0.deviceType == .builtInWideAngleCamera })
                ?? devices.first(where: { $0.deviceType == .builtInTrueDepthCamera })
        }
        return devices.first(where: { $0.deviceType == lens.deviceType })
    }
}

enum VoiceCameraError: Error {
    case unavailable
}
