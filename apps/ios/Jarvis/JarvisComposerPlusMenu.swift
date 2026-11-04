import JarvisCore
import SwiftUI

/// What a choice in the composer plus menu asks for. Chat performs it directly; Home hands it to Chat.
enum JarvisComposerPlusAction: Equatable {
    case voiceLanguage(ChatLanguage)
    case shareScreen
    case video
    case files
    case photos
    case camera
}

/// The one composer plus menu, shared by Chat and Home so both open exactly the same choices: voice language,
/// screen sharing, video, attach (files, photo library) and camera. The screens differ only in what they do with
/// the chosen action and which entries are disabled. Identifiers are `identifier`, `identifier.screenShare`,
/// `identifier.video`, `identifier.attach` and `identifier.camera`.
/// HIG: Menus, Toolbars. API: Menu, Label.
struct JarvisComposerPlusMenu: View {
    let title: String
    var hint = ""
    let identifier: String
    var isDisabled = false
    let copy: (JarvisChatLocalizationKey) -> String
    var voiceLanguage: ChatLanguage?
    var isScreenSharing = false
    var isVideoEnabled = false
    var languageDisabled = false
    var screenShareDisabled = false
    var videoDisabled = false
    var attachDisabled = false
    var cameraDisabled = false
    let onAction: (JarvisComposerPlusAction) -> Void

    var body: some View {
        JarvisComposerMenuButton(
            title: title,
            systemImage: "plus",
            identifier: identifier,
            hint: hint,
            isDisabled: isDisabled
        ) {
            Menu {
                languageOption(.da, title: copy(.danish))
                languageOption(.en, title: copy(.english))
            } label: {
                Label(copy(.voiceLanguage), systemImage: "globe")
            }
            .disabled(languageDisabled)
            Button(
                isScreenSharing ? copy(.stopSharingScreen) : copy(.shareScreen),
                systemImage: isScreenSharing ? "stop.circle" : "rectangle.on.rectangle"
            ) {
                onAction(.shareScreen)
            }
            .accessibilityIdentifier("\(identifier).screenShare")
            .disabled(screenShareDisabled)
            Button(
                isVideoEnabled ? copy(.disableVideo) : copy(.enableVideo),
                systemImage: isVideoEnabled ? "video.slash" : "video"
            ) {
                onAction(.video)
            }
            .accessibilityIdentifier("\(identifier).video")
            .disabled(videoDisabled)
            Menu {
                Button(copy(.chooseFiles), systemImage: "doc") { onAction(.files) }
                Button(copy(.photoLibrary), systemImage: "photo.on.rectangle") { onAction(.photos) }
            } label: {
                Label(copy(.attach), systemImage: "paperclip")
            }
            .accessibilityIdentifier("\(identifier).attach")
            .disabled(attachDisabled)
            Button(copy(.camera), systemImage: "camera") { onAction(.camera) }
                .accessibilityIdentifier("\(identifier).camera")
                .disabled(cameraDisabled)
        }
    }

    private func languageOption(_ language: ChatLanguage, title: String) -> some View {
        Button {
            onAction(.voiceLanguage(language))
        } label: {
            if voiceLanguage == language {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }
}
