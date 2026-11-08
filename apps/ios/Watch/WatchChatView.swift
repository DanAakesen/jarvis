import SwiftUI

struct WatchChatView: View {
    @EnvironmentObject private var model: WatchModel
    @EnvironmentObject private var connection: WatchConnection
    var dictate: () -> Void
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 9) {
                    if !connection.reachable { Text("iPhone unavailable").foregroundStyle(.secondary) }
                    ForEach(model.messages) { message in
                        HStack {
                            if message.user { Spacer(minLength: 12) }
                            Text(message.text).font(.body)
                                .padding(message.user ? 8 : 0)
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
            .onChange(of: model.messages.last?.text) { _, _ in withAnimation { proxy.scrollTo("latest", anchor: .bottom) } }
        }
        .navigationTitle("Jarvis").navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 2) {
            VStack(spacing: 3) {
                if model.voiceID != nil {
                    HStack {
                        Text(model.voiceState).font(.caption2)
                        Spacer()
                        Button { Task { await model.setMuted() } } label: { Image(systemName: model.muted ? "mic.slash" : "mic") }
                            .accessibilityLabel(model.muted ? "Unmute" : "Mute")
                        Button("End") { Task { await model.endVoice() } }.tint(.red)
                    }.buttonStyle(.plain).frame(minHeight: 32)
                }
                HStack(spacing: 4) {
                    TextField("Message", text: $model.draft).font(.caption).disabled(model.voiceID != nil || model.busy)
                        .accessibilityLabel("Message draft")
                    if !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button { Task { await model.send() } } label: { Image(systemName: "arrow.up.circle.fill") }
                            .disabled(model.busy || !connection.reachable || model.voiceID != nil).accessibilityLabel("Send message")
                    }
                    Button(action: dictate) { Image(systemName: "mic.fill").frame(width: 28, height: 34) }
                        .disabled(!connection.reachable || model.busy || model.voiceID != nil).accessibilityLabel("Dictate into draft")
                    Button { Task { await model.startVoice() } } label: { WatchWave().frame(width: 22, height: 18).frame(width: 28, height: 34) }
                        .disabled(!connection.reachable || model.busy || model.voiceID != nil).accessibilityLabel("Start voice session")
                }.buttonStyle(.plain).padding(.horizontal, 8).background(WatchStyle.surface, in: Capsule())
            }.background(.black)
        }
        .task { if model.messages.isEmpty { await model.history() } }
        .onChange(of: connection.reachable) { _, reachable in if reachable && !model.busy { Task { await model.history() } } }
    }
}
