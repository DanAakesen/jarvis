import SwiftUI

struct WatchChatView: View {
    @EnvironmentObject private var model: WatchModel
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var dictate: () -> Void
    var body: some View {
        VStack(spacing: 3) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if !connection.reachable { Text("iPhone unavailable").foregroundStyle(.secondary) }
                        ForEach(model.messages) { message in
                            HStack {
                                if message.user { Spacer(minLength: 12) }
                                Text(message.text).font(.body)
                                    .padding(message.user ? 7 : 0)
                                    .background {
                                        if message.user {
                                            RoundedRectangle(cornerRadius: 15).fill(WatchStyle.amber.opacity(0.12))
                                                .overlay { RoundedRectangle(cornerRadius: 15).stroke(WatchStyle.amber.opacity(0.34), lineWidth: 0.5) }
                                        }
                                    }
                                    .accessibilityLabel("\(message.user ? "You" : "Jarvis"): \(message.text)")
                                if !message.user { Spacer(minLength: 0) }
                            }.id(message.id)
                        }
                        Color.clear.frame(height: 1).id("latest")
                    }
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: model.messages.last?.text) { _, _ in
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { proxy.scrollTo("latest", anchor: .bottom) }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
            composer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Jarvis").navigationBarTitleDisplayMode(.inline)
        .task { if model.messages.isEmpty { await model.history() } }
        .onChange(of: connection.reachable) { _, reachable in if reachable && !model.busy { Task { await model.history() } } }
    }
    private var composer: some View {
        VStack(spacing: 3) {
            if model.voiceID != nil {
                HStack {
                    Text(model.voiceState).font(.caption2)
                    Spacer()
                    Button { Task { await model.setMuted() } } label: {
                        Image(systemName: model.muted ? "mic.slash" : "mic").frame(width: 30, height: 32)
                    }.accessibilityLabel(model.muted ? "Unmute" : "Mute")
                    Button("End") { Task { await model.endVoice() } }.foregroundStyle(.red).frame(minHeight: 32)
                }.buttonStyle(.plain)
            }
            HStack(spacing: 2) {
                TextField("Message", text: $model.draft)
                    .textFieldStyle(.plain).font(.caption).frame(height: 36)
                    .disabled(model.voiceID != nil || model.busy).accessibilityLabel("Message draft")
                if !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button { Task { await model.send() } } label: { Image(systemName: "arrow.up.circle.fill") }
                        .foregroundStyle(WatchStyle.amber)
                        .disabled(model.busy || !connection.reachable || model.voiceID != nil).accessibilityLabel("Send message")
                }
                Button(action: dictate) { Image(systemName: "mic.fill").frame(width: 32, height: 38) }
                    .foregroundStyle(WatchStyle.amber)
                    .disabled(!connection.reachable || model.busy || model.voiceID != nil).accessibilityLabel("Dictate into draft")
                Button { Task { await model.startVoice() } } label: { WatchWave().frame(width: 22, height: 18).frame(width: 32, height: 38) }
                    .disabled(!connection.reachable || model.busy || model.voiceID != nil).accessibilityLabel("Start voice session")
            }.buttonStyle(.plain).padding(.horizontal, 8)
                .background(WatchStyle.surface, in: Capsule())
                .overlay { Capsule().stroke(.white.opacity(0.2), lineWidth: 0.5) }
        }
    }
}
