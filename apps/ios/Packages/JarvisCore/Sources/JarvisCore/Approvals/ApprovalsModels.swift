import Foundation

public enum ConfirmationActionKind: String, Codable, Equatable, Sendable {
    case merge
    case delete
    case sendMail = "send_mail"
    case calendarChange = "calendar_change"
    case createRepository = "create_repository"
    case computerUse = "computer_use"
    case spendMoney = "spend_money"
    case modelDeployment = "model_deployment"
    case other
}

public struct PendingConfirmation: Codable, Equatable, Sendable {
    public let id: String
    public let actionKind: ConfirmationActionKind
    public let summary: String
    public let expiresAt: String
}

public enum ConfirmationDecision: String, Codable, Equatable, Sendable {
    case approve
    case reject
}

public enum JarvisApprovalsClientError: Error, Equatable, Sendable {
    case invalidConfirmationID
    case invalidResponse
    case noLongerAvailable
}
