import JarvisCore
import SwiftUI

/// Active live voice: one orb, one real state, the latest transcript text and Mute and End. It replaces the
/// Message composer while a session is live, so there is a single place to stop the microphone.
struct WatchVoiceView: View {
    @EnvironmentObject private var model: WatchModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Muted wins the label: the display must never say Listening while the microphone is off.
    private var label: String { model.muted ? "Muted" : (model.voiceState.isEmpty ? "Connecting" : model.voiceState) }
    private var transcript: String? {
        guard let text = model.messages.last?.text, !text.isEmpty else { return nil }
        return text
    }

    var body: some View {
        VStack(spacing: 4) {
            WatchOrb(activity: JarvisOrbActivity(watchVoiceStatus: model.voiceState, isMuted: model.muted), isAnimated: !reduceMotion)
                .frame(width: 52, height: 52)
            Text(label).font(.system(.footnote, design: .rounded, weight: .semibold)).foregroundStyle(WatchStyle.amber)
                .multilineTextAlignment(.center)
                .accessibilityLabel("Voice")
                .accessibilityValue(model.muted ? "Muted, \(model.voiceState)" : label)
            ScrollView {
                if let transcript {
                    Text(transcript).font(.body).frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityLabel(transcript)
                }
            }.defaultScrollAnchor(.top).frame(maxHeight: .infinity)
            ViewThatFits(in: .horizontal) {
                controls
                controls.dynamicTypeSize(...DynamicTypeSize.large)
            }
        }
        .padding(.horizontal, 6)
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
    }

    private var controls: some View {
        HStack(spacing: 6) {
            WatchLabelledButton(title: model.muted ? "Unmute" : "Mute", systemName: model.muted ? "mic.slash.fill" : "mic.fill") {
                Task { await model.setMuted() }
            }
            WatchLabelledButton(title: "End", systemName: "phone.down.fill", tint: .red) {
                Task { await model.endVoice() }
            }
        }
    }
}
