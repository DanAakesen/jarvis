import Foundation

/// Today's steps read from HealthKit on the Watch itself, so the complication needs neither the iPhone nor the backend.
public struct WatchStepsReading: Equatable, Sendable {
    public var measuredAt: Date
    /// Steps per hour of the day, from midnight to the hour of `measuredAt`.
    public var hourly: [Int]
    public init(measuredAt: Date, hourly: [Int]) {
        self.measuredAt = measuredAt
        self.hourly = hourly.map { max(0, $0) }
    }
    public var steps: Int { hourly.reduce(0, +) }
}

extension WatchHealthSnapshot {
    /// Steps stay visible with their own age; the rest of the snapshot keeps the age of the iPhone push.
    public static let stepsFreshness: TimeInterval = 1_200

    public var stepsAsOf: Date { stepsAt ?? generatedAt }

    public func stepsAreCurrent(at now: Date, calendar: Calendar = .current) -> Bool {
        let age = now.timeIntervalSince(stepsAsOf)
        return version == 1 && steps != nil && age >= 0 && age < Self.stepsFreshness
            && calendar.isDate(now, inSameDayAs: dayStart)
    }

    public func stepsExpireAt(calendar: Calendar = .current) -> Date {
        let ageLimit = stepsAsOf.addingTimeInterval(Self.stepsFreshness)
        let midnight = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? ageLimit
        return min(ageLimit, midnight)
    }

    /// Adopts a Watch reading. Steps only grow within a day, so a lower reading never replaces a higher one
    /// (for example when the iPhone already pushed a count the Watch has not yet synced).
    public func applying(_ reading: WatchStepsReading, calendar: Calendar = .current) -> WatchHealthSnapshot {
        var base = self
        if !calendar.isDate(reading.measuredAt, inSameDayAs: dayStart) {
            guard reading.measuredAt > dayStart else { return self }
            base = rolledOver(to: reading.measuredAt, calendar: calendar)
        }
        if let current = base.steps, current > reading.steps { return base }
        base.steps = reading.steps
        base.hourlySteps = reading.hourly
        base.stepsAt = reading.measuredAt
        return base
    }

    /// An iPhone push must not roll the steps back to an older, lower count the Watch already has.
    public func keepingHigherSteps(from old: WatchHealthSnapshot, calendar: Calendar = .current) -> WatchHealthSnapshot {
        guard calendar.isDate(dayStart, inSameDayAs: old.dayStart), let oldSteps = old.steps,
              oldSteps > (steps ?? -1) else { return self }
        var value = self
        value.steps = oldSteps
        value.hourlySteps = old.hourlySteps
        value.stepsAt = old.stepsAsOf
        return value
    }

    /// A new day starts with no steps; goals and this week's workouts carry over, daily values do not.
    private func rolledOver(to now: Date, calendar: Calendar) -> WatchHealthSnapshot {
        var fresh = WatchHealthSnapshot(now: now, calendar: calendar)
        fresh.generatedAt = fresh.dayStart
        fresh.stepGoal = stepGoal
        fresh.gymGoal = gymGoal
        fresh.runGoal = runGoal
        if fresh.weekStart == weekStart {
            fresh.gym = gym
            fresh.runs = runs
            fresh.weeklyKcal = weeklyKcal
        }
        return fresh
    }
}
