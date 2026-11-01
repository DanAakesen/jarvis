import BackgroundTasks
import JarvisCore
import OSLog
import UIKit

@MainActor
final class JarvisAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        JarvisTaskActivityBackgroundRefresh.shared.register()
        return true
    }
}

private struct JarvisBackgroundAccessTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        throw JarvisClientError.signInRequired
    }

    func requestSignIn() async {}
}

@MainActor
final class JarvisTaskActivityBackgroundRefresh {
    static let shared = JarvisTaskActivityBackgroundRefresh()
    static let identifier = "com.danaakesen.jarvis.task-activity-refresh"
    private let logger = Logger(subsystem: "com.danaakesen.jarvis", category: "TaskActivityRefresh")
    private var registered = false

    func register() {
        guard !registered else { return }
        registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.identifier, using: .main
        ) { task in
            MainActor.assumeIsolated {
                self.handle(task)
            }
        }
        if !registered {
            logger.error("Task activity background refresh registration failed")
        }
    }

    func schedule() {
        guard registered else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.identifier)
        // This is only an earliest eligible time; iOS may delay or omit the refresh.
        request.earliestBeginDate = Date().addingTimeInterval(15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            logger.error("Task activity background refresh scheduling unavailable")
        }
    }

    private func handle(_ task: BGTask) {
        schedule()
        let refresh = JarvisBackgroundRefresh { success in
            task.expirationHandler = nil
            task.setTaskCompleted(success: success)
        }
        task.expirationHandler = {
            Task { @MainActor in refresh.cancel() }
        }
        refresh.start(timeout: .seconds(20)) {
            guard task is BGAppRefreshTask else {
                throw JarvisClientError.invalidRequest
            }
            let client = try JarvisComposition.makeClient(
                accessTokenProvider: JarvisBackgroundAccessTokenProvider(),
                requestTimeout: .seconds(5),
                retryPolicy: RetryPolicy(maximumRetries: 0)
            )
            try await JarvisFactoryLiveActivityController.refreshExisting(client: client)
        }
    }
}
