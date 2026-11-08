import SwiftUI
import WatchKit

@main
struct JarvisWatchApp: App {
    @StateObject private var model = WatchModel()
    var body: some Scene {
        WindowGroup {
            WatchRoot().environmentObject(model).environmentObject(model.connection)
                .tint(WatchStyle.amber)
        }
    }
}

enum WatchRoute: String, Hashable { case chat, menu, tasks, health, workouts, lifts, factory }
struct WatchRoot: View {
    @EnvironmentObject private var model: WatchModel
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.scenePhase) private var scenePhase
    @State private var path: [WatchRoute] = []
    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 8) {
                    HStack {
                        Text("Jarvis").font(.system(.headline, design: .rounded))
                        Spacer()
                        Button { path.append(.menu) } label: { Image(systemName: "line.3.horizontal").frame(width: 36, height: 36).modifier(WatchSurface(radius: 18)) }
                            .buttonStyle(.plain).accessibilityLabel("Menu")
                    }
                    JarvisWatchAction(title: model.voiceID == nil ? "Voice" : "Resume voice", kind: .voice) {
                        path.append(.chat); Task { await model.startVoice() }
                    }
                    JarvisWatchAction(title: "Dictate", kind: .dictate) {
                        path.append(.chat); dictate()
                    }
                    JarvisWatchAction(title: "Factory", kind: .factory) { path.append(.factory) }
                    if !connection.reachable { Text("Open Jarvis on your iPhone to connect.").font(.caption).foregroundStyle(.secondary) }
                }
            }.toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: WatchRoute.self) { route in
                switch route {
                case .chat: WatchChatView(dictate: dictate)
                case .menu:
                    List {
                        NavigationLink("Tasks Today", value: WatchRoute.tasks)
                        NavigationLink("Workouts", value: WatchRoute.workouts)
                        NavigationLink("Manage lifts", value: WatchRoute.lifts)
                    }.navigationTitle("Menu")
                case .health:
                    WatchHealthView(entry: .init(date: Date(), health: connection.snapshot, current: connection.snapshot?.isCurrent(at: Date()) == true))
                        .frame(height: 100).navigationTitle("Health")
                        .task { await connection.refresh() }
                case .tasks: WatchTasksView()
                case .workouts: WatchHealthList(lifts: false)
                case .lifts: WatchHealthList(lifts: true)
                case .factory: WatchFactoryView()
                }
            }
        }
        .alert("Jarvis", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=chat") { path = [.chat] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=health") { path = [.health] }
            #endif
        }
        .onOpenURL { url in
            guard url.scheme == "jarvis-watch" else { return }
            switch url.host {
            case "dictate": path = [.chat]; dictate()
            case "voice": path = [.chat]; Task { await model.startVoice() }
            case "tasks": path = [.tasks]
            case "health": path = [.health]
            case "chat": path = [.chat]
            case "end-voice": Task { await model.endVoice() }
            default: path = [.menu]
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await connection.refresh() } }
        }
    }
    private func dictate() {
        guard connection.reachable else { model.error = "Connect to your iPhone and open Jarvis."; return }
        guard model.voiceID == nil else { model.error = "End voice before dictating a message."; return }
        guard let controller = WKExtension.shared().visibleInterfaceController else {
            model.error = "Tap the message field to enter or dictate text."; return
        }
        controller.presentTextInputController(withSuggestions: nil, allowedInputMode: .plain) { values in
            Task { @MainActor in
                guard let text = values?.first as? String, !text.isEmpty else { return }
                model.draft = model.draft.isEmpty ? text : model.draft + " " + text
            }
        }
    }
}
