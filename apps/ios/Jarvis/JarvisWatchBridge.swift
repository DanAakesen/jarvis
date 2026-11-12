import Foundation
import HealthKit
import JarvisCore
import WatchConnectivity

/// Only the paired Watch can call this allow-listed companion API. Authentication stays on iPhone.
@MainActor
final class JarvisWatchBridge: NSObject, WCSessionDelegate, VoiceLiveActivityControlling {
    static let shared = JarvisWatchBridge()
    private var client: JarvisClient?
    private var chatSession: String?
    private var chatTask: Task<Void, Never>?
    private var startingChat = false
    private var startingVoice = false
    private var stoppingVoice = false
    private var cancelledVoiceStarts = Set<UUID>()
    private var voice: VoiceSessionClient?
    private var voiceID: UUID?
    private var lastVoiceContact = Date.distantPast
    private var voiceWatchdog: Task<Void, Never>?
    private var voiceResponseID: String?
    private lazy var liveActivity = VoiceLiveActivityController()
    private var voiceMuted = false
    var liveActivitySessionID: UUID? { voiceID }
    func performLiveActivityCommand(_ command: VoiceLiveActivityCommand) async throws {
        guard let voice, let id = voiceID else { throw VoiceLiveActivityError.unavailable }
        switch command {
        case .end: await stopVoice()
        case .setMuted(let muted):
            try await voice.setMuted(muted); voiceMuted = muted
            emit(.init(.voiceState, requestID: id, text: muted ? "Muted" : "Listening", muted: muted))
            liveActivity.update(state: .listening, isMuted: muted)
        }
    }
    private var replies: [UUID: (request: WatchRequest, reply: WatchReply)] = [:]
    private var running = Set<UUID>()
    private var generation = UUID()
    private var eventQueue: [WatchEvent] = []
    private var delivery: Task<Void, Never>?
    private var dashboardSnapshot: WatchDashboardSnapshot?
    private var dashboardBrief: WatchBriefSummary?
    private var publishingDashboard = false

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
    func configure(client: JarvisClient) { self.client = client; activate() }
    func disconnect() async {
        generation = UUID(); client = nil; chatSession = nil
        dashboardSnapshot = nil; dashboardBrief = nil
        chatTask?.cancel(); chatTask = nil
        delivery?.cancel(); delivery = nil; eventQueue.removeAll()
        await stopVoice(); replies.removeAll(); running.removeAll()
        try? WCSession.default.updateApplicationContext([:])
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        if !session.isReachable { Task { @MainActor in await self.stopVoice() } }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data, replyHandler: @escaping (Data) -> Void) {
        Task { @MainActor in
            guard messageData.count < WatchLimits.wireBytes, case .request(let request) = try? JSONDecoder().decode(WatchWire.self, from: messageData) else {
                replyHandler(Data()); return
            }
            let reply = await self.handle(request)
            replyHandler((try? WatchCodec.encode(reply)) ?? Data())
        }
    }
    private func encode<T: Encodable>(_ value: T) throws -> Data { try WatchCodec.encode(value) }
    private func emit(_ original: WatchEvent) {
        var event = original
        if event.kind != .voiceAudio, let text = event.text { event.text = WatchLimits.displayText(text) }
        guard WCSession.default.isReachable else { return }
        guard eventQueue.count < 128 else {
            eventQueue.removeAll()
            eventQueue.append(.init(.chatError, requestID: event.requestID, text: "Connection too slow. Reopen history on iPhone."))
            Task { await self.stopVoice() }
            return
        }
        eventQueue.append(event)
        guard delivery == nil else { return }
        let epoch = generation
        delivery = Task {
            defer { if self.generation == epoch { self.delivery = nil } }
            while !self.eventQueue.isEmpty, !Task.isCancelled, self.generation == epoch {
                var next = self.eventQueue.removeFirst()
                if next.kind == .voiceAudio, var pcm = Data(base64Encoded: next.text ?? "") {
                    while let following = self.eventQueue.first, following.kind == .voiceAudio,
                          following.requestID == next.requestID, following.responseID == next.responseID,
                          let more = Data(base64Encoded: following.text ?? ""), pcm.count + more.count <= 24_000 {
                        pcm.append(more); self.eventQueue.removeFirst()
                    }
                    next.text = pcm.base64EncodedString()
                }
                do {
                    let data = try self.encode(WatchWire.event(next))
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                        WCSession.default.sendMessageData(data, replyHandler: { _ in continuation.resume() }, errorHandler: { continuation.resume(throwing: $0) })
                    }
                } catch {
                    guard self.generation == epoch else { return }
                    self.eventQueue.removeAll()
                    await self.stopVoice()
                    return
                }
            }
        }
    }
    private func handle(_ request: WatchRequest) async -> WatchReply {
        guard request.isValid else { return .init(id: request.id, failure: .invalidRequest) }
        guard let client else { return .init(id: request.id, failure: .signInRequired) }
        if let previous = replies[request.id] { return previous.request == request ? previous.reply : .init(id: request.id, failure: .invalidRequest) }
        guard running.insert(request.id).inserted else { return .init(id: request.id, failure: .busy) }
        defer { running.remove(request.id) }
        let epoch = generation
        let reply: WatchReply
        do {
            let data = try await perform(request, client: client)
            guard (data?.count ?? 0) <= WatchLimits.payloadBytes else { throw WatchFailure.failed }
            guard epoch == generation else { return .init(id: request.id, failure: .signInRequired) }
            reply = .init(id: request.id, data: data)
        } catch {
            if let known = error as? JarvisWatchTasksClientError, case .failure(let detail) = known {
                reply = .init(id: request.id, taskError: detail)
            } else if let detail = error as? WatchTaskMutationFailure {
                reply = .init(id: request.id, taskError: detail)
            } else {
                let failure: WatchFailure
                if let known = error as? WatchFailure { failure = known }
                else if let known = error as? JarvisClientError, case .signInRequired = known { failure = .signInRequired }
                else if let known = error as? JarvisWatchTasksClientError, case .invalidRequest = known { failure = .invalidRequest }
                else { failure = .failed }
                reply = .init(id: request.id, failure: failure)
            }
        }
        // Do not retain audio, health or message bodies unnecessarily. Never auto-replay mutations.
        if reply.failure == nil && reply.taskError == nil && ![.audio, .voiceHeartbeat, .snapshot, .dashboard, .brief, .agenda, .bodyFat, .notes, .note, .nutrition,
                                    .history, .tasks, .workouts, .lifts, .projects, .factoryTasks].contains(request.action) {
            if replies.count >= 100 { replies.removeAll() }
            replies[request.id] = (request, reply)
        }
        return reply
    }
    private func perform(_ r: WatchRequest, client: JarvisClient) async throws -> Data? {
        let health = JarvisHealthClient(client: client)
        switch r.action {
        case .snapshot:
            let epoch = generation
            let snapshot = try await snapshot(client: client)
            guard epoch == generation else { throw WatchFailure.signInRequired }
            let data = try encode(snapshot)
            publishContext(health: data)
            return data
        case .dashboard:
            let epoch = generation
            var value = try await dashboard(client: client)
            guard epoch == generation else { throw WatchFailure.signInRequired }
            if let dashboardBrief, dashboardBrief.isCurrent(at: Date()) { value.brief = dashboardBrief }
            value = try value.bounded()
            dashboardSnapshot = value
            let data = try encode(value)
            publishContext(dashboard: data)
            return data
        case .brief:
            let epoch = generation
            let appLanguage: JarvisAppLanguage = language == .en ? .en : .da
            let reader = WatchDashboardReader(client: client)
            let value = try await WatchDashboardReader.boundedRead(timeout: .seconds(20)) {
                try await reader.brief(language: appLanguage)
            }
            guard epoch == generation else { throw WatchFailure.signInRequired }
            dashboardBrief = value
            if var snapshot = dashboardSnapshot, snapshot.isCurrent(at: Date()) {
                snapshot.brief = value
                snapshot = try snapshot.bounded()
                dashboardSnapshot = snapshot
                publishContext(dashboard: try encode(snapshot))
            }
            return try encode(value)
        case .agenda:
            let page = try dashboardPage(r)
            let reader = WatchDashboardReader(client: client)
            return try encode(try await WatchDashboardReader.boundedRead {
                try await reader.agenda(offset: page.offset)
            })
        case .bodyFat:
            let reader = WatchDashboardReader(client: client)
            return try encode(try await WatchDashboardReader.boundedRead { try await reader.bodyFat() })
        case .notes:
            let page = try dashboardPage(r)
            let reader = WatchDashboardReader(client: client)
            return try encode(try await WatchDashboardReader.boundedRead { try await reader.notes(offset: page.offset) })
        case .note:
            let page = try dashboardPage(r)
            guard let path = r.text ?? r.itemID, JarvisNotesLogic.validNotePath(path) else { throw WatchFailure.invalidRequest }
            let reader = WatchDashboardReader(client: client)
            return try encode(try await WatchDashboardReader.boundedRead { try await reader.note(path: path, page: page) })
        case .nutrition:
            let reader = WatchDashboardReader(client: client)
            let goals = explicitNutritionGoals()
            return try encode(try await WatchDashboardReader.boundedRead {
                try await reader.nutrition(carbsGoalGrams: goals.carbs, fatGoalGrams: goals.fat, proteinGoalGrams: goals.protein)
            })
        case .history:
            let history = try await JarvisChatClient(client: client).history(limit: 20).messages
            var compact = history.sorted { $0.at < $1.at }.suffix(6).map {
                WatchHistoryMessage(id: $0.id, user: $0.role == .dan, text: $0.text)
            }
            while !compact.isEmpty {
                let data = try encode(compact)
                if data.count <= WatchLimits.payloadBytes { return data }
                compact.removeFirst()
            }
            return try encode([WatchHistoryMessage]())
        case .sendTurn:
            guard chatTask == nil, !startingChat else { throw WatchFailure.busy }
            startingChat = true; defer { startingChat = false }
            let epoch = generation
            let chat = JarvisChatClient(client: client)
            if chatSession == nil { chatSession = try await chat.createSession(language: language).id }
            guard let sessionID = chatSession else { throw WatchFailure.failed }
            let stream = try await chat.sendTurn(sessionId: sessionID, text: r.text ?? "")
            guard epoch == generation else { throw WatchFailure.signInRequired }
            chatTask = Task {
                defer { if self.generation == epoch { self.chatTask = nil } }
                do {
                    for try await event in stream {
                        guard !Task.isCancelled, self.generation == epoch else { return }
                        switch event {
                        case .delta(let text): self.emit(.init(.chatDelta, requestID: r.id, text: text))
                        case .done(let message), .interrupted(let message): self.emit(.init(.chatDone, requestID: r.id, text: message.text))
                        case .error: self.emit(.init(.chatError, requestID: r.id, text: WatchFailure.failed.message))
                        default: break
                        }
                    }
                } catch { self.emit(.init(.chatError, requestID: r.id, text: WatchFailure.failed.message)) }
            }
            return nil
        case .tasks:
            if let id = r.itemID {
                let reader = WatchDashboardReader(client: client)
                return try encode(try await WatchDashboardReader.boundedRead { try await reader.task(id: id) })
            }
            if r.data == nil { return try encode(try await todayTasks(client: client)) }
            let page = try dashboardPage(r)
            let reader = WatchDashboardReader(client: client)
            return try encode(try await WatchDashboardReader.boundedRead { try await reader.taskPage(offset: page.offset) })
        case .createWatchTask:
            guard let value = r.createWatchTaskRequest else { throw WatchFailure.invalidRequest }
            return try encode(try await JarvisWatchTasksClient(client: client).create(value))
        case .updateWatchTask:
            guard let value = r.updateWatchTaskRequest else { throw WatchFailure.invalidRequest }
            return try encode(try await JarvisWatchTasksClient(client: client).update(value))
        case .completeWatchTask:
            guard let task = r.completionWatchTask, let done = r.flag else { throw WatchFailure.invalidRequest }
            let notes = JarvisNotesClient(client: client)
            do {
                return try encode(try await WatchDashboardReader.boundedRead {
                    try await notes.setTaskDone(task, done: done)
                })
            } catch JarvisNotesClientError.taskConflict {
                throw WatchTaskMutationFailure(code: "task_conflict",
                                               message: "This task changed. Refresh it before trying again.",
                                               retryable: false, outcomeUnknown: false)
            } catch JarvisClientError.signInRequired { throw WatchFailure.signInRequired }
            catch { throw WatchTaskMutationFailure.unknown }
        case .workouts:
            guard try await health.capabilities().availableSources.contains(JarvisHealthSource.workouts.rawValue) else { throw WatchFailure.healthUnavailable }
            let period = JarvisHealthPeriod.make(.sevenDays)
            let result = try await health.query(.init(source: .workouts, period: period, limit: 30))
            return try encode(WatchHealthHistory.items(from: result))
        case .lifts:
            guard try await health.capabilities().availableSources.contains(JarvisHealthSource.lifts.rawValue) else { throw WatchFailure.healthUnavailable }
            let result = try await health.query(.init(source: .lifts, limit: 30))
            return try encode(WatchHealthHistory.items(from: result))
        case .captureLift:
            guard let capture = r.liftCapture else { throw WatchFailure.invalidRequest }
            return try encode(try await health.captureLift(capture))
        case .saveLift:
            guard let data = r.data, let value = try? JSONDecoder().decode(WatchLiftInput.self, from: data), value.isValid else { throw WatchFailure.invalidRequest }
            if let id = r.itemID {
                try await health.updateLift(id: id, edit: .init(exerciseName: value.exercise, weightKg: value.kilograms, reps: value.reps, sets: value.sets))
            } else {
                _ = try await health.createLift(.init(idempotencyKey: value.submissionID, exerciseName: value.exercise, weightKg: value.kilograms, reps: value.reps, sets: value.sets))
            }
            return nil
        case .deleteLift:
            guard let id = r.itemID, !id.isEmpty else { throw WatchFailure.invalidRequest }
            try await health.deleteLift(id: id); return nil
        case .projects: return try encode(try await JarvisFactoryClient(client: client).projects())
        case .factoryTasks:
            guard let id = r.itemID else { throw WatchFailure.invalidRequest }
            return try encode(try await JarvisFactoryClient(client: client).tasks(projectId: id, limit: 10).tasks.map(WatchFactoryTask.init))
        case .createFactoryTask:
            guard let submission = r.factorySubmission else { throw WatchFailure.invalidRequest }
            let factory = JarvisFactoryClient(client: client)
            guard try await factory.projects().contains(where: { $0.id == submission.projectId }) else {
                throw WatchFailure.invalidRequest
            }
            let task = try await factory.createTask(submission)
            return try encode(WatchFactoryTask(task))
        case .startVoice:
            guard !startingVoice, !stoppingVoice else { throw WatchFailure.busy }
            startingVoice = true; defer { startingVoice = false }
            let voiceEpoch = generation
            if let id = voiceID, await hasActiveVoice(id: id) { return try encode(id) }
            guard voiceEpoch == generation else { throw WatchFailure.signInRequired }
            guard let token = try await KeychainTokenStore().read() else { throw WatchFailure.signInRequired }
            guard voiceEpoch == generation else { throw WatchFailure.signInRequired }
            guard !stoppingVoice,
                  VoiceLiveActivityActions.session?.liveActivitySessionID == nil else { throw WatchFailure.busy }
            guard cancelledVoiceStarts.remove(r.id) == nil else { throw WatchFailure.unavailable }
            let id = r.id; voiceID = id; lastVoiceContact = Date()
            voiceWatchdog = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, !Task.isCancelled, self.voiceID == id else { return }
                    if Date().timeIntervalSince(self.lastVoiceContact) > 15 { await self.stopVoice(); return }
                }
            }
            let session = VoiceSessionClient(
                baseURL: try JarvisComposition.apiBaseURL(),
                transport: URLSessionWebSocketTransport(),
                appLanguage: JarvisAppLanguage(rawValue: language.rawValue) ?? .default,
                onMessage: { [weak self] message in
                    Task { @MainActor in self?.receiveVoice(message, id: id) }
                },
                onAction: { [weak self] _ in
                    Task { @MainActor in self?.emit(.init(.interrupt, requestID: id)) }
                },
                onStateChange: { [weak self] state in
                    Task { @MainActor in
                        guard let self, self.voiceID == id else { return }
                        if state == .ended || state == .failed {
                            await self.stopVoice()
                            return
                        }
                        let label: String
                        switch state {
                        case .listening: label = "Listening"
                        case .speaking: label = "Speaking"
                        case .ready: label = "Thinking"
                        case .ended: label = "Ended"
                        case .failed: label = "Disconnected"
                        default: label = "Connecting"
                        }
                        self.emit(.init(.voiceState, requestID: id, text: label, muted: self.voiceMuted))
                        self.liveActivity.update(state: state, isMuted: self.voiceMuted)
                    }
                }
            )
            voice = session; voiceMuted = false
            VoiceLiveActivityActions.session = self
            do { try await session.start(accessToken: token)
                guard voiceEpoch == generation, voiceID == id else {
                    try? await session.end(); throw WatchFailure.unavailable
                }
                try? liveActivity.start(
                    sessionID: id,
                    language: language == .en ? .en : .da
                )
            }
            catch { await stopVoice(); throw error }
            return try encode(id)
        case .voiceHeartbeat:
            guard let id = r.itemID.flatMap(UUID.init(uuidString:)),
                  await hasActiveVoice(id: id) else { throw WatchFailure.invalidRequest }
            lastVoiceContact = Date(); return nil
        case .audio:
            guard r.itemID == voiceID?.uuidString, let voice, let bytes = r.data, !bytes.isEmpty, bytes.count.isMultiple(of: 2) else { throw WatchFailure.invalidRequest }
            lastVoiceContact = Date(); try await voice.sendAudio(bytes); return nil
        case .muteVoice:
            guard r.itemID == voiceID?.uuidString, let voice else { throw WatchFailure.invalidRequest }
            try await performLiveActivityCommand(.setMuted(r.flag ?? true)); return nil
        case .playbackCompleted:
            guard let voice, r.text == voiceID?.uuidString, let id = r.itemID else { throw WatchFailure.invalidRequest }
            try await voice.playbackCompleted(responseID: id, audible: r.flag ?? false); return nil
        case .endVoice:
            if startingVoice, voiceID == nil, let value = r.itemID.flatMap(UUID.init(uuidString:)) {
                if cancelledVoiceStarts.count >= 100 { cancelledVoiceStarts.removeAll() }
                cancelledVoiceStarts.insert(value)
                return nil
            }
            guard r.itemID == voiceID?.uuidString else { throw WatchFailure.invalidRequest }
            await stopVoice(); return nil
        }
    }
    private var language: ChatLanguage {
        UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) == "en" ? .en : .da
    }
    private func hasActiveVoice(id: UUID) async -> Bool {
        guard voiceID == id else { return false }
        if let voice {
            let state = await voice.state()
            guard voiceID == id else { return false }
            if !state.canStartSession { return true }
        }
        await stopVoice()
        return false
    }

    private func stopVoice() async {
        guard !stoppingVoice else { return }
        stoppingVoice = true
        defer { stoppingVoice = false }
        let previous = voice; let id = voiceID
        voiceWatchdog?.cancel(); voiceWatchdog = nil
        voice = nil; voiceID = nil; voiceResponseID = nil
        if VoiceLiveActivityActions.session === self { VoiceLiveActivityActions.session = nil }
        if let id {
            eventQueue.removeAll { $0.requestID == id }
            let ended = WatchEvent(.voiceState, requestID: id, text: "Ended")
            var context = WCSession.default.applicationContext
            context["voice"] = try? encode(ended)
            try? WCSession.default.updateApplicationContext(context)
            emit(ended)
        }
        try? await previous?.end()
        await liveActivity.end()
    }
    private func receiveVoice(_ message: VoiceServerMessage, id: UUID) {
        guard voiceID == id else { return }
        switch message {
        case .sessionReady: emit(.init(.voiceState, requestID: id, text: "Listening"))
        case .responseCreated(let response): voiceResponseID = response
        case .audioDelta(_, let base64):
            // WCSession caps messages at 64 KB; retain PCM16 alignment across fragments.
            guard let data = Data(base64Encoded: base64) else { return }
            for start in stride(from: 0, to: data.count, by: 24_000) {
                let part = data.subdata(in: start..<min(start + 24_000, data.count))
                emit(.init(.voiceAudio, requestID: id, text: part.base64EncodedString(), responseID: voiceResponseID))
            }
        case .assistantTranscriptDelta(let text): emit(.init(.voiceTranscript, requestID: id, text: text, responseID: voiceResponseID))
        case .transcriptionCompleted(let text, let itemID): emit(.init(.voiceUserTranscript, requestID: id, text: text, responseID: itemID))
        case .responseDone: emit(.init(.voiceState, requestID: id, text: "Playback finished", responseID: voiceResponseID))
        case .sessionEnded:
            Task {
                guard voiceID == id else { return }
                await stopVoice()
            }
        default: break
        }
    }
    private func todayTasks(client: JarvisClient, now: Date = Date(), calendar: Calendar = .current) async throws -> [VaultTask] {
        try await WatchDashboardReader(client: client).taskLists(now: now, calendar: calendar).today
    }
    private func dashboard(client: JarvisClient) async throws -> WatchDashboardSnapshot {
        let reader = WatchDashboardReader(client: client)
        let goals = explicitNutritionGoals()
        return try await reader.dashboard(carbsGoalGrams: goals.carbs, fatGoalGrams: goals.fat, proteinGoalGrams: goals.protein)
    }
    private func dashboardPage(_ request: WatchRequest) throws -> WatchPageRequest {
        guard let data = request.data else { return .init() }
        guard let page = try? JSONDecoder().decode(WatchPageRequest.self, from: data), page.isValid else { throw WatchFailure.invalidRequest }
        return page
    }
    private func explicitNutritionGoals() -> (carbs: Double?, fat: Double?, protein: Double?) {
        func read(_ key: JarvisHealthGoals.Key) -> Double? {
            guard let value = UserDefaults.standard.object(forKey: key.rawValue) as? NSNumber else { return nil }
            let number = value.doubleValue
            return number.isFinite && number > 0 ? number : nil
        }
        return (read(.carbsGrams), read(.fatGrams), read(.proteinGrams))
    }
    private func publishContext(health: Data? = nil, dashboard: Data? = nil) {
        var context = WCSession.default.applicationContext
        if let health { context["health"] = health }
        if let dashboard { context["dashboard"] = dashboard }
        try? WCSession.default.updateApplicationContext(context)
    }
    private func snapshot(client: JarvisClient) async throws -> WatchHealthSnapshot {
        let now = Date(); let calendar = Calendar.current
        var result = WatchHealthSnapshot(now: now, calendar: calendar)
        if let tasks = try? await todayTasks(client: client, now: now, calendar: calendar) { result.tasksToday = tasks.count }
        if let targets = try? await JarvisHealthClient(client: client).trainingTargets().targets {
            result.stepGoal = positiveTarget(targets.dailySteps)
            result.gymGoal = positiveTarget(targets.gymSessionsPerWeek)
            result.runGoal = positiveTarget(targets.runSessionsPerWeek)
        }
        // No permission prompts in a background companion request. Missing Health data stays nil.
        let store = HKHealthStore()
        if let steps = try? await healthSum(store, type: .stepCount, start: result.dayStart, end: now, interval: .init(hour: 1)) {
            result.hourlySteps = steps; result.steps = steps.reduce(0, +)
        }
        result.dailyKcal = try? await healthSum(store, type: .activeEnergyBurned, start: result.dayStart, end: now).reduce(0, +)
        result.weeklyKcal = try? await healthSum(store, type: .activeEnergyBurned, start: result.weekStart, end: now).reduce(0, +)
        let workouts: [HKWorkout]? = try? await withCheckedThrowingContinuation { continuation in
            store.execute(HKSampleQuery(sampleType: .workoutType(), predicate: HKQuery.predicateForSamples(withStart: result.weekStart, end: now), limit: 500, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: samples as? [HKWorkout] ?? []) }
            })
        }
        // Empty HealthKit reads cannot distinguish permission denial from no samples.
        if let workouts, !workouts.isEmpty {
            result.gym = workouts.filter { [.traditionalStrengthTraining, .functionalStrengthTraining].contains($0.workoutActivityType) }.count
            result.runs = workouts.filter { $0.workoutActivityType == .running }.count
        }
        return result
    }
    func publishSnapshotIfReachable() async {
        let epoch = generation
        guard let client, WCSession.default.activationState == .activated, WCSession.default.isPaired, WCSession.default.isWatchAppInstalled,
              let snapshot = try? await snapshot(client: client), let data = try? encode(snapshot), epoch == generation else { return }
        publishContext(health: data)
        guard !publishingDashboard else { return }
        publishingDashboard = true
        defer { publishingDashboard = false }
        guard var dashboard = try? await dashboard(client: client), epoch == generation else { return }
        if let dashboardBrief, dashboardBrief.isCurrent(at: Date()) { dashboard.brief = dashboardBrief }
        guard let bounded = try? dashboard.bounded(), let dashboardData = try? encode(bounded) else { return }
        dashboardSnapshot = bounded
        publishContext(dashboard: dashboardData)
    }
    private func positiveTarget(_ value: Double?) -> Int? {
        guard let value, value.isFinite, value > 0, value < 1_000_000 else { return nil }
        return Int(value)
    }
    private func healthSum(_ store: HKHealthStore, type identifier: HKQuantityTypeIdentifier, start: Date, end: Date, interval: DateComponents = .init(day: 1)) async throws -> [Int] {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { throw WatchFailure.failed }
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end), options: .cumulativeSum, anchorDate: start, intervalComponents: interval)
            query.initialResultsHandler = { _, collection, error in
                if let error { continuation.resume(throwing: error); return }
                var values: [Int] = []; var found = false
                collection?.enumerateStatistics(from: start, to: end) { statistic, _ in
                    let quantity = statistic.sumQuantity(); found = found || quantity != nil
                    let value = Int(quantity?.doubleValue(for: identifier == .stepCount ? .count() : .kilocalorie()).rounded() ?? 0)
                    if interval.hour == 1 {
                        let hour = Calendar.current.component(.hour, from: statistic.startDate)
                        while values.count <= hour { values.append(0) }
                        values[hour] += value // Merge the repeated clock hour on a daylight-saving transition.
                    } else { values.append(value) }
                }
                if found { continuation.resume(returning: values) } else { continuation.resume(throwing: WatchFailure.unavailable) }
            }
            store.execute(query)
        }
    }
}
