import Foundation

enum VoiceScreenShareContract {
    static let appGroupIdentifier = "group.com.danaakesen.jarvis"
    static let broadcastExtensionIdentifier = "com.danaakesen.jarvis.broadcast"
    static let activeFileName = "voice-screen-active"
    static let stopFileName = "voice-screen-stop"
    static let frameFileName = "voice-screen-frame.jpg"
    static let frameInterval: TimeInterval = 0.4
    static let markerFreshness: TimeInterval = 5
    static let minimumJPEGBytes = 4
    static let jpegStartMarker: [UInt8] = [0xff, 0xd8]
    static let jpegEndMarker: [UInt8] = [0xff, 0xd9]
    static let maximumFrameWidth: CGFloat = 1_280
    static let maximumFrameHeight: CGFloat = 720
    static let maximumFrameBytes = 1_000_000
    static let jpegQuality: CGFloat = 0.6

    static func containerURL() -> URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        )
    }
}
