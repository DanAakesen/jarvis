import Foundation

public enum WorkspaceCommandIntent: Equatable, Sendable {
    case navigate(page: String)
    case present(viewId: String, view: GeneratedView)
    case focus(viewId: String)
    case dismiss(viewId: String)
}

public enum WorkspaceCommandInterpretation: Equatable, Sendable {
    case supported(WorkspaceCommandIntent)
    case refused(reason: String)
    case error(reason: String)
}

public enum WorkspaceCommandInterpreter {
    private static let navigationPages: Set<String> = [
        "home", "factory", "settings", "usage", "notes", "knowledge",
        "workspaces", "folio", "status", "daily", "health",
    ]

    public static func interpret(
        _ command: WorkspaceCommand,
        trustedBlobHost: String? = nil
    ) -> WorkspaceCommandInterpretation {
        switch command.operation {
        case "navigate":
            guard case .string(let page)? = command.fields["page"], navigationPages.contains(page) else {
                return .refused(reason: "This destination is not available on iPhone.")
            }
            return .supported(.navigate(page: page))
        case "create", "update":
            guard case .string(let viewId)? = command.fields["viewId"], validViewID(viewId),
                  let value = command.fields["view"] else {
                return .refused(reason: "The workspace view is incomplete.")
            }
            let decoder = JSONDecoder()
            if let trustedBlobHost {
                decoder.userInfo[GeneratedViewDecodingContext.trustedBlobHostKey] = trustedBlobHost
            }
            do {
                let view = try decoder.decode(GeneratedView.self, from: JSONEncoder().encode(value))
                return .supported(.present(viewId: viewId, view: view))
            } catch {
                return .error(reason: "The workspace view could not be validated.")
            }
        case "show", "focus", "restore":
            guard case .string(let viewId)? = command.fields["viewId"], validViewID(viewId) else {
                return .refused(reason: "The workspace view is not available on iPhone.")
            }
            return .supported(.focus(viewId: viewId))
        case "close", "minimise":
            guard case .string(let viewId)? = command.fields["viewId"], validViewID(viewId) else {
                return .refused(reason: "The workspace view is not available on iPhone.")
            }
            return .supported(.dismiss(viewId: viewId))
        case "move", "resize":
            return .refused(reason: "Window positioning is not supported on iPhone.")
        default:
            return .refused(reason: "This workspace operation is not supported on iPhone.")
        }
    }

    private static func validViewID(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil
    }
}

public enum WorkspaceCommandResult: Equatable, Sendable {
    case applied
    case refused(reason: String)
    case error(reason: String)
}

public struct WorkspaceCommandProcessor: Sendable {
    public init() {}

    public func acknowledge(
        command: WorkspaceCommand,
        expiresAtMilliseconds: Int64,
        trustedBlobHost: String?,
        using client: JarvisWorkspaceClient,
        apply: @escaping @Sendable (WorkspaceCommand, String?) async -> WorkspaceCommandResult
    ) async throws {
        let result = await apply(command, trustedBlobHost)
        switch result {
        case .applied:
            try await client.acknowledge(
                commandId: command.commandId,
                expiresAtMilliseconds: expiresAtMilliseconds,
                applied: true
            )
        case .refused(let reason):
            try await client.acknowledge(
                commandId: command.commandId,
                expiresAtMilliseconds: expiresAtMilliseconds,
                applied: false,
                outcome: .refused,
                reason: reason
            )
        case .error(let reason):
            try await client.acknowledge(
                commandId: command.commandId,
                expiresAtMilliseconds: expiresAtMilliseconds,
                applied: false,
                outcome: .error,
                reason: reason
            )
        }
    }
}
