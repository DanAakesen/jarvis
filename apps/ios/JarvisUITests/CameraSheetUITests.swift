import AVFoundation
import XCTest

final class CameraSheetUITests: XCTestCase {
    @MainActor
    func testCameraAndVideoSheetsExposeCameraControlsInDanishAndEnglish() throws {
        let backCamera = hasCamera(at: .back)
        let frontCamera = hasCamera(at: .front)
        guard backCamera || frontCamera else {
            let app = launch(language: "en")
            XCTAssertTrue(app.buttons["Add to message"].waitForExistence(timeout: 10))
            app.buttons["Add to message"].tap()
            app.buttons["Camera"].tap()
            allowCameraIfRequested(in: app)
            attachScreenshot(from: app, named: "camera-unavailable")
            throw XCTSkip("The simulator does not expose a camera device.")
        }

        for language in ["da", "en"] {
            let labels = CameraLabels(language: language)
            let app = launch(language: language)
            XCTAssertTrue(app.buttons[labels.addToMessage].waitForExistence(timeout: 10))
            app.buttons[labels.addToMessage].tap()
            app.buttons[labels.camera].tap()
            allowCameraIfRequested(in: app)

            let captureButton = app.buttons["camera.capture"]
            guard captureButton.waitForExistence(timeout: 10) else {
                attachScreenshot(from: app, named: "camera-unavailable-\(language)")
                throw XCTSkip("The simulator camera could not start.")
            }

            XCTAssertTrue(app.buttons["camera.lens"].exists)
            XCTAssertEqual(app.buttons["camera.lens"].label, labels.cameraLens)
            attachScreenshot(from: app, named: "camera-sheet-\(language)")
            let rememberedBackLens = assertLensOptions(
                in: app,
                labels: labels,
                position: backCamera ? .back : .front
            )
            let switchedToFront = exerciseCameraSwitchIfAvailable(
                in: app,
                labels: labels,
                hasBothPositions: backCamera && frontCamera,
                screenshotSuffix: language
            )
            if switchedToFront {
                assertLensOptions(in: app, labels: labels, position: .front)
            }

            app.buttons["camera.stop"].tap()
            app.buttons[labels.addToMessage].tap()
            app.buttons[labels.enableVideo].tap()

            let stopVideoButton = app.buttons["camera.stop"]
            guard stopVideoButton.waitForExistence(timeout: 10),
                  app.buttons["camera.lens"].waitForExistence(timeout: 3) else {
                attachScreenshot(from: app, named: "video-unavailable-\(language)")
                throw XCTSkip("The simulator camera could not start the video preview.")
            }
            XCTAssertEqual(stopVideoButton.label, labels.disableVideo)
            XCTAssertTrue(app.buttons["camera.lens"].exists)
            attachScreenshot(from: app, named: "video-preview-\(language)")
            let switchedBackToBack = exerciseCameraSwitchIfAvailable(
                in: app,
                labels: labels,
                hasBothPositions: backCamera && frontCamera,
                screenshotSuffix: "video-\(language)"
            )
            if switchedToFront && switchedBackToBack {
                XCTAssertEqual(app.buttons["camera.lens"].value as? String, rememberedBackLens)
            }
            stopVideoButton.tap()
            app.terminate()
        }
    }

    @MainActor
    private func launch(language: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-camera", "-jarvis.appLanguage", language]
        app.launch()
        return app
    }

    @MainActor
    private func allowCameraIfRequested(in app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for alerts in [springboard.alerts, app.alerts] {
            let allowButton = alerts.buttons.matching(
                NSPredicate(format: "label BEGINSWITH[c] %@", "Allow")
            ).firstMatch
            if allowButton.waitForExistence(timeout: 3) {
                allowButton.tap()
                return
            }
        }
    }

