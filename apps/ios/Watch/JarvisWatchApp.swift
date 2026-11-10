import AVFoundation
import SwiftUI
import WatchKit

@main
struct JarvisWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @StateObject private var model = WatchModel()
    var body: some Scene {
        WindowGroup {
            WatchRoot().environmentObject(model).environmentObject(model.connection)
                .tint(WatchStyle.amber)
        }
    }
}

enum WatchRoute: String, Hashable {
    case chat, menu, tasks, health, workouts, lifts, factory, agenda, bodyFat, notes, home, nutrition
    #if DEBUG
    case complications
    #endif
}
struct WatchRoot: View {
    @EnvironmentObject private var model: WatchModel
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.scenePhase) private var scenePhase
    @State private var path: [WatchRoute] = []
    @State private var pendingDictation = false
    @State private var page = 0
    var body: some View {
        NavigationStack(path: $path) {
            TabView(selection: $page) {
                WatchDashboardView().tag(0)
                actionPage.tag(1)
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: WatchRoute.self) { route in
                switch route {
                case .chat: WatchChatView(dictate: dictate, pendingDictation: $pendingDictation)
                case .menu:
                    List {
                        NavigationLink("Tasks Today", value: WatchRoute.tasks)
                        NavigationLink("Agenda", value: WatchRoute.agenda)
                        NavigationLink("Workouts", value: WatchRoute.workouts)
                        NavigationLink("Body Fat", value: WatchRoute.bodyFat)
                        NavigationLink("Recent Notes", value: WatchRoute.notes)
                        NavigationLink("Home", value: WatchRoute.home)
                        NavigationLink("Nutrition", value: WatchRoute.nutrition)
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
                case .agenda: WatchAgendaView()
                case .bodyFat: WatchBodyFatView()
                case .notes: WatchNotesView()
                case .home: WatchHomeBriefView()
                case .nutrition: WatchNutritionView()
                #if DEBUG
                case .complications: WatchComplicationPreviewView()
                #endif
                }
            }
        }
        .alert("Jarvis", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=chat") { path = [.chat] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=actions") { page = 1 }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=health") { path = [.health] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=tasks") { path = [.tasks] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=personal-new-task") ||
                ProcessInfo.processInfo.arguments.contains("--watch-screen=task-auto") ||
                ProcessInfo.processInfo.arguments.contains("--watch-screen=task-manual") ||
                ProcessInfo.processInfo.arguments.contains("--watch-screen=task-edit") ||
                ProcessInfo.processInfo.arguments.contains("--watch-screen=task-detail") { path = [.tasks] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=agenda") { path = [.agenda] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=body-fat") { path = [.bodyFat] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=notes") { path = [.notes] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=home") { path = [.home] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=nutrition") { path = [.nutrition] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=complications"),
               ProcessInfo.processInfo.arguments.contains("--watch-fixture") { path = [.complications] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=lifts") || ProcessInfo.processInfo.arguments.contains("--watch-screen=new-lift") { path = [.lifts] }
            if ProcessInfo.processInfo.arguments.contains("--watch-screen=new-task") || ProcessInfo.processInfo.arguments.contains("--watch-screen=project") { path = [.factory] }
            #endif
        }
        .onOpenURL { url in
            guard url.scheme == "jarvis-watch" else { return }
            switch url.host {
            case "dictate": path = [.chat]; pendingDictation = true
            case "voice": path = [.chat]; Task { await model.startVoice() }
            case "tasks": path = [.tasks]
            case "health": path = [.health]
            case "agenda": path = [.agenda]
            case "bodyFat", "bodyfat", "body-fat": path = [.bodyFat]
            case "notes": path = [.notes]
            case "home": path = [.home]
            case "nutrition": path = [.nutrition]
            case "dashboard": page = 0; path = []
            case "chat": path = [.chat]
            case "end-voice": Task { await model.endVoice() }
            default: path = [.menu]
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { _ in
            if model.voiceID != nil { Task { await model.endVoice() } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await connection.refresh() } }
        }
    }
    private var actionPage: some View {
        ScrollView {
            VStack(spacing: 8) {
                HStack {
                    Text("Jarvis").font(.system(.headline, design: .rounded))
                    Spacer()
                    Button { path.append(.menu) } label: { Image(systemName: "line.3.horizontal").foregroundStyle(WatchStyle.amber).frame(width: 36, height: 36).modifier(WatchSurface(radius: 18)) }
                        .buttonStyle(.plain).accessibilityLabel("Menu")
                }
                JarvisWatchAction(title: model.voiceID == nil ? "Voice" : "Resume voice", kind: .voice) {
                    path.append(.chat); Task { await model.startVoice() }
                }
                JarvisWatchAction(title: "Dictate", kind: .dictate) {
                    path.append(.chat); pendingDictation = true
                }
                JarvisWatchAction(title: "Factory", kind: .factory) { path.append(.factory) }
                if !connection.reachable { Text("Open Jarvis on your iPhone to connect.").font(.caption).foregroundStyle(.secondary) }
            }
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
