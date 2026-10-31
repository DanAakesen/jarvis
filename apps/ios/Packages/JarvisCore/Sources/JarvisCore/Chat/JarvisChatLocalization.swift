import Foundation

public enum JarvisChatLocalizationKey: String, CaseIterable, Sendable {
    case plusMenuLabel = "chat.plus.menuLabel"
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
    case close = "chat.plus.close"
    case screenShareTitle = "chat.plus.screenShareTitle"
    case screenShareInstructions = "chat.plus.screenShareInstructions"
    case cameraUnavailable = "chat.plus.cameraUnavailable"
    case cameraPermissionDenied = "chat.plus.cameraPermissionDenied"
    case cameraFrameUnavailable = "chat.plus.cameraFrameUnavailable"
    case screenFrameUnavailable = "chat.plus.screenFrameUnavailable"
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
