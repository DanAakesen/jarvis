import Foundation

/// Paired-device protocol. No credentials, arbitrary URLs or backend paths cross this boundary.
public enum WatchAction: String, Codable, Sendable {
    case snapshot, history, sendTurn, tasks, workouts, lifts, saveLift, deleteLift
    case projects, factoryTasks, startVoice, voiceHeartbeat, audio, muteVoice, playbackCompleted, endVoice
}

public struct WatchRequest: Codable, Sendable {
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
        (text?.utf8.count ?? 0) <= 8_000 && (itemID?.utf8.count ?? 0) <= 200 &&
        (data?.count ?? 0) <= 40_000 && (action != .sendTurn || !(text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
}

public enum WatchFailure: String, Error, Codable, Sendable {
    case unavailable, signInRequired, invalidRequest, failed, busy
    public var message: String {
        switch self {
        case .unavailable: "Connect to your iPhone and open Jarvis."
        case .signInRequired: "Sign in to Jarvis on your iPhone."
        case .invalidRequest: "Check the entered values."
        case .failed: "The request failed. Check your iPhone before trying again."
        case .busy: "A request is already running."
        }
    }
}

public struct WatchReply: Codable, Sendable {
    public var id: UUID
    public var data: Data?
    public var failure: WatchFailure?
    public init(id: UUID, data: Data? = nil, failure: WatchFailure? = nil) {
        self.id = id; self.data = data; self.failure = failure
    }
}

public struct WatchEvent: Codable, Sendable {
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
    public func isCurrent(at now: Date, calendar: Calendar = .current) -> Bool {
        now.timeIntervalSince(generatedAt) >= 0 && now.timeIntervalSince(generatedAt) < 900 && calendar.isDate(now, inSameDayAs: dayStart)
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
    public var isValid: Bool {
        let name = exercise.trimmingCharacters(in: .whitespacesAndNewlines)
        return !name.isEmpty && name.utf16.count <= 80 && !name.unicodeScalars.contains(where: { $0.value < 32 }) &&
            kilograms.isFinite && (0...1000).contains(kilograms) && abs(kilograms * 100 - (kilograms * 100).rounded()) < 1e-7 &&
            (1...100).contains(reps) && (1...100).contains(sets)
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
}
