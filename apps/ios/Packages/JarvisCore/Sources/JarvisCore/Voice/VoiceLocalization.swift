import Foundation

public enum JarvisVoiceLocalizationKey: String, CaseIterable, Sendable {
    case connecting, reconnecting, offline, muted, listening, thinking, speaking
    case openSettings, signInRequired, reconnect, mute, unmute, end, minimize, restore, orb
    case camera, stopCamera, cameraSettings, viewfinder, add, photoReady, takePhoto, close
    case shareScreen, stopSharing, sharingScreen, stop, broadcastPicker
    case unavailable, cameraUnavailable, frameUnavailable, playbackUnavailable, microphoneUnavailable
    case signInError, tryLater, imageLimit, imageRateLimit, imageUnavailable
    case preview
    case screenShareUnavailable
}

public enum JarvisVoiceLocalization {
    public static func string(
        _ key: JarvisVoiceLocalizationKey,
        language: JarvisAppLanguage? = nil
    ) -> String {
        let language = language ?? JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return "voice.\(key.rawValue)"
        }
        return bundle.localizedString(
            forKey: "voice.\(key.rawValue)", value: nil, table: "JarvisNotes"
        )
    }
}
