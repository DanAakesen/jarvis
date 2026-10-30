import ReplayKit
import SwiftUI

struct VoiceSystemBroadcastPicker: UIViewRepresentable {
    var accessibilityLabel: String

    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: .zero)
        picker.preferredExtension = VoiceScreenShareContract.broadcastExtensionIdentifier
        picker.showsMicrophoneButton = false
        picker.accessibilityLabel = accessibilityLabel
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {
        uiView.accessibilityLabel = accessibilityLabel
    }
}
