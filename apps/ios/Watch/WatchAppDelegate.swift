import WatchConnectivity
import WatchKit

/// Budgeted refresh keeps installed complications useful without requiring the app to stay onscreen.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in
            _ = WatchConnection.shared
            scheduleNextRefresh()
        }
    }
    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            Task { @MainActor in
                defer { task.setTaskCompletedWithSnapshot(false) }
                switch task {
                case is WKApplicationRefreshBackgroundTask:
                    scheduleNextRefresh()
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
