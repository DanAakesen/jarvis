import Foundation

public enum JarvisApprovalLocalizationKey: String, CaseIterable, Sendable {
    case approve = "approval.approve"
    case decline = "approval.decline"
    case expires = "approval.expires"
    case approvedFromLockScreen = "approval.approvedFromLockScreen"
    case declinedFromLockScreen = "approval.declinedFromLockScreen"
    case actionFailed = "approval.actionFailed"
    case notificationNow = "approval.notificationNow"
    case previewSummary = "approval.previewSummary"
}

public enum JarvisApprovalLocalization {
    public static func string(_ key: JarvisApprovalLocalizationKey, language: JarvisAppLanguage) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return key.rawValue
        }
        return bundle.localizedString(forKey: key.rawValue, value: key.rawValue, table: "JarvisApprovals")
    }
}
