import ActivityKit
import Foundation
import JarvisCore
import SwiftUI
import UIKit

@MainActor
final class JarvisFactoryLiveActivityController: ObservableObject {
    static let shared = JarvisFactoryLiveActivityController()
    private static let maximumConcurrentActivities = 5
    @Published private(set) var notice: JarvisFactoryLocalizationKey?
    private var tokenObservers: [String: Task<Void, Never>] = [:]
    private var registeredTokens = Set<String>()
    private var client: JarvisNowFeedClient?

    static func configure(client: JarvisClient) {
        shared.client = JarvisNowFeedClient(client: client)
    }

    static func update(
        task: FactoryTaskRecord,
        activityText: String? = nil,
        language: JarvisAppLanguage
    ) async {
        let phase = task.state.activityPhase(latestSessionEndReason: task.latestSessionEndReason)
        await update(
            taskID: task.id,
            title: task.title,
            state: JarvisFactoryLocalization.string(
                phase == "failed" ? .failed : phase == "waiting" ? .waiting : stateKey(for: task.state),
                language: language
            ),
            activityText: activityText ?? task.activity,
            startedAt: task.startedAt.flatMap(Self.date(from:)),
            language: language,
            phase: phase
        )
    }

    static func synchronize(
        _ tasks: [NowFeedRunningTask], backgroundTasks: [BackgroundTaskRecord] = [],
        factoryClient: JarvisFactoryClient? = nil, language: JarvisAppLanguage
    ) async {
        let visibleTasks = tasks.prefix(maximumConcurrentActivities)
        let activeIDs = Set(visibleTasks.map(\.id))
        shared.notice = nil
        for task in visibleTasks {
            await update(
                taskID: task.id,
                title: task.title,
                state: JarvisFactoryLocalization.string(.running, language: language),
                activityText: task.activity,
                startedAt: date(from: task.startedAt),
                language: language,
                phase: "running"
            )
        }
        for task in backgroundTasks.sorted(by: { $0.status == .running && $1.status != .running }) {
            let phase = task.status.rawValue
            await update(
                taskID: task.id, title: task.title,
                state: JarvisFactoryLocalization.string(task.status.localizationKey, language: language),
                activityText: task.detail, startedAt: date(from: task.startedAt),
                language: language, phase: phase,
                factoryTitle: JarvisFactoryLocalization.string(.backgroundTask, language: language)
            )
        }

        for activity in Activity<FactoryTaskActivityAttributes>.activities
            where !activeIDs.contains(activity.attributes.taskID) &&
                UUID(uuidString: activity.attributes.taskID) == nil {
            // Absence from the running-only feed is not a terminal state.
            if let factoryClient,
               let detail = try? await factoryClient.task(id: activity.attributes.taskID) {
                await update(task: detail.task, language: language)
            }
        }
    }

    private static func update(
        taskID: String,
        title: String,
        state: String,
        activityText: String?,
        startedAt: Date?,
        language: JarvisAppLanguage,
        phase: String,
        factoryTitle: String? = nil
    ) async {
        let matching = Activity<FactoryTaskActivityAttributes>.activities.filter {
            $0.attributes.taskID == taskID
        }

        let state = Activity<FactoryTaskActivityAttributes>.ContentState(
            state: state,
            activity: sanitizedActivity(activityText),
            phase: phase
        )
        let content = ActivityContent(
            state: state,
            staleDate: phase == "running" || phase == "waiting" ? Date().addingTimeInterval(60) : nil
        )
        guard phase == "running" || phase == "waiting" else {
            for activity in matching {
                await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(300)))
                shared.tokenObservers.removeValue(forKey: activity.id)?.cancel()
            }
            return
        }

        if let activity = matching.first {
            await activity.update(content)
            observePushToken(activity, language: language)
            for duplicate in matching.dropFirst() {
                await duplicate.end(nil, dismissalPolicy: .immediate)
            }
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            shared.notice = .liveActivitiesDisabled
            return
        }
        guard Activity<FactoryTaskActivityAttributes>.activities.count < maximumConcurrentActivities else {
            shared.notice = .liveActivityUnavailable
            return
        }
        let attributes = FactoryTaskActivityAttributes(
            taskID: taskID,
            title: title,
            startedAt: startedAt,
            language: language.rawValue,
            factoryTitle: factoryTitle ?? JarvisFactoryLocalization.string(.title, language: language)
        )
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: .token
            )
            observePushToken(activity, language: language)
        } catch {
            shared.notice = .liveActivityUnavailable
        }
    }

    private static func observePushToken(
        _ activity: Activity<FactoryTaskActivityAttributes>, language: JarvisAppLanguage
    ) {
        if let token = activity.pushToken {
            Task { await register(token, activity: activity, language: language) }
        }
        guard shared.tokenObservers[activity.id] == nil else { return }
        shared.tokenObservers[activity.id] = Task {
            for await token in activity.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                await register(token, activity: activity, language: language)
            }
            shared.tokenObservers[activity.id] = nil
        }
    }

    private static func register(
        _ token: Data, activity: Activity<FactoryTaskActivityAttributes>, language: JarvisAppLanguage
    ) async {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        let key = "\(activity.id):\(hex):\(language.rawValue)"
        guard !shared.registeredTokens.contains(key), let client = shared.client else { return }
        do {
            try await client.registerTaskActivity(
                taskID: activity.attributes.taskID, activityID: activity.id,
                pushToken: hex, language: language
            )
            shared.registeredTokens.insert(key)
        } catch {
            shared.notice = .liveActivityLocalOnly
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

struct JarvisTaskActivityNotice: View {
    let language: JarvisAppLanguage
    @ObservedObject private var activity = JarvisFactoryLiveActivityController.shared

    var body: some View {
        if let notice = activity.notice {
            VStack(alignment: .leading, spacing: 8) {
                Text(JarvisFactoryLocalization.string(notice, language: language))
                    .font(.callout)
                if notice == .liveActivitiesDisabled,
                   let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                    Link(
                        JarvisFactoryLocalization.string(.openSettings, language: language),
                        destination: settingsURL
                    )
                    .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget, alignment: .leading)
                }
            }
            .padding()
        }
    }
}
