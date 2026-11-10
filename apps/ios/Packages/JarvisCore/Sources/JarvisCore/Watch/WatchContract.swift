import Foundation

public enum WatchLimits {
    public static let wireBytes = 64_000
    // Data is base64-encoded inside JSON, so leave room for envelope expansion.
    public static let payloadBytes = 40_000
    public static func displayText(_ text: String, maximumBytes: Int = 16_000, notice: String = "… Full reply on iPhone.") -> String {
        guard text.utf8.count > maximumBytes else { return text }
        var bytes = Array(text.utf8.prefix(maximumBytes))
        while !bytes.isEmpty, String(bytes: bytes, encoding: .utf8) == nil { bytes.removeLast() }
        return (String(bytes: bytes, encoding: .utf8) ?? "") + notice
    }
}

public enum WatchCodec {
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes, .sortedKeys]
        let data = try encoder.encode(value)
        guard data.count < WatchLimits.wireBytes else { throw WatchFailure.invalidRequest }
        return data
    }
}

/// Paired-device protocol. No credentials, arbitrary URLs or backend paths cross this boundary.
public enum WatchAction: String, Codable, Sendable {
    case snapshot, history, sendTurn, tasks, workouts, lifts, saveLift, deleteLift, captureLift
    case dashboard, brief, agenda, bodyFat, notes, note, nutrition
    case createWatchTask, updateWatchTask, completeWatchTask
    case projects, factoryTasks, createFactoryTask, startVoice, voiceHeartbeat, audio, muteVoice, playbackCompleted, endVoice
}

