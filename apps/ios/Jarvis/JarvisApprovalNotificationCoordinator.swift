import JarvisCore
import UserNotifications
import UIKit

extension Notification.Name {
    static let jarvisApprovalActionCompleted = Notification.Name("JarvisApprovalActionCompleted")
}

@MainActor
final class JarvisApprovalNotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    static let shared = JarvisApprovalNotificationCoordinator()
    static let actionResultKey = "jarvis.lockScreenApprovalAction"

    private static let categoryID = "jarvis.approval"
    private static let privateCategoryID = "jarvis.approval.private"
    private static let approveActionID = "jarvis.approval.approve"
    private static let declineActionID = "jarvis.approval.decline"
    static let requestTimeout: Duration = .seconds(8)

    private let center = UNUserNotificationCenter.current()
    private var approvalsClient: JarvisApprovalsClient?
    private var deviceToken: String?

    private override init() {
        super.init()
    }

    func configure(client: JarvisClient) {
        approvalsClient = JarvisApprovalsClient(client: client)
        center.delegate = self
        registerCategory(language: Self.currentLanguage)
    }

    private func registerCategory(language: JarvisAppLanguage) {
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: Self.categoryID,
                actions: [
                    UNNotificationAction(
                        identifier: Self.approveActionID,
                        title: JarvisApprovalLocalization.string(.approve, language: language),
                        options: [.authenticationRequired]
                    ),
                    UNNotificationAction(
                        identifier: Self.declineActionID,
                        title: JarvisApprovalLocalization.string(.decline, language: language),
                        options: [.authenticationRequired]
                    ),
                ],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: Self.privateCategoryID,
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
        ])
    }

    func refresh(language: JarvisAppLanguage) async {
        registerCategory(language: language)
        guard let approvalsClient else {
            await synchronize([], language: language)
            return
        }
        do {
            let pending = try await approvalsClient.pendingConfirmations()
            await synchronize(pending.confirmations, language: language)
        } catch {
            await removeLegacyPendingNotifications()
        }
        guard let deviceToken else { return }
        let settings = await center.notificationSettings()
        guard Self.notificationsAllowed(settings.authorizationStatus) else {
            try? await approvalsClient.unregisterDeviceToken(deviceToken)
            return
        }
        try? await approvalsClient.registerDeviceToken(
            deviceToken,
            language: language,
            showActions: settings.showPreviewsSetting != .never
        )
    }

    func synchronize(_ confirmations: [PendingConfirmation], language: JarvisAppLanguage) async {
        registerCategory(language: language)
        let currentIDs = Set(confirmations.map(\.id))
        await removeLegacyPendingNotifications()
        let delivered = await center.deliveredNotifications().filter {
            $0.request.content.categoryIdentifier == Self.categoryID ||
                $0.request.content.categoryIdentifier == Self.privateCategoryID
        }
        let staleIDs = delivered.compactMap { notification -> String? in
            let content = notification.request.content
            let confirmationID = content.userInfo["confirmationID"] as? String
            guard let confirmationID,
                  currentIDs.contains(confirmationID),
                  notification.request.identifier != confirmationID else {
                return notification.request.identifier
            }
            return nil
        }
        center.removeDeliveredNotifications(withIdentifiers: staleIDs)
    }

    func requestAuthorizationIfNeeded() async -> Bool {
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else {
            return Self.notificationsAllowed(settings.authorizationStatus)
        }
        return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true
    }

    func registerForRemoteNotificationsIfAuthorized() async {
        let settings = await center.notificationSettings()
        guard Self.notificationsAllowed(settings.authorizationStatus) else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegisterForRemoteNotifications(deviceToken data: Data) async {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        await refresh(language: Self.currentLanguage)
    }

    func unregisterDeviceToken() async {
        guard let deviceToken else { return }
        try? await approvalsClient?.unregisterDeviceToken(deviceToken)
    }

    func dismissNotification(confirmationID: String) async {
        let delivered = await center.deliveredNotifications().filter {
            ($0.request.content.userInfo["confirmationID"] as? String) == confirmationID
        }
        center.removeDeliveredNotifications(withIdentifiers: delivered.map(\.request.identifier))
    }

    private func removeLegacyPendingNotifications() async {
        let pendingRequests = await center.pendingNotificationRequests()
        let pendingIDs = pendingRequests.filter {
            $0.content.categoryIdentifier == Self.categoryID ||
                $0.content.categoryIdentifier == Self.privateCategoryID
        }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: pendingIDs)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if notification.request.content.categoryIdentifier == Self.categoryID ||
            notification.request.content.categoryIdentifier == Self.privateCategoryID {
            completionHandler([])
            return
        }
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            defer { completionHandler() }
            guard let decision = Self.decision(for: response.actionIdentifier),
                  let id = response.notification.request.content.userInfo["confirmationID"] as? String else {
                return
            }
            guard let approvalsClient else {
                await recordActionFailure()
                return
            }

            do {
                try await approvalsClient.resolveConfirmation(id: id, decision: decision)
                UserDefaults.standard.set(decision.rawValue, forKey: Self.actionResultKey)
                await dismissNotification(confirmationID: id)
                NotificationCenter.default.post(name: .jarvisApprovalActionCompleted, object: nil)
            } catch {
                await recordActionFailure()
            }
        }
    }

    private func recordActionFailure() async {
        UserDefaults.standard.set("failed", forKey: Self.actionResultKey)
        NotificationCenter.default.post(name: .jarvisApprovalActionCompleted, object: nil)
        let language = Self.currentLanguage
        let content = UNMutableNotificationContent()
        content.title = "Jarvis"
        content.body = JarvisApprovalLocalization.string(.actionFailed, language: language)
        do {
            try await center.add(
                UNNotificationRequest(
                    identifier: "jarvis.approval.failure.\(UUID().uuidString)",
                    content: content,
                    trigger: nil
                )
            )
        } catch {
            return
        }
    }

    private static func decision(for actionID: String) -> ConfirmationDecision? {
        switch actionID {
        case approveActionID: .approve
        case declineActionID: .reject
        default: nil
        }
    }

    private static var currentLanguage: JarvisAppLanguage {
        JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
    }

    private static func notificationsAllowed(_ status: UNAuthorizationStatus) -> Bool {
        status == .authorized || status == .provisional || status == .ephemeral
    }
}
