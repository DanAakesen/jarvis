import Combine
import Foundation
import JarvisCore
import WatchConnectivity
import WidgetKit

@MainActor
final class WatchConnection: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchConnection()
    @Published private(set) var reachable = false
    @Published private(set) var connecting = true
    @Published private(set) var snapshot: WatchHealthSnapshot?
    @Published private(set) var dashboard: WatchDashboardSnapshot?
    var dashboardSnapshot: WatchDashboardSnapshot? { dashboard }
    @Published private(set) var dashboardError: String?
    @Published private(set) var briefError: String?
    var onEvent: ((WatchEvent) -> Void)?
    var onDisconnect: (() -> Void)?
    private var pending: [UUID: CheckedContinuation<WatchReply, Error>] = [:]
    private var deadlines: [UUID: Task<Void, Never>] = [:]
    private var dashboardRefreshing = false
    private var briefRefreshing = false
    private var cachedBrief: WatchBriefSummary?
    private var cacheGeneration = UUID()
    override init() {
        super.init()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            reachable = true
            var sample = WatchHealthSnapshot()
            sample.steps = 6420; sample.stepGoal = 8000
            sample.hourlySteps = [0, 0, 0, 0, 0, 100, 500, 600, 300, 100, 200, 400, 700, 500, 400, 300, 600, 700, 420, 600]
            sample.gym = 3; sample.gymGoal = 4; sample.runs = 1; sample.runGoal = 2
            sample.dailyKcal = 480; sample.weeklyKcal = 2860; sample.tasksToday = 3
            snapshot = sample
            dashboard = WatchPreview.dashboard()
            return
        }
        #endif
        if let data = WatchSnapshotStore.appGroup()?.load(.health),
           data.count <= WatchLimits.payloadBytes,
           let cached = try? JSONDecoder().decode(WatchHealthSnapshot.self, from: data), cached.version == 1 {
            save(cached)
        }
        if let data = WatchSnapshotStore.appGroup()?.load(.dashboard),
           data.count <= WatchLimits.payloadBytes,
           let cached = try? JSONDecoder().decode(WatchDashboardSnapshot.self, from: data), cached.version == 1 {
            saveDashboard(cached)
            cachedBrief = cached.brief
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self; WCSession.default.activate()
    }
    func request(_ request: WatchRequest) async throws -> WatchReply {
        guard reachable else { throw WatchFailure.unavailable }
        guard request.isValid else { throw WatchFailure.invalidRequest }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") { return try WatchPreview.reply(to: request) }
        #endif
        guard pending[request.id] == nil else { throw WatchFailure.busy }
        let epoch = cacheGeneration
        let data = try WatchCodec.encode(WatchWire.request(request))
        let reply: WatchReply = try await withCheckedThrowingContinuation { continuation in
            pending[request.id] = continuation
            deadlines[request.id] = Task { [weak self] in
                try? await Task.sleep(for: request.action == .finishDictation ? WatchLimits.dictationWatchTimeout : .seconds(25))
                guard !Task.isCancelled else { return }
                self?.complete(request.id, .failure(WatchFailure.unavailable))
            }
            WCSession.default.sendMessageData(data, replyHandler: { [weak self] data in
                Task { @MainActor in
                    guard data.count < WatchLimits.wireBytes,
                          let reply = try? JSONDecoder().decode(WatchReply.self, from: data), reply.id == request.id, reply.version == 1,
                          (reply.data?.count ?? 0) <= WatchLimits.payloadBytes else {
                        self?.complete(request.id, .failure(WatchFailure.failed)); return
                    }
                    if let failure = reply.failure {
                        self?.complete(request.id, .failure(failure))
                    }
                    else if let taskError = reply.taskError { self?.complete(request.id, .failure(taskError)) }
                    else { self?.complete(request.id, .success(reply)) }
                }
            }, errorHandler: { [weak self] _ in
                Task { @MainActor in self?.complete(request.id, .failure(WatchFailure.unavailable)) }
            })
        }
        guard epoch == cacheGeneration else { throw WatchFailure.signInRequired }
        return reply
    }
    func waitForVoiceConnection() async throws {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") { return }
        #endif
        guard WCSession.isSupported() else { throw WatchFailure.unavailable }
        let session = WCSession.default
        let deadline = Date().addingTimeInterval(8)
        var delay = 250
        while Date() < deadline {
            try Task.checkCancellation()
            if session.activationState == .notActivated { session.activate() }
            if session.activationState == .activated {
                guard session.isCompanionAppInstalled else { throw WatchFailure.unavailable }
                if session.isReachable {
                    if !reachable { updateReachability() }
                    return
                }
            }
            try await Task.sleep(for: .milliseconds(delay))
            delay = min(delay * 2, 1_000)
        }
        throw WatchFailure.unavailable
    }
    func load<T: Decodable>(_ action: WatchAction, id: String? = nil, as type: T.Type = T.self) async throws -> T {
        let reply = try await request(.init(action: action, itemID: id))
        guard let data = reply.data else { throw WatchFailure.failed }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func refresh() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") { return }
        #endif
        guard reachable else { return }
        async let health: Void = refreshHealth()
        async let dashboard: Void = refreshDashboard()
        async let brief: Void = refreshBrief()
        _ = await (health, dashboard, brief)
    }
    func maintainConnection() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") { return }
        #endif
        guard WCSession.isSupported() else { connecting = false; return }
        connecting = !reachable
        var first = true
        while !Task.isCancelled {
            if WCSession.default.activationState == .notActivated { WCSession.default.activate() }
            let current = WCSession.default.activationState == .activated && WCSession.default.isReachable
            if current != reachable { updateReachability() }
            if reachable && (first || dashboardError != nil || dashboard?.isCurrent(at: Date()) != true || snapshot?.isCurrent(at: Date()) != true) {
                await refresh()
            }
            first = false
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            connecting = false
        }
    }
    private func refreshHealth() async {
        let epoch = cacheGeneration
        do {
            let value: WatchHealthSnapshot = try await load(.snapshot)
            guard epoch == cacheGeneration else { return }
            save(value)
        }
        catch { /* Screens present their own explicit connection state; no fabricated values. */ }
    }
    func refreshDashboard() async {
        guard !dashboardRefreshing else { return }
        dashboardRefreshing = true
        defer { dashboardRefreshing = false }
        let epoch = cacheGeneration
        do {
            var value: WatchDashboardSnapshot = try await load(.dashboard)
            guard epoch == cacheGeneration else { return }
            if let cachedBrief, value.brief == nil || cachedBrief.generatedAt > value.brief!.generatedAt {
                value.brief = cachedBrief
            }
            saveDashboard(value)
            dashboardError = nil
        } catch {
            dashboardError = (error as? WatchFailure)?.message ?? WatchFailure.failed.message
        }
    }
    func refreshBrief(force: Bool = false) async {
        guard !briefRefreshing else { return }
        if !force, let cachedBrief, cachedBrief.isCurrent(at: Date()) { return }
        briefRefreshing = true
        defer { briefRefreshing = false }
        let epoch = cacheGeneration
        do {
            let value: WatchBriefSummary = try await load(.brief)
            guard epoch == cacheGeneration else { return }
            cachedBrief = value
            var current = dashboard ?? WatchDashboardSnapshot(now: value.generatedAt)
            current.brief = value
            saveDashboard(current)
            briefError = nil
        } catch {
            briefError = (error as? WatchFailure)?.message ?? WatchFailure.failed.message
        }
    }
    func loadAgenda(offset: Int = 0) async throws -> WatchAgendaPage {
        try await page(.agenda, options: .init(offset: offset))
    }
    func loadTasks(offset: Int = 0) async throws -> WatchTaskPage {
        try await page(.tasks, options: .init(offset: offset))
    }
    func loadTask(id: String) async throws -> VaultTask? {
        try await load(.tasks, id: id)
    }
    func loadNotes(offset: Int = 0) async throws -> WatchNotesPage {
        try await page(.notes, options: .init(offset: offset))
    }
    func loadNote(path: String, offset: Int = 0, revision: String? = nil) async throws -> WatchNoteDetail {
        try await page(.note, text: path, options: .init(offset: offset, revision: revision))
    }
    private func page<T: Decodable>(_ action: WatchAction, text: String? = nil, options: WatchPageRequest) async throws -> T {
        let reply = try await request(.init(action: action, text: text, data: try JSONEncoder().encode(options)))
        guard let data = reply.data else { throw WatchFailure.failed }
        return try JSONDecoder().decode(T.self, from: data)
    }
    private func complete(_ id: UUID, _ result: Result<WatchReply, Error>) {
        deadlines.removeValue(forKey: id)?.cancel()
        pending.removeValue(forKey: id)?.resume(with: result)
    }
    private func save(_ incoming: WatchHealthSnapshot) {
        guard incoming.version == 1 else { return }
        var value = incoming
        if let old = snapshot {
            guard incoming.generatedAt >= old.generatedAt else { return }
            var retained = false
            if value.steps == nil, let steps = old.steps {
                value.steps = steps; value.hourlySteps = old.hourlySteps; retained = true
            }
            if value.stepGoal == nil, let v = old.stepGoal { value.stepGoal = v; retained = true }
            if value.gym == nil, let v = old.gym { value.gym = v; retained = true }
            if value.gymGoal == nil, let v = old.gymGoal { value.gymGoal = v; retained = true }
            if value.runs == nil, let v = old.runs { value.runs = v; retained = true }
            if value.runGoal == nil, let v = old.runGoal { value.runGoal = v; retained = true }
            if value.dailyKcal == nil, let v = old.dailyKcal { value.dailyKcal = v; retained = true }
            if value.weeklyKcal == nil, let v = old.weeklyKcal { value.weeklyKcal = v; retained = true }
            if value.tasksToday == nil, let v = old.tasksToday { value.tasksToday = v; retained = true }
            if retained {
                value.generatedAt = old.generatedAt
                value.dayStart = old.dayStart
                value.weekStart = old.weekStart
            }
        }
        snapshot = value
        do {
            guard let store = WatchSnapshotStore.appGroup() else { throw WatchFailure.failed }
            try store.save(JSONEncoder().encode(value), kind: .health)
        } catch { NSLog("Watch health snapshot could not be saved.") }
        WidgetCenter.shared.reloadAllTimelines()
    }
    private func saveDashboard(_ incoming: WatchDashboardSnapshot) {
        guard incoming.version == 1 else { return }
        var value = incoming
        if let old = dashboard {
            let onlyBrief = old.agenda == nil && old.bodyFat == nil && old.todayTasks == nil &&
                old.upcomingTasks == nil && old.notes == nil && old.nutrition == nil
            guard onlyBrief || incoming.generatedAt >= old.generatedAt else { return }
            var retained = false
            if value.agenda == nil, let v = old.agenda { value.agenda = v; retained = true }
            if value.bodyFat == nil, let v = old.bodyFat { value.bodyFat = v; retained = true }
            if value.todayTasks == nil, let v = old.todayTasks { value.todayTasks = v; retained = true }
            if value.upcomingTasks == nil, let v = old.upcomingTasks { value.upcomingTasks = v; retained = true }
            if value.notes == nil, let v = old.notes { value.notes = v; retained = true }
            if value.nutrition == nil, let v = old.nutrition { value.nutrition = v; retained = true }
            if let brief = old.brief, value.brief == nil || brief.generatedAt > value.brief!.generatedAt {
                value.brief = brief
            }
            if retained { value.generatedAt = old.generatedAt }
        }
        guard let bounded = try? value.bounded(), let data = try? JSONEncoder().encode(bounded),
              data.count <= WatchLimits.payloadBytes else {
            NSLog("Watch dashboard snapshot could not be encoded.")
            return
        }
        value = bounded
        dashboard = value
        do {
            guard let store = WatchSnapshotStore.appGroup() else { throw WatchFailure.failed }
            try store.save(data, kind: .dashboard)
        } catch { NSLog("Watch dashboard snapshot could not be saved.") }
        WidgetCenter.shared.reloadAllTimelines()
    }
    private func clearCachedData() {
        cacheGeneration = UUID()
        snapshot = nil; dashboard = nil; cachedBrief = nil
        for id in Array(pending.keys) { complete(id, .failure(WatchFailure.signInRequired)) }
        WatchSnapshotStore.appGroup()?.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }
    private func updateReachability() {
        let wasReachable = reachable
        reachable = WCSession.default.activationState == .activated && WCSession.default.isReachable
        if reachable { connecting = false }
        UserDefaults(suiteName: "group.com.danaakesen.jarvis")?.set(reachable, forKey: "watch.reachable")
        WidgetCenter.shared.reloadAllTimelines()
        if !reachable {
            for id in Array(pending.keys) { complete(id, .failure(WatchFailure.unavailable)) }
            if wasReachable { onDisconnect?() }
        }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.updateReachability(); await self.refresh() }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.updateReachability(); if self.reachable { await self.refresh() } }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        guard case .event(let event) = try? JSONDecoder().decode(WatchWire.self, from: messageData), event.version == 1 else { return }
        Task { @MainActor in self.onEvent?(event) }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data, replyHandler: @escaping (Data) -> Void) {
        guard case .event(let event) = try? JSONDecoder().decode(WatchWire.self, from: messageData), event.version == 1 else { replyHandler(Data()); return }
        Task { @MainActor in self.onEvent?(event); replyHandler(Data([1])) }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let data = applicationContext["health"] as? Data
        let dashboardData = applicationContext["dashboard"] as? Data
        Task { @MainActor in
            if let data, data.count <= WatchLimits.payloadBytes,
               let value = try? JSONDecoder().decode(WatchHealthSnapshot.self, from: data) { self.save(value) }
            else if data == nil, dashboardData == nil { self.clearCachedData(); return }
            if let dashboardData, dashboardData.count <= WatchLimits.payloadBytes,
               let value = try? JSONDecoder().decode(WatchDashboardSnapshot.self, from: dashboardData) {
                self.saveDashboard(value)
                self.cachedBrief = self.dashboard?.brief
            }
        }
    }
}
