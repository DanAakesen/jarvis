import AVFoundation
import JarvisCore
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
    case chat, menu, tasks, health, workouts, lifts, factory, agenda, bodyFat, notes, home, nutrition, logLift
    #if DEBUG
    case complications, logLiftComplication, taskDetail, taskEdit, personalNewTask, project, factoryNewTask, newLift
    #endif
}
struct WatchRoot: View {
    @EnvironmentObject private var model: WatchModel
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.scenePhase) private var scenePhase
    @State private var path: [WatchRoute] = []
    @State private var pendingDictation = false
    @State private var page = 0
    init() {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--watch-fixture") else { return }
        var path: [WatchRoute] = []
        var page = 0
        if arguments.contains("--watch-screen=chat") { path = [.chat] }
        if arguments.contains("--watch-screen=actions") { page = 1 }
        if arguments.contains("--watch-screen=health") { path = [.health] }
        if arguments.contains("--watch-screen=tasks") { path = [.tasks] }
        if arguments.contains("--watch-screen=personal-new-task") ||
            arguments.contains("--watch-screen=task-auto") ||
            arguments.contains("--watch-screen=task-manual") { path = [.personalNewTask] }
        if arguments.contains("--watch-screen=task-detail") { path = [.taskDetail] }
        if arguments.contains("--watch-screen=task-edit") { path = [.taskEdit] }
        if arguments.contains("--watch-screen=agenda") { path = [.agenda] }
        if arguments.contains("--watch-screen=body-fat") { path = [.bodyFat] }
        if arguments.contains("--watch-screen=notes") { path = [.notes] }
        if arguments.contains("--watch-screen=home") { path = [.home] }
        if arguments.contains("--watch-screen=nutrition") { path = [.nutrition] }
        if arguments.contains("--watch-screen=complications") { path = [.complications] }
        if arguments.contains("--watch-screen=lifts") { path = [.lifts] }
        if arguments.contains("--watch-screen=new-lift") { path = [.newLift] }
        if arguments.contains("--watch-screen=new-task") { path = [.factoryNewTask] }
        if arguments.contains("--watch-screen=project") { path = [.project] }
        if arguments.contains("--watch-screen=log-lift") { path = [.logLift] }
        if arguments.contains("--watch-screen=log-lift-complication") { path = [.logLiftComplication] }
        _path = State(initialValue: path)
        _page = State(initialValue: page)
        #endif
    }

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
                case .chat: WatchChatView(dictate: dictate, pendingDictation: $pendingDictation).watchCaptureReady("chat")
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
                        .watchCaptureReady("health")
                case .tasks: WatchTasksView()
                case .workouts: WatchHealthList(lifts: false)
                case .lifts: WatchHealthList(lifts: true)
                case .factory: WatchFactoryView()
                case .agenda: WatchAgendaView().watchCaptureReady("agenda")
                case .bodyFat: WatchBodyFatView().watchCaptureReady("body-fat")
                case .notes: WatchNotesView().watchCaptureReady("notes")
                case .home: WatchHomeBriefView().watchCaptureReady("home")
                case .nutrition: WatchNutritionView().watchCaptureReady("nutrition")
                case .logLift:
                    WatchLiftCaptureView {
                        path.append(.chat); Task { await model.startVoice() }
                    }.watchCaptureReady("log-lift")
                #if DEBUG
                case .complications: WatchComplicationPreviewView().watchCaptureReady("complications")
                case .logLiftComplication:
                    WatchLogLiftComplicationView().frame(width: 52, height: 52)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .navigationTitle("Log lift")
                        .watchCaptureReady("log-lift-complication")
                case .taskDetail: WatchTaskDetailView(task: WatchPreview.captureTask()) { _ in }
                case .taskEdit: WatchPersonalTaskEditor(task: WatchPreview.captureTask()) { _ in }
                case .personalNewTask: WatchPersonalTaskEditor { _ in }
                case .newLift: WatchLiftEditor { }
                case .project:
                    if let project = try? WatchPreview.project() { WatchFactoryTasks(project: project) }
                case .factoryNewTask:
                    if let project = try? WatchPreview.project() { WatchFactoryTaskEditor(project: project) { } }
                #endif
                }
            }
        }
        .alert("Jarvis", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onOpenURL { url in
            guard url.scheme?.lowercased() == "jarvis-watch" else { return }
            guard let link = WatchAppLink(url: url) else { path = [.menu]; return }
            switch link {
            case .dictate: path = [.chat]; pendingDictation = true
            case .voice: path = [.chat]; Task { await model.startVoice() }
            case .tasks: path = [.tasks]
            case .health: path = [.health]
            case .agenda: path = [.agenda]
            case .bodyFat: path = [.bodyFat]
            case .notes: path = [.notes]
            case .home: path = [.home]
            case .nutrition: path = [.nutrition]
            case .dashboard: page = 0; path = []
            case .logLift: path = [.logLift]
            case .chat: path = [.chat]
            case .menu: path = [.menu]
            case .endVoice: Task { await model.endVoice() }
            }
            #if DEBUG
            WatchPreview.openedURL(url)
            #endif
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { _ in
            if model.voiceID != nil { Task { await model.endVoice() } }
        }
        .task(id: scenePhase) {
            if scenePhase == .active {
                await model.reconcileVoice()
                await connection.maintainConnection()
            }
        }
        .onChange(of: connection.reachable) { _, reachable in
            if reachable { Task { await model.reconcileVoice() } }
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
                if !connection.reachable { Text("iPhone unavailable. Voice and sending need a connection.").font(.caption).foregroundStyle(.secondary) }
            }
        }.watchCaptureReady("actions")
    }
    private func dictate() {
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
