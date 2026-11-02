import ReplayKit
import SwiftUI

enum VoiceBroadcastExtension {
    static var isInstalled: Bool {
        guard let plugIns = Bundle.main.builtInPlugInsURL,
              let urls = try? FileManager.default.contentsOfDirectory(at: plugIns, includingPropertiesForKeys: nil) else {
            return false
        }
        return urls.contains {
            Bundle(url: $0)?.bundleIdentifier == VoiceScreenShareContract.broadcastExtensionIdentifier
        }
    }
}

/// Hosts the system `RPSystemBroadcastPickerView`. Changing `presentationToken` presents the picker's
/// Start Broadcast sheet, because the system view only exposes its own small button.
struct VoiceSystemBroadcastPicker: UIViewRepresentable {
    var accessibilityLabel: String
    var presentationToken = 0

    final class Coordinator {
        var presentedToken = 0
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: .zero)
        picker.preferredExtension = VoiceScreenShareContract.broadcastExtensionIdentifier
        picker.showsMicrophoneButton = false
        picker.accessibilityLabel = accessibilityLabel
        context.coordinator.presentedToken = presentationToken
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {
        uiView.accessibilityLabel = accessibilityLabel
        guard presentationToken != context.coordinator.presentedToken else { return }
        context.coordinator.presentedToken = presentationToken
        uiView.subviews.compactMap { $0 as? UIButton }.first?.sendActions(for: .touchUpInside)
    }
}
