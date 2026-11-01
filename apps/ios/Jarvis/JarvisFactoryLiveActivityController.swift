import ActivityKit
import Foundation
import JarvisCore

@MainActor
enum JarvisFactoryLiveActivityController {
    private static let maximumConcurrentActivities = 5

    static func update(
        task: FactoryTaskRecord,
        activityText: String? = nil,
        language: JarvisAppLanguage
    ) async {
        let isActive = task.state == .running
        await update(
            taskID: task.id,
            title: task.title,
            state: JarvisFactoryLocalization.string(stateKey(for: task.state), language: language),
            activityText: activityText ?? task.activity,
            startedAt: task.startedAt.flatMap(Self.date(from:)),
            language: language,
            isActive: isActive
        )
    }

    static func synchronize(_ tasks: [NowFeedRunningTask], language: JarvisAppLanguage) async {
        let visibleTasks = tasks.prefix(maximumConcurrentActivities)
        let activeIDs = Set(visibleTasks.map(\.id))
        for task in visibleTasks {
            await update(
                taskID: task.id,
                title: task.title,
                state: JarvisFactoryLocalization.string(.running, language: language),
                activityText: task.activity,
                startedAt: date(from: task.startedAt),
                language: language,
                isActive: true
            )
        }
        for activity in Activity<FactoryTaskActivityAttributes>.activities
            where !activeIDs.contains(activity.attributes.taskID) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    private static func update(
        taskID: String,
        title: String,
        state: String,
        activityText: String?,
        startedAt: Date?,
        language: JarvisAppLanguage,
        isActive: Bool
    ) async {
        let matching = Activity<FactoryTaskActivityAttributes>.activities.filter {
            $0.attributes.taskID == taskID
        }

        guard isActive else {
            for activity in matching {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            return
        }

        let state = Activity<FactoryTaskActivityAttributes>.ContentState(
            state: state,
            activity: sanitizedActivity(activityText)
        )
        let content = ActivityContent(state: state, staleDate: nil)

        if let activity = matching.first {
            await activity.update(content)
            for duplicate in matching.dropFirst() {
                await duplicate.end(nil, dismissalPolicy: .immediate)
            }
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              Activity<FactoryTaskActivityAttributes>.activities.count < maximumConcurrentActivities else {
            return
        }
        let attributes = FactoryTaskActivityAttributes(
            taskID: taskID,
            title: title,
            startedAt: startedAt,
            language: language.rawValue,
            factoryTitle: JarvisFactoryLocalization.string(.title, language: language)
        )
        do {
            _ = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
        } catch {
            return
        }
    }

    private static func stateKey(for state: FactoryTaskState) -> JarvisFactoryLocalizationKey {
        switch state {
        case .ready: .ready
        case .running: .running
        case .pauseRequested: .pauseRequested
        case .paused: .paused
        case .needsAttention: .needsAttention
        case .done: .done
        case .cancelled: .cancelled
        }
    }

    private static func sanitizedActivity(_ value: String?) -> String? {
        guard let value else { return nil }
        let result = String(value.prefix(180)).trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }

    private static func date(from value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }
}
