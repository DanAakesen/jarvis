import JarvisCore
import UserNotifications

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
        guard let approvalsClient else { return }
        do {
            let pending = try await approvalsClient.pendingConfirmations()
            await synchronize(pending.confirmations, language: language)
        } catch {
            return
        }
    }

    func synchronize(_ confirmations: [PendingConfirmation], language: JarvisAppLanguage) async {
        registerCategory(language: language)
        let now = Date()
        let validConfirmations = confirmations.compactMap { confirmation -> (PendingConfirmation, Date)? in
            guard let expiresAt = Self.date(from: confirmation.expiresAt), expiresAt > now else {
                return nil
            }
            return (confirmation, expiresAt)
        }
        let currentIDs = Set(validConfirmations.map { $0.0.id })
        let pendingRequests = await center.pendingNotificationRequests()
        let deliveredNotifications = await center.deliveredNotifications()
        let approvalPending = pendingRequests.filter {
            $0.content.categoryIdentifier == Self.categoryID ||
                $0.content.categoryIdentifier == Self.privateCategoryID
        }
        let approvalDelivered = deliveredNotifications.filter {
            $0.request.content.categoryIdentifier == Self.categoryID ||
                $0.request.content.categoryIdentifier == Self.privateCategoryID
        }

        let stalePendingIDs = approvalPending.map(\.identifier).filter { !currentIDs.contains($0) }
        let staleDeliveredIDs = approvalDelivered.map(\.request.identifier).filter { !currentIDs.contains($0) }
        center.removePendingNotificationRequests(withIdentifiers: stalePendingIDs)
        center.removeDeliveredNotifications(withIdentifiers: staleDeliveredIDs)

        var existingNotifications = [String: (body: String, category: String)]()
        for request in approvalPending {
            existingNotifications[request.identifier] = (
                request.content.body,
                request.content.categoryIdentifier
            )
        }
        for notification in approvalDelivered {
            existingNotifications[notification.request.identifier] = (
                notification.request.content.body,
                notification.request.content.categoryIdentifier
            )
        }

        guard !validConfirmations.isEmpty else { return }
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else {
                return
            }
        } else if settings.authorizationStatus == .denied {
            return
        }
        let showActions = (await center.notificationSettings()).showPreviewsSetting != .never

        for (confirmation, expiresAt) in validConfirmations {
            let content = Self.notificationContent(
                for: confirmation,
                expiresAt: expiresAt,
                language: language,
                showActions: showActions
            )
            if existingNotifications[confirmation.id]?.body == content.body,
               existingNotifications[confirmation.id]?.category == content.categoryIdentifier {
                continue
            }
            center.removePendingNotificationRequests(withIdentifiers: [confirmation.id])
            center.removeDeliveredNotifications(withIdentifiers: [confirmation.id])
            do {
                try await center.add(
                    UNNotificationRequest(
                        identifier: confirmation.id,
                        content: content,
                        trigger: nil
                    )
                )
            } catch {
                continue
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
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
                center.removeDeliveredNotifications(withIdentifiers: [id])
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

    private static func notificationContent(
        for confirmation: PendingConfirmation,
        expiresAt: Date,
        language: JarvisAppLanguage,
        showActions: Bool
    ) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = "Jarvis"
        let singleLineSummary = confirmation.summary
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        let summary = singleLineSummary.count > 240
            ? String(singleLineSummary.prefix(239)) + "…"
            : singleLineSummary
        let expiryTime = expiresAt.formatted(
            .dateTime.hour().minute().locale(language.locale)
        )
        let expiryTemplate = JarvisApprovalLocalization.string(.expires, language: language)
        let expiry = String(format: expiryTemplate, locale: language.locale, arguments: [expiryTime])
        content.body = "\(summary)\n\(expiry)"
        content.categoryIdentifier = showActions ? categoryID : privateCategoryID
        content.threadIdentifier = categoryID
        content.userInfo = ["confirmationID": confirmation.id]
        content.sound = .default
        return content
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

    private static func date(from value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }
}
