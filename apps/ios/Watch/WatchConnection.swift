import Combine
import Foundation
import JarvisCore
import WatchConnectivity
import WidgetKit

@MainActor
final class WatchConnection: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var reachable = false
    @Published private(set) var snapshot: WatchHealthSnapshot?
    var onEvent: ((WatchEvent) -> Void)?
    var onDisconnect: (() -> Void)?
    private var pending: [UUID: CheckedContinuation<WatchReply, Error>] = [:]
    private var deadlines: [UUID: Task<Void, Never>] = [:]
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
            return
        }
        #endif
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self; WCSession.default.activate()
    }
    func request(_ request: WatchRequest) async throws -> WatchReply {
        guard reachable else { throw WatchFailure.unavailable }
        guard request.isValid else { throw WatchFailure.invalidRequest }
        guard pending[request.id] == nil else { throw WatchFailure.busy }
        let data = try JSONEncoder().encode(WatchWire.request(request))
        return try await withCheckedThrowingContinuation { continuation in
            pending[request.id] = continuation
            deadlines[request.id] = Task { [weak self] in
                try? await Task.sleep(for: .seconds(25))
                guard !Task.isCancelled else { return }
                self?.complete(request.id, .failure(WatchFailure.unavailable))
            }
            WCSession.default.sendMessageData(data, replyHandler: { [weak self] data in
                Task { @MainActor in
                    guard let reply = try? JSONDecoder().decode(WatchReply.self, from: data), reply.id == request.id, reply.version == 1 else {
                        self?.complete(request.id, .failure(WatchFailure.failed)); return
                    }
                    if let failure = reply.failure { self?.complete(request.id, .failure(failure)) }
                    else { self?.complete(request.id, .success(reply)) }
                }
            }, errorHandler: { [weak self] _ in
                Task { @MainActor in self?.complete(request.id, .failure(WatchFailure.unavailable)) }
            })
        }
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
        do {
            let value: WatchHealthSnapshot = try await load(.snapshot)
            save(value)
        } catch { /* Screens present their own explicit connection state; no fabricated values. */ }
    }
    private func complete(_ id: UUID, _ result: Result<WatchReply, Error>) {
        deadlines.removeValue(forKey: id)?.cancel()
        pending.removeValue(forKey: id)?.resume(with: result)
    }
    private func save(_ value: WatchHealthSnapshot) {
        snapshot = value
        let defaults = UserDefaults(suiteName: "group.com.danaakesen.jarvis")
        defaults?.set(try? JSONEncoder().encode(value), forKey: "watch.health")
        WidgetCenter.shared.reloadAllTimelines()
    }
    private func updateReachability() {
        reachable = WCSession.default.activationState == .activated && WCSession.default.isReachable
        UserDefaults(suiteName: "group.com.danaakesen.jarvis")?.set(reachable, forKey: "watch.reachable")
        WidgetCenter.shared.reloadAllTimelines()
        if !reachable {
            for id in Array(pending.keys) { complete(id, .failure(WatchFailure.unavailable)) }
            snapshot = nil; onDisconnect?()
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
        Task { @MainActor in
            if let data, let value = try? JSONDecoder().decode(WatchHealthSnapshot.self, from: data) { self.save(value) }
            else {
                self.snapshot = nil
                UserDefaults(suiteName: "group.com.danaakesen.jarvis")?.removeObject(forKey: "watch.health")
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
    }
}