    @MainActor
    private func exerciseCameraSwitchIfAvailable(
        in app: XCUIApplication,
        labels: CameraLabels,
        hasBothPositions: Bool,
        screenshotSuffix: String
    ) -> Bool {
        let switchButton = app.buttons["camera.switch"]
        guard hasBothPositions else {
            XCTAssertFalse(switchButton.exists)
            return false
        }

        XCTAssertTrue(switchButton.waitForExistence(timeout: 5))
        XCTAssertEqual(switchButton.label, labels.switchCamera)
        let originalPosition = switchButton.value as? String
        XCTAssertNotNil(originalPosition)
        let expectedPosition = originalPosition == labels.frontCamera
            ? labels.backCamera
            : labels.frontCamera
        switchButton.tap()
        let changedPosition = NSPredicate(format: "value != %@", originalPosition ?? "")
        expectation(for: changedPosition, evaluatedWith: switchButton)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(switchButton.value as? String, expectedPosition)
        attachScreenshot(from: app, named: "camera-switched-\(screenshotSuffix)")
        return true
    }

    @MainActor
    private func assertLensOptions(
        in app: XCUIApplication,
        labels: CameraLabels,
        position: AVCaptureDevice.Position
    ) -> String {
        let lensButton = app.buttons["camera.lens"]
        let selectedLens = lensButton.value as? String
        XCTAssertFalse(selectedLens?.isEmpty ?? true)
        lensButton.tap()

        let types = position == .back
            ? [AVCaptureDevice.DeviceType.builtInUltraWideCamera,
               .builtInWideAngleCamera,
               .builtInTelephotoCamera]
            : [.builtInWideAngleCamera, .builtInTrueDepthCamera]
        let supportedTypes = Set(AVCaptureDevice.DiscoverySession(
            deviceTypes: types,
            mediaType: .video,
            position: position
        ).devices.map(\.deviceType))
        let options: [(AVCaptureDevice.DeviceType, String)] = [
            (.builtInUltraWideCamera, labels.ultraWideLens),
            (.builtInWideAngleCamera, labels.wideLens),
            (.builtInTelephotoCamera, labels.telephotoLens),
        ]
        var supportedTitles: [String] = []
        for (type, title) in options {
            let supported = type == .builtInWideAngleCamera && position == .front
                ? supportedTypes.contains(.builtInWideAngleCamera) || supportedTypes.contains(.builtInTrueDepthCamera)
                : supportedTypes.contains(type)
            XCTAssertEqual(app.buttons[title].waitForExistence(timeout: 3), supported, title)
            if supported { supportedTitles.append(title) }
        }
        let nextLens = supportedTitles.first(where: { $0 != selectedLens }) ?? selectedLens ?? ""
        app.buttons[nextLens].tap()
        XCTAssertEqual(lensButton.value as? String, nextLens)
        return nextLens
    }

    @MainActor
    private func attachScreenshot(from app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func hasCamera(at position: AVCaptureDevice.Position) -> Bool {
        let types: [AVCaptureDevice.DeviceType] = position == .back
            ? [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera]
            : [.builtInWideAngleCamera, .builtInTrueDepthCamera]
        return !AVCaptureDevice.DiscoverySession(
            deviceTypes: types,
            mediaType: .video,
            position: position
        ).devices.isEmpty
    }
}

private struct CameraLabels {
    let addToMessage: String
    let camera: String
    let cameraLens: String
    let switchCamera: String
    let frontCamera: String
    let backCamera: String
    let ultraWideLens: String
    let wideLens: String
    let telephotoLens: String
    let enableVideo: String
    let disableVideo: String

    init(language: String) {
        if language == "da" {
            addToMessage = "Tilføj til besked"
            camera = "Kamera"
            cameraLens = "Kameralinse"
            switchCamera = "Skift kamera"
            frontCamera = "Frontkamera"
            backCamera = "Bagkamera"
            ultraWideLens = "Ultravidvinkel"
            wideLens = "Vidvinkel"
            telephotoLens = "Tele"
            enableVideo = "Slå video til"
            disableVideo = "Slå video fra"
        } else {
            addToMessage = "Add to message"
            camera = "Camera"
            cameraLens = "Camera lens"
            switchCamera = "Switch camera"
            frontCamera = "Front camera"
            backCamera = "Back camera"
            ultraWideLens = "Ultra-wide"
            wideLens = "Wide"
            telephotoLens = "Telephoto"
            enableVideo = "Enable video"
            disableVideo = "Disable video"
        }
    }
}