public struct WatchRequest: Codable, Equatable, Sendable {
    public var version = 1
    public var id: UUID
    public var action: WatchAction
    public var text: String?
    public var itemID: String?
    public var data: Data?
    public var flag: Bool?
    public init(action: WatchAction, text: String? = nil, itemID: String? = nil, data: Data? = nil, flag: Bool? = nil, id: UUID = UUID()) {
        self.id = id; self.action = action; self.text = text; self.itemID = itemID; self.data = data; self.flag = flag
    }
    public var isValid: Bool {
        version == 1 && (text?.utf8.count ?? 0) <= 8_000 && (itemID?.utf8.count ?? 0) <= 200 &&
        (data?.count ?? 0) <= WatchLimits.payloadBytes && (action != .sendTurn || !(text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) &&
            (action != .createFactoryTask || factorySubmission != nil) &&
            (action != .createWatchTask || createWatchTaskRequest != nil) &&
            (action != .updateWatchTask || updateWatchTaskRequest != nil) &&
            (action != .completeWatchTask || completionWatchTask != nil) &&
            (action != .captureLift || liftCapture != nil)
    }
}

public enum WatchFailure: String, Error, Codable, Sendable {
    case unavailable, healthUnavailable, signInRequired, invalidRequest, failed, busy
    public var message: String {
        switch self {
        case .unavailable: "Connect to your iPhone and open Jarvis."
        case .healthUnavailable: "Health history is unavailable. Try again on your iPhone."
        case .signInRequired: "Sign in to Jarvis on your iPhone."
        case .invalidRequest: "Check the entered values."
        case .failed: "The request failed. Check your iPhone before trying again."
        case .busy: "A request is already running."
        }
    }
}

public struct WatchReply: Codable, Sendable {
    public var version = 1
    public var id: UUID
    public var data: Data?
    public var failure: WatchFailure?
    public var taskError: WatchTaskMutationFailure?
    public init(id: UUID, data: Data? = nil, failure: WatchFailure? = nil, taskError: WatchTaskMutationFailure? = nil) {
        self.id = id; self.data = data; self.failure = failure; self.taskError = taskError
    }
}

public struct WatchEvent: Codable, Sendable {
    public var version = 1
    public enum Kind: String, Codable, Sendable { case chatDelta, chatDone, chatError, voiceState, voiceAudio, voiceTranscript, voiceUserTranscript, interrupt }
    public var kind: Kind
    public var requestID: UUID
    public var text: String?
    public var responseID: String?
    public var muted: Bool?
    public init(_ kind: Kind, requestID: UUID, text: String? = nil, responseID: String? = nil, muted: Bool? = nil) {
        self.kind = kind; self.requestID = requestID; self.text = text; self.responseID = responseID; self.muted = muted
    }
}

/// A wire envelope keeps unsolicited streaming updates separate from request/reply traffic.
public enum WatchWire: Codable, Sendable { case request(WatchRequest), event(WatchEvent) }

public struct WatchHealthSnapshot: Codable, Equatable, Sendable {
    public var version = 1
    public var generatedAt: Date
    public var dayStart: Date
    public var weekStart: Date
    public var steps: Int?
    public var stepGoal: Int?
    public var hourlySteps: [Int]?
    public var gym: Int?
    public var gymGoal: Int?
    public var runs: Int?
    public var runGoal: Int?
    public var dailyKcal: Int?
    public var weeklyKcal: Int?
    public var tasksToday: Int?
    public init(now: Date = Date(), calendar: Calendar = .current) {
        generatedAt = now; dayStart = calendar.startOfDay(for: now)
        weekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? dayStart
    }
    public func expiresAt(calendar: Calendar = .current) -> Date {
        let ageLimit = generatedAt.addingTimeInterval(900)
        let midnight = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? ageLimit
        return min(ageLimit, midnight)
    }
    public func isCurrent(at now: Date, calendar: Calendar = .current) -> Bool {
        version == 1 && now.timeIntervalSince(generatedAt) >= 0 && now.timeIntervalSince(generatedAt) < 900 && calendar.isDate(now, inSameDayAs: dayStart)
    }
    public var cumulativeSteps: [Int] {
        var total = 0
        return (hourlySteps ?? []).map { total += max(0, $0); return total }
    }
}

public struct WatchLiftInput: Codable, Equatable, Sendable {
    public var submissionID: UUID
    public var exercise: String
    public var kilograms: Double
    public var reps: Int
    public var sets: Int
    public init(submissionID: UUID = UUID(), exercise: String, kilograms: Double, reps: Int, sets: Int) {
        self.submissionID = submissionID; self.exercise = exercise; self.kilograms = kilograms; self.reps = reps; self.sets = sets
    }
    /// Reject unsupported/corrupt reads instead of clamping and overwriting saved values.
    public init?(record: [String: JSONValue]) {
        guard case .string(let name)? = record["exerciseName"],
              case .number(let weight)? = record["weightKg"],
              case .number(let repCount)? = record["reps"],
              case .number(let setCount)? = record["sets"],
              repCount.isFinite, setCount.isFinite,
              (1...1000).contains(repCount), (1...100).contains(setCount),
              repCount.rounded() == repCount, setCount.rounded() == setCount else { return nil }
        self.init(exercise: name, kilograms: weight, reps: Int(repCount), sets: Int(setCount))
        guard isValid else { return nil }
    }
    public var isValid: Bool {
        JarvisLiftDraft(idempotencyKey: submissionID, exerciseName: exercise,
                        weightKg: kilograms, reps: reps, sets: sets).isValid
    }
}

/// Dictation never submits a message. Failed sends preserve the draft for manual recovery.
public struct WatchComposer: Equatable, Sendable {
    public var draft = ""
    public private(set) var sending = false
    public init() {}
    public mutating func dictate(_ text: String) { draft = text }
    public mutating func beginSend() -> String? {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sending, !text.isEmpty, text.utf8.count <= 8_000 else { return nil }
        sending = true; return text
    }
    public mutating func finishSend(success: Bool) { sending = false; if success { draft = "" } }

    /// Idle reachability changes are connection status, not interrupted user actions.
    /// An acknowledged send can still have an in-flight response; never recreate its cleared draft.
    public mutating func handleConnectionLoss(hasInFlightTurn: Bool, hasVoiceSession: Bool) -> Bool {
        guard sending || hasInFlightTurn || hasVoiceSession else { return false }
        sending = false
        return true
    }
}

public struct WatchHistoryMessage: Codable, Sendable {
    public var id: String
    public var user: Bool
    public var text: String
    public init(id: String, user: Bool, text: String) {
        self.id = id; self.user = user; self.text = WatchLimits.displayText(text, maximumBytes: 3_000)
    }
}

public struct WatchFactoryTask: Codable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var state: String
    public var request: String
    public var activity: String?
    public init(_ task: FactoryTaskRecord) {
        id = task.id
        title = WatchLimits.displayText(task.title, maximumBytes: 200, notice: "…")
        state = task.state.rawValue
        request = WatchLimits.displayText(task.request, maximumBytes: 1_000, notice: "… Full task on iPhone.")
        activity = task.activity.map { WatchLimits.displayText($0, maximumBytes: 200, notice: "…") }
    }
}
