import WatchConnectivity
import WatchKit
import UserNotifications
import JarvisCore

extension Notification.Name {
    static let jarvisWatchReplyNotificationOpened = Notification.Name("JarvisWatchReplyNotificationOpened")
}

/// Budgeted refresh plus HealthKit background delivery keep installed complications useful without the app onscreen.
final class WatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in
            _ = WatchConnection.shared
            WatchStepsMonitor.shared.start()
            scheduleNextRefresh()
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            defer { completionHandler() }
            guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
                  response.notification.request.content.categoryIdentifier == "jarvis.reply",
                  let target = JarvisReplyNotificationTarget(
                    userInfo: response.notification.request.content.userInfo
                  ) else {
                return
            }
            target.store()
            NotificationCenter.default.post(name: .jarvisWatchReplyNotificationOpened, object: nil)
        }
    }
    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            Task { @MainActor in
                defer { task.setTaskCompletedWithSnapshot(false) }
                switch task {
                case is WKApplicationRefreshBackgroundTask:
                    scheduleNextRefresh()
                    // Steps come from this Watch's HealthKit, so they refresh even when the iPhone is out of reach.
                    await WatchStepsMonitor.shared.refresh()
                    let connection = WatchConnection.shared
                    let activationDeadline = Date().addingTimeInterval(2)
                    while WCSession.default.activationState != .activated, Date() < activationDeadline {
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                    await connection.refresh()
                case is WKWatchConnectivityRefreshBackgroundTask:
                    _ = WatchConnection.shared
                    let deadline = Date().addingTimeInterval(20)
                    while WCSession.default.hasContentPending, Date() < deadline {
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                default: break
                }
            }
        }
    }
    @MainActor
    private func scheduleNextRefresh() {
        WKExtension.shared().scheduleBackgroundRefresh(withPreferredDate: Date().addingTimeInterval(15 * 60), userInfo: nil) { _ in }
    }
}
