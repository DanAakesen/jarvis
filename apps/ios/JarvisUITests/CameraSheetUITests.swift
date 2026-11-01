import AVFoundation
import XCTest

final class CameraSheetUITests: XCTestCase {
    @MainActor
    func testCameraAndVideoSheetsExposeCameraControlsInDanishAndEnglish() {
        for language in ["da", "en"] {
            let labels = CameraLabels(language: language)
            let app = launch(language: language)
            let addToMessage = app.buttons["chat.plus.menu"]
            XCTAssertTrue(addToMessage.waitForExistence(timeout: 10))
            XCTAssertEqual(addToMessage.label, labels.addToMessage)
            addToMessage.tap()
            let cameraOption = app.buttons["chat.plus.camera"]
            XCTAssertTrue(cameraOption.waitForExistence(timeout: 5))
            XCTAssertEqual(cameraOption.label, labels.camera)
            cameraOption.tap()

            let captureButton = app.buttons["camera.capture"]
            XCTAssertTrue(captureButton.waitForExistence(timeout: 10))
            XCTAssertFalse(captureButton.isEnabled)
            XCTAssertTrue(app.descendants(matching: .any)["camera.preview.placeholder"].exists)

            XCTAssertTrue(app.buttons["camera.lens"].exists)
            XCTAssertEqual(app.buttons["camera.lens"].label, labels.cameraLens)
            attachScreenshot(from: app, named: "camera-sheet-\(language)")
            let rememberedBackLens = assertLensOptions(
                in: app,
                labels: labels,
                position: .back
            )
            exerciseCameraSwitch(
                in: app,
                labels: labels,
                screenshotSuffix: language
            )
            assertLensOptions(in: app, labels: labels, position: .front)

            app.buttons["camera.stop"].tap()
            addToMessage.tap()
            app.buttons["chat.plus.video"].tap()

            let stopVideoButton = app.buttons["camera.stop"]
            XCTAssertTrue(stopVideoButton.waitForExistence(timeout: 10))
            XCTAssertTrue(app.buttons["camera.lens"].waitForExistence(timeout: 3))
            XCTAssertEqual(stopVideoButton.label, labels.disableVideo)
            XCTAssertTrue(app.descendants(matching: .any)["camera.preview.placeholder"].exists)
            attachScreenshot(from: app, named: "video-preview-\(language)")
            exerciseCameraSwitch(
                in: app,
                labels: labels,
                screenshotSuffix: "video-\(language)"
            )
            XCTAssertEqual(app.buttons["camera.lens"].value as? String, rememberedBackLens)
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
    private func exerciseCameraSwitch(
        in app: XCUIApplication,
        labels: CameraLabels,
        screenshotSuffix: String
    ) {
        let switchButton = app.buttons["camera.switch"]
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

        let options: [(AVCaptureDevice.DeviceType, String)] = [
            (.builtInUltraWideCamera, labels.ultraWideLens),
            (.builtInWideAngleCamera, labels.wideLens),
            (.builtInTelephotoCamera, labels.telephotoLens),
        ]
        let supportedOptions = position == .back ? options : [options[1]]
        let supportedTitles = supportedOptions.map { $0.1 }
        for (_, title) in options {
            XCTAssertEqual(
                app.buttons[title].waitForExistence(timeout: 3),
                supportedTitles.contains(title),
                title
            )
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
            disableVideo = "Disable video"
        }
    }
}
