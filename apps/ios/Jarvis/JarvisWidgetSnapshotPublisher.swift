import Foundation
import HealthKit
import JarvisCore
import WidgetKit

/// Writes the small versioned snapshot the Gym and Factory home screen widgets read, and runs the widgets' immediate
/// Factory actions. HealthKit data stays on the device; the snapshot holds display numbers only, never a token.
@MainActor
final class JarvisWidgetSnapshotPublisher {
    static let shared = JarvisWidgetSnapshotPublisher()

    private let store = JarvisWidgetSnapshotStore.appGroup()
    private var factoryClient: JarvisFactoryClient?
    private var approvalsClient: JarvisApprovalsClient?
    private var healthClient: JarvisHealthClient?
    private var isRefreshing = false

    private init() {}

    func configure(client: JarvisClient) {
        factoryClient = JarvisFactoryClient(client: client)
        approvalsClient = JarvisApprovalsClient(client: client)
        healthClient = JarvisHealthClient(client: client)
        JarvisFactoryWidgetActions.queue = store.map { JarvisFactoryWidgetActionQueue(directory: $0.directory) }
        JarvisFactoryWidgetActions.handler = { [weak self] action, id in
            guard let self else { throw JarvisFactoryWidgetActions.Failure.unavailable }
            try await self.run(action, id: id)
            await self.refresh()
        }
        Task { await refresh() }
    }

    /// Runs taps the widget could not run itself, then rewrites both sections and reloads the timelines.
    func refresh() async {
        guard let store, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        if let queue = JarvisFactoryWidgetActions.queue {
            for pending in queue.drain() { try? await run(pending.action, id: pending.id) }
        }
        var snapshot: JarvisWidgetSnapshot
        if case .snapshot(let previous) = store.load() { snapshot = previous } else { snapshot = JarvisWidgetSnapshot() }
        let language = JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
        snapshot.version = JarvisWidgetSnapshot.currentVersion
        snapshot.language = language.rawValue
        let now = Date()
        async let gym = loadGym(now: now)
        async let factory = loadFactory(now: now, language: language)
        let (gymResult, factoryResult) = await (gym, factory)
        apply(gymResult, to: &snapshot.gym)
        apply(factoryResult, to: &snapshot.factory)
        try? store.save(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func run(_ action: JarvisFactoryWidgetData.Action, id: String) async throws {
        guard let factoryClient, let approvalsClient else { throw JarvisFactoryWidgetActions.Failure.unavailable }
        switch action {
        case .approve: try await approvalsClient.resolveConfirmation(id: id, decision: .approve)
        case .pause: _ = try await factoryClient.controlTask(.init(taskId: id, action: .pause))
        case .resume: _ = try await factoryClient.controlTask(.init(taskId: id, action: .resume))
        case .retry: _ = try await factoryClient.retryTask(id: id)
        }
    }

    /// A failed load keeps the last good value and records why, so the widget shows it stale.
    private func apply<Value>(
        _ result: Result<Value, Error>,
        to section: inout JarvisWidgetSnapshot.Section<Value>
    ) {
        switch result {
        case .success(let value):
            section = .init(status: .ok, value: value)
        case .failure(let error):
            section.status = Self.isOffline(error) ? .offline : .error
        }
    }

    private static func isOffline(_ error: Error) -> Bool {
        if let error = error as? JarvisTodayDataError, error == .offline { return true }
        if let error = error as? JarvisClientError, error == .networkFailure || error == .timedOut { return true }
        if let error = error as? URLError {
            return [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed].contains(error.code)
        }
        return false
    }

    private func loadGym(now: Date) async -> Result<JarvisGymWidgetData, Error> {
        do {
            let calendar = Calendar.current
            let weekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? calendar.startOfDay(for: now)
            let since = calendar.date(byAdding: .weekOfYear, value: -(JarvisWidgetSnapshot.days - 1), to: weekStart) ?? weekStart
            let steps = try await JarvisHealthKitStepsSource().steps(now: now, days: JarvisWidgetSnapshot.days)
            let workouts = try await Self.workouts(since: since)
            let targets = try? await healthClient?.trainingTargets().targets
            return .success(JarvisWidgetBuilder.gym(
                now: now, calendar: calendar,
                dailySteps: steps.daily, workouts: workouts,
                stepGoal: Int(targets?.dailySteps ?? 8_000),
                liftTarget: Int(targets?.gymSessionsPerWeek ?? 0),
                runTarget: Int(targets?.runSessionsPerWeek ?? 0)
            ))
        } catch {
            return .failure(error)
        }
    }

    private func loadFactory(now: Date, language: JarvisAppLanguage) async -> Result<JarvisFactoryWidgetData, Error> {
        guard let factoryClient, let approvalsClient else { return .failure(JarvisTodayDataError.unavailable) }
        do {
            var tasks: [FactoryTaskRecord] = []
            for project in try await factoryClient.projects().prefix(3) {
                tasks += try await factoryClient.tasks(projectId: project.id, limit: 100).tasks
            }
            let confirmations = try await approvalsClient.pendingConfirmations().confirmations
            return .success(JarvisWidgetBuilder.factory(
                now: now, calendar: .current, language: language, tasks: tasks, confirmations: confirmations
            ))
        } catch {
            return .failure(error)
        }
    }

    /// Lifts (strength training) and runs from Apple Health, with distance and active energy.
    private static func workouts(since: Date) async throws -> [JarvisWidgetWorkout] {
        let store = HKHealthStore()
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKObjectType.workoutType(),
                predicate: HKQuery.predicateForSamples(withStart: since, end: nil),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if error != nil {
                    continuation.resume(throwing: JarvisTodayDataError.failed)
                    return
                }
                let workouts = (samples as? [HKWorkout] ?? []).compactMap { workout -> JarvisWidgetWorkout? in
                    let kind: JarvisWidgetWorkout.Kind
                    switch workout.workoutActivityType {
                    case .running: kind = .run
                    case .traditionalStrengthTraining, .functionalStrengthTraining: kind = .lift
                    default: return nil
                    }
                    let kilometers = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
                        .flatMap { workout.statistics(for: $0)?.sumQuantity() }
                        .map { $0.doubleValue(for: .meterUnit(with: .kilo)) } ?? 0
                    let calories = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
                        .flatMap { workout.statistics(for: $0)?.sumQuantity() }
                        .map { $0.doubleValue(for: .kilocalorie()) } ?? 0
                    return JarvisWidgetWorkout(date: workout.startDate, kind: kind, kilometers: kilometers, calories: calories)
                }
                continuation.resume(returning: workouts)
            }
            store.execute(query)
        }
    }
}
