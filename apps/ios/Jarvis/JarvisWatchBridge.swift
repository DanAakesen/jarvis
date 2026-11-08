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

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
    func configure(client: JarvisClient) { self.client = client; activate() }
    func disconnect() async {
        generation = UUID(); client = nil; chatSession = nil
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
            let failure: WatchFailure
            if let known = error as? WatchFailure { failure = known }
            else if let known = error as? JarvisClientError, case .signInRequired = known { failure = .signInRequired }
            else { failure = .failed }
            reply = .init(id: request.id, failure: failure)
        }
        // Do not retain audio, health or message bodies unnecessarily. Never auto-replay mutations.
        if reply.failure == nil && ![.audio, .voiceHeartbeat, .snapshot, .history, .tasks, .workouts, .lifts, .projects, .factoryTasks].contains(request.action) {
            if replies.count >= 100 { replies.removeAll() }
            replies[request.id] = (request, reply)
        }
        return reply
    }
    private func perform(_ r: WatchRequest, client: JarvisClient) async throws -> Data? {
        let health = JarvisHealthClient(client: client)
        switch r.action {
        case .snapshot:
            let snapshot = try await snapshot(client: client)
            let data = try encode(snapshot)
            try? WCSession.default.updateApplicationContext(["health": data])
            return data
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
                defer { self.chatTask = nil }
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
            return try encode(try await todayTasks(client: client))
        case .workouts:
            guard try await health.capabilities().availableSources.contains(JarvisHealthSource.workouts.rawValue) else { throw WatchFailure.unavailable }
            let period = JarvisHealthPeriod.make(.sevenDays)
            let result = try await health.query(.init(source: .workouts, period: period, limit: 30))
            guard result.status == "available" else { throw WatchFailure.unavailable }
            return try encode(result.items)
        case .lifts:
            guard try await health.capabilities().availableSources.contains(JarvisHealthSource.lifts.rawValue) else { throw WatchFailure.unavailable }
            let result = try await health.query(.init(source: .lifts, limit: 30))
            guard result.status == "available" else { throw WatchFailure.unavailable }
            return try encode(result.items)
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
            return try encode(try await JarvisFactoryClient(client: client).tasks(projectId: id, limit: 20).tasks)
        case .startVoice:
            guard !startingVoice else { throw WatchFailure.busy }
            startingVoice = true; defer { startingVoice = false }
            let voiceEpoch = generation
            if let voiceID { return try encode(voiceID) }
            guard VoiceLiveActivityActions.session == nil else { throw WatchFailure.busy }
            let voiceLanguage = try await client.voiceDefaultLanguage()
            guard let token = try await KeychainTokenStore().read() else { throw WatchFailure.signInRequired }
            guard voiceEpoch == generation else { throw WatchFailure.signInRequired }
            guard cancelledVoiceStarts.remove(r.id) == nil else { throw WatchFailure.unavailable }
            let id = r.id; voiceID = id; lastVoiceContact = Date()
            voiceWatchdog = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, !Task.isCancelled, self.voiceID == id else { return }
                    if Date().timeIntervalSince(self.lastVoiceContact) > 15 { await self.stopVoice(); return }
                }
            }
            let session = VoiceSessionClient(baseURL: try JarvisComposition.apiBaseURL(), transport: URLSessionWebSocketTransport(), onMessage: { [weak self] message in
                Task { @MainActor in self?.receiveVoice(message, id: id) }
            }, onAction: { [weak self] _ in
                Task { @MainActor in self?.emit(.init(.interrupt, requestID: id)) }
            }, onStateChange: { [weak self] state in
                Task { @MainActor in
                    guard let self, self.voiceID == id else { return }
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
            })
            voice = session; voiceMuted = false
            VoiceLiveActivityActions.session = self
            do { try await session.start(accessToken: token, language: voiceLanguage)
                guard voiceEpoch == generation, voiceID == id else {
                    try? await session.end(); throw WatchFailure.unavailable
                }
                try? liveActivity.start(sessionID: id, language: voiceLanguage == .en ? .en : .da)
            }
            catch { await stopVoice(); throw error }
            return try encode(id)
        case .voiceHeartbeat:
            guard r.itemID == voiceID?.uuidString else { throw WatchFailure.invalidRequest }
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
    private func stopVoice() async {
        let previous = voice; let id = voiceID
        voiceWatchdog?.cancel(); voiceWatchdog = nil
        voice = nil; voiceID = nil; voiceResponseID = nil
        if let id {
            eventQueue.removeAll { $0.requestID == id }
            emit(.init(.voiceState, requestID: id, text: "Ended"))
        }
        try? await previous?.end()
        await liveActivity.end()
        if VoiceLiveActivityActions.session === self { VoiceLiveActivityActions.session = nil }
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
        case .sessionEnded: Task { await stopVoice() }
        default: break
        }
    }
    private func todayTasks(client: JarvisClient) async throws -> [VaultTask] {
        guard case .modified(let list, _) = try await JarvisNotesClient(client: client).fetchOpenTasks(validator: nil), !list.truncated else { throw WatchFailure.failed }
        return list.items.filter { !$0.done && $0.dueDate == list.today }
    }
    private func snapshot(client: JarvisClient) async throws -> WatchHealthSnapshot {
        let now = Date(); let calendar = Calendar.current
        var result = WatchHealthSnapshot(now: now, calendar: calendar)
        if let tasks = try? await todayTasks(client: client) { result.tasksToday = tasks.count }
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
        try? WCSession.default.updateApplicationContext(["health": data])
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
