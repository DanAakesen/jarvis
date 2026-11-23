import AVFoundation
import Combine
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
    init() {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--watch-fixture") else { return }
        var path: [WatchRoute] = []
        if arguments.contains("--watch-screen=chat") { path = [.chat] }
        if arguments.contains("--watch-screen=actions") { path = [.menu] }
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
        #endif
    }

    var body: some View {
        NavigationStack(path: $path) {
            WatchDashboardView(voiceActive: model.voiceID != nil)
                .navigationTitle("Jarvis")
            .navigationDestination(for: WatchRoute.self) { route in
                switch route {
                case .chat: WatchChatView(dictate: dictate, pendingDictation: $pendingDictation).watchCaptureReady("chat")
                case .menu:
                    menu.watchCaptureReady("actions")
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
            case .dashboard: path = []
            case .logLift: path = [.logLift]
            case .chat: path = [.chat]
            case .menu: path = [.menu]
            case .endVoice: Task { await model.endVoice() }
            }
            #if DEBUG
            WatchPreview.openedURL(url)
            #endif
        }
        .onAppear { openPendingReplyNotification() }
        .onReceive(NotificationCenter.default.publisher(for: .jarvisWatchReplyNotificationOpened)) { _ in
            openPendingReplyNotification()
        }
        .onChange(of: model.busy) { _, busy in
            if !busy { Task { await model.routePendingReplyIfPossible() } }
        }
        .onChange(of: model.startingVoice) { _, starting in
            if !starting { Task { await model.routePendingReplyIfPossible() } }
        }
        .onChange(of: model.voiceID) { _, voiceID in
            if voiceID == nil { Task { await model.routePendingReplyIfPossible() } }
        }
        .onChange(of: model.dictationState) { _, dictationState in
            if dictationState == .idle { Task { await model.routePendingReplyIfPossible() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification).receive(on: DispatchQueue.main)) { notification in
            guard notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt == AVAudioSession.InterruptionType.began.rawValue else { return }
            let reason = notification.userInfo?[AVAudioSessionInterruptionReasonKey] as? UInt
            if model.voiceID != nil { model.handleVoiceAudioInterruption(reason: reason) }
            if model.dictationState != .idle { model.interruptDictation() }
        }
        .onReceive(audioRouteChanges, perform: recoverAudioRoute)
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await WatchStepsMonitor.shared.requestAccessIfNeeded()
            while !Task.isCancelled {
                await WatchStepsMonitor.shared.refresh()
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
        .task(id: scenePhase) {
            if scenePhase == .active {
                await model.reconcileVoice()
                await model.routePendingReplyIfPossible()
                await connection.maintainConnection()
            }
        }
        .onChange(of: connection.reachable) { _, reachable in
            if reachable {
                Task {
                    await model.reconcileVoice()
                    await model.routePendingReplyIfPossible()
                }
            } else {
                model.recoverVoiceConnection()
            }
        }
    }
    private var audioRouteChanges: some Publisher<Notification, Never> {
        NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)
            .merge(with: NotificationCenter.default.publisher(for: .AVAudioEngineConfigurationChange))
            .receive(on: DispatchQueue.main)
    }

    private func recoverAudioRoute(_ notification: Notification) {
        if notification.name == AVAudioSession.routeChangeNotification {
            model.handleAudioRouteChange(reason: notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
        } else if let engine = notification.object as? AVAudioEngine {
            model.handleAudioRouteChange(changedEngine: engine)
        }
    }

    private func openPendingReplyNotification() {
        guard let target = JarvisReplyNotificationTarget.pending()
            ?? JarvisReplyNotificationTarget.active() else {
            return
        }
        path = [.chat]
        Task { await model.openReplyTarget(target) }
    }

    private var menu: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                menuGroup("Daily") {
                    menuLink("Agenda", "calendar", .agenda)
                    menuLink("Tasks", "checklist", .tasks)
                    menuLink("Notes", "note.text", .notes)
                    menuLink("Home brief", "sunrise", .home)
                }
                menuGroup("Health") {
                    menuLink("Log lift", "plus.circle", .logLift)
                    menuLink("Workouts", "figure.run", .workouts)
                    menuLink("Manage lifts", "dumbbell", .lifts)
                    menuLink("Nutrition", "fork.knife", .nutrition)
                    menuLink("Body Fat", "chart.line.uptrend.xyaxis", .bodyFat)
                    menuLink("Health summary", "heart", .health)
                }
                menuLink("Factory", "chevron.left.forwardslash.chevron.right", .factory)
            }.padding(.horizontal, 3)
        }
        .navigationTitle("Menu")
    }

    @ScaledMetric(relativeTo: .caption) private var menuTileWidth: CGFloat = 74

    private func menuGroup<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: menuTileWidth), spacing: 6)], spacing: 6) {
                content()
            }
        }
    }

    private func menuLink(_ title: LocalizedStringKey, _ symbol: String, _ route: WatchRoute) -> some View {
        NavigationLink(value: route) {
            VStack(alignment: .leading, spacing: 5) {
                Image(systemName: symbol)
                    .foregroundStyle(WatchStyle.amber).accessibilityHidden(true)
                Text(title).font(.system(.caption, design: .rounded, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(8)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .modifier(WatchSurface(radius: 14))
        }.buttonStyle(.plain)
    }

    private func dictate() {
        Task { await model.startDictation() }
    }
}
