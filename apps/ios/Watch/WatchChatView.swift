import JarvisCore
import SwiftUI

struct WatchChatView: View {
    @EnvironmentObject private var model: WatchModel
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var editingDraft = false
    /// The reader reopened the composer while browsing history; any new scroll away from the end clears it.
    @State private var reopened = false
    @State private var reading = false
    @AccessibilityFocusState private var messageFocused: Bool
    @ScaledMetric(relativeTo: .body) private var clearance: CGFloat = 56
    var dictate: () -> Void
    @Binding var pendingDictation: Bool

    /// Distance from the newest message beyond which the reader counts as browsing history.
    private static let readingDistance: CGFloat = 80

    /// Drafting, dictation and voice keep their controls on screen; only an idle composer may shrink.
    private var composerBusy: Bool {
        !model.draft.isEmpty || model.voiceID != nil || model.startingVoice || model.dictationState != .idle
    }
    private var expanded: Bool { !reading || reopened || composerBusy }
    private var hasStatusRow: Bool { model.startingVoice || model.dictationState != .idle || model.voiceID != nil }
    private var composerDisabled: Bool {
        model.busy || model.startingVoice || model.voiceID != nil || model.dictationState != .idle
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            conversation
            composerLayer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editingDraft) {
            NavigationStack { WatchTextEditor(title: "Message", text: $model.draft) }
        }
        .task {
            beginPendingDictation()
            await model.history()
        }
        .onChange(of: pendingDictation) { _, pending in if pending { beginPendingDictation() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.history() } }
            else if phase == .background { model.interruptDictation() }
        }
        .onDisappear { model.interruptDictation() }
        .onChange(of: connection.reachable) { _, reachable in if reachable && !model.busy { Task { await model.history() } } }
    }

    /// One continuous scroll view; the system navigation bar and the floating composer sit above it.
    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if !connection.reachable {
                        Text("iPhone unavailable. Voice and sending need a connection.").font(.caption).foregroundStyle(.secondary)
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
            .task {
                #if DEBUG
                // Simulator capture of the reading-history state from synthetic messages.
                if ProcessInfo.processInfo.arguments.contains("--watch-chat-reading"), model.messages.count > 1 {
                    try? await Task.sleep(for: .milliseconds(600))
                    proxy.scrollTo(model.messages[1].id, anchor: .top)
                }
                #endif
            }
            // A fixed end margin keeps the last message clear of the controls and means the composer changing shape never moves the text.
            .contentMargins(.bottom, clearance + (hasStatusRow ? 34 : 0), for: .scrollContent)
            .ignoresSafeArea(.container, edges: .bottom)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                max(0, geometry.contentSize.height - geometry.visibleRect.maxY)
            } action: { _, distance in
                // Hysteresis keeps the composer from flickering around the threshold.
                let next = reading ? distance > Self.readingDistance / 3 : distance > Self.readingDistance
                guard next != reading else { return }
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) {
                    reading = next
                    if !next { reopened = false }
                }
            }
            .onScrollPhaseChange { _, phase in
                // A new scroll while reading history collapses a composer the reader had reopened.
                if phase.isScrolling, reading, reopened {
                    withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) { reopened = false }
                }
            }
            .onChange(of: model.messages.last?.text) { _, _ in
                guard !reading else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { proxy.scrollTo("latest", anchor: .bottom) }
            }
            .onChange(of: model.messages.last?.id) { _, _ in
                // Sending always returns to the conversation's end; incoming text never moves a reader.
                guard model.messages.last?.user == true else { return }
                reopened = true
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { proxy.scrollTo("latest", anchor: .bottom) }
            }
        }
    }

    private func reopenComposer() {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) { reopened = true }
        Task { await Task.yield(); messageFocused = true }
    }

    private func beginPendingDictation() {
        guard pendingDictation else { return }
        pendingDictation = false
        Task { await Task.yield(); dictate() }
    }

    private var composerLayer: some View {
        VStack(spacing: 0) {
            if expanded {
                composer
                    .background(alignment: .bottom) { WatchEdgeFade(edge: .bottom).frame(height: clearance + 24).offset(y: 8) }
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.9, anchor: .bottomTrailing)))
            } else {
                HStack {
                    Spacer(minLength: 0)
                    WatchIconButton(systemName: "ellipsis.bubble", label: "Reply", action: reopenComposer)
                }.padding(.horizontal, 6)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.8, anchor: .bottomTrailing)))
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 4) {
            if hasStatusRow {
                VStack(spacing: 2) { statusRows }
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .watchGlass(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .padding(.horizontal, 4)
            }
            HStack(spacing: 0) {
                Button { editingDraft = true } label: {
                    Text(model.draft.isEmpty ? "Message" : model.draft)
                        .foregroundStyle(model.draft.isEmpty ? Color.secondary : Color.primary)
                        .font(.caption).lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .disabled(composerDisabled)
                .accessibilityLabel("Message")
                .accessibilityValue(model.draft.isEmpty ? "Empty" : model.draft)
                .accessibilityFocused($messageFocused)
                if !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button { Task { await model.send() } } label: {
                        Image(systemName: "arrow.up.circle.fill").frame(width: 34, height: 44)
                    }
                    .foregroundStyle(WatchStyle.amber)
                    .disabled(composerDisabled).accessibilityLabel("Send message")
                }
                Button(action: dictate) { Image(systemName: "mic.fill").frame(width: 36, height: 44) }
                    .foregroundStyle(WatchStyle.amber)
                    .disabled(composerDisabled).accessibilityLabel("Dictate")
                Button { Task { await model.startVoice() } } label: { WatchOrb().frame(width: 26, height: 26).frame(width: 36, height: 44) }
                    .disabled(model.busy || model.startingVoice || model.dictationState != .idle).accessibilityLabel("Start voice")
            }.buttonStyle(.plain).padding(.leading, 12).padding(.trailing, 4)
                .watchGlass(in: Capsule())
                .padding(.horizontal, 4)
        }
    }

    @ViewBuilder private var statusRows: some View {
        if model.startingVoice {
            HStack {
                Text(model.waitingForVoiceConnection ? "Connecting to iPhone…" : "Starting voice…")
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { Task { await model.cancelVoiceStart() } }
                    .frame(minHeight: 32)
                    .accessibilityLabel("Cancel voice start")
            }.font(.caption2).buttonStyle(.plain)
        }
        if model.dictationState != .idle {
            HStack {
                if model.dictationState == .connecting {
                    Text("Preparing microphone…")
                } else if model.dictationState == .listening {
                    Text("Listening…")
                } else {
                    Text("Transcribing…")
                }
                Spacer()
                if model.dictationState == .listening {
                    Button("Stop") { Task { await model.stopDictation() } }
                        .frame(minHeight: 32)
                } else {
                    Button("Cancel") { model.cancelDictation() }
                        .frame(minHeight: 32)
                        .accessibilityLabel("Cancel dictation")
                }
            }.font(.caption2).buttonStyle(.plain)
        }
        if model.voiceID != nil {
            HStack {
                WatchOrb(activity: JarvisOrbActivity(watchVoiceStatus: model.voiceState, isMuted: model.muted), isAnimated: true)
                    .frame(width: 30, height: 30)
                Text(model.voiceState).font(.caption2)
                Spacer()
                Button { Task { await model.setMuted() } } label: {
                    Image(systemName: model.muted ? "mic.slash" : "mic").frame(width: 30, height: 32)
                }.accessibilityLabel(model.muted ? "Unmute" : "Mute")
                Button("End") { Task { await model.endVoice() } }.foregroundStyle(.red).frame(minHeight: 32)
            }.buttonStyle(.plain)
        }
    }
}
