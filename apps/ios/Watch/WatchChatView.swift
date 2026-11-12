import SwiftUI

struct WatchChatView: View {
    @EnvironmentObject private var model: WatchModel
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var editingDraft = false
    var dictate: () -> Void
    @Binding var pendingDictation: Bool
    var body: some View {
        VStack(spacing: 3) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if !connection.reachable {
                            Text("iPhone unavailable").foregroundStyle(.secondary)
                        } else if let error = model.historyError {
                            Text(error).font(.caption).foregroundStyle(.secondary)
                                .accessibilityIdentifier("watch.history.error")
                        }
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
        .sheet(isPresented: $editingDraft) {
            NavigationStack { WatchTextEditor(title: "Message", text: $model.draft) }
        }
         .task {
            beginPendingDictation()
            await model.history()
        }
        .onChange(of: pendingDictation) { _, pending in if pending { beginPendingDictation() } }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await model.history() } } }
        .onChange(of: connection.reachable) { _, reachable in if reachable && !model.busy { Task { await model.history() } } }
    }
    private func beginPendingDictation() {
        guard pendingDictation else { return }
        pendingDictation = false
        Task { await Task.yield(); dictate() }
    }
    private var composer: some View {
        VStack(spacing: 3) {
            if model.waitingForVoiceConnection {
                Text("Connecting to iPhone…").font(.caption2).foregroundStyle(.secondary)
            }
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
                Button { editingDraft = true } label: {
                    Text(model.draft.isEmpty ? "Message" : model.draft)
                        .foregroundStyle(model.draft.isEmpty ? Color.secondary : Color.primary)
                        .font(.caption).lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .disabled(model.voiceID != nil || model.busy)
                .accessibilityLabel("Message draft")
                .accessibilityValue(model.draft.isEmpty ? "Empty" : model.draft)
                if !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button { Task { await model.send() } } label: { Image(systemName: "arrow.up.circle.fill") }
                        .foregroundStyle(WatchStyle.amber)
                        .disabled(model.busy || !connection.reachable || model.voiceID != nil).accessibilityLabel("Send message")
                }
                Button(action: dictate) { Image(systemName: "mic.fill").frame(width: 32, height: 38) }
                    .foregroundStyle(WatchStyle.amber)
                    .disabled(model.busy || model.voiceID != nil).accessibilityLabel("Dictate into draft")
                Button { Task { await model.startVoice() } } label: { WatchWave().frame(width: 22, height: 18).frame(width: 32, height: 38) }
                    .disabled(model.busy).accessibilityLabel("Start voice session")
            }.buttonStyle(.plain).padding(.horizontal, 8)
                .background(WatchStyle.surface, in: Capsule())
                .overlay { Capsule().stroke(.white.opacity(0.2), lineWidth: 0.5) }
        }
    }
}
