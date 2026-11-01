import Foundation

public enum JarvisChatLocalizationKey: String, CaseIterable, Sendable {
    case plusMenuLabel = "chat.plus.menuLabel"
    case menuExpanded = "chat.plus.menuExpanded"
    case menuCollapsed = "chat.plus.menuCollapsed"
    case addToMessage = "chat.plus.addToMessage"
    case camera = "chat.plus.camera"
    case attach = "chat.plus.attach"
    case enableVideo = "chat.plus.enableVideo"
    case disableVideo = "chat.plus.disableVideo"
    case shareScreen = "chat.plus.shareScreen"
    case stopSharingScreen = "chat.plus.stopSharingScreen"
    case voiceLanguage = "chat.plus.voiceLanguage"
    case danish = "chat.plus.danish"
    case english = "chat.plus.english"
    case takePhoto = "chat.plus.takePhoto"
    case takingPhoto = "chat.plus.takingPhoto"
    case close = "chat.plus.close"
    case switchCamera = "chat.plus.switchCamera"
    case cameraLens = "chat.plus.cameraLens"
    case frontCamera = "chat.plus.frontCamera"
    case backCamera = "chat.plus.backCamera"
    case cameraPreview = "chat.plus.cameraPreview"
    case ultraWideLens = "chat.plus.ultraWideLens"
    case wideLens = "chat.plus.wideLens"
    case telephotoLens = "chat.plus.telephotoLens"
    case chooseFiles = "chat.plus.chooseFiles"
    case photoLibrary = "chat.plus.photoLibrary"
    case videoOn = "chat.plus.videoOn"
    case screenSharingActive = "chat.plus.screenSharingActive"
    case attachmentLimitReached = "chat.plus.attachmentLimitReached"
    case attachmentsUnavailable = "chat.plus.attachmentsUnavailable"
    case videoUnavailable = "chat.plus.videoUnavailable"
    case screenSharingUnavailable = "chat.plus.screenSharingUnavailable"
    case voiceSettingsUnavailable = "chat.plus.voiceSettingsUnavailable"
    case removeAttachmentHint = "chat.plus.removeAttachmentHint"
    case chatBusyHint = "chat.plus.chatBusyHint"
    case voiceLanguageLoadFailed = "chat.plus.voiceLanguageLoadFailed"
    case voiceLanguageUpdateFailed = "chat.plus.voiceLanguageUpdateFailed"
    case cancel = "chat.plus.cancel"
    case screenShareTitle = "chat.plus.screenShareTitle"
    case screenShareInstructions = "chat.plus.screenShareInstructions"
    case screenSharePickerLabel = "chat.plus.screenSharePickerLabel"
    case cameraUnavailable = "chat.plus.cameraUnavailable"
    case cameraStarting = "chat.plus.cameraStarting"
    case cameraPermissionDenied = "chat.plus.cameraPermissionDenied"
    case cameraFrameUnavailable = "chat.plus.cameraFrameUnavailable"
    case screenFrameUnavailable = "chat.plus.screenFrameUnavailable"
    case plusMenuHint = "chat.plus.menuHint"
}

public enum JarvisChatLocalization {
    public static func string(
        _ key: JarvisChatLocalizationKey,
        language: JarvisAppLanguage = .default
    ) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return key.rawValue
        }
        return bundle.localizedString(forKey: key.rawValue, value: key.rawValue, table: "JarvisChat")
    }
}
