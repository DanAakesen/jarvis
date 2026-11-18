import Foundation

/// What a tool does, derived from its stable identifier and never from localized display text.
/// Unknown tools stay `.generic` rather than borrowing another tool's icon.
public enum ChatToolKind: String, CaseIterable, Equatable, Sendable {
    case read, edit, command, web, configuration, deployment, generic

    public init(toolName: String) {
        if let exact = Self.exact[toolName] {
            self = exact
            return
        }
        let words = Set(toolName.lowercased().split(whereSeparator: { $0 == "_" || $0 == "-" }).map(String.init))
        // Order matters: `get_deployment_status` is a deployment tool, `pc_browser_act` a web tool.
        let families: [(Self, Set<String>)] = [
            (.deployment, ["deployment", "deployments", "deploy", "release", "releases"]),
            (.configuration, ["settings", "setting", "capabilities", "preferences", "config", "configuration", "profile"]),
            (.web, ["browser", "url", "web", "link", "research"]),
            (.command, ["act", "exec", "run", "shell", "terminal", "command", "codex", "click"]),
            (.edit, ["write", "create", "update", "edit", "send", "delete", "archive", "move", "remember",
                     "correct", "forget", "merge", "comment", "draft", "label", "capture", "confirm", "generation"]),
            (.read, ["get", "list", "read", "search", "query", "history", "lookup", "show", "log", "diff", "snapshot",
                     "tabs", "status", "items", "summary", "health"])
        ]
        self = families.first { !$0.1.isDisjoint(with: words) }?.0 ?? .generic
    }

    private static let exact: [String: Self] = [
        "az_group_list": .deployment,
        "manage_model_deployment": .deployment,
        "manage_repository": .configuration,
        "active_window": .read,
        "pc_active_window": .read,
        "open_app": .command,
        "open_file": .command,
        "open_folder": .command,
        "pc_open": .command,
        "close_app": .command,
        "pc_close": .command,
        "focus_window": .command
    ]
}

/// The state shown on a tool row. Derived from real events only; a final reply never turns a running call into a success.
public enum ChatToolStatus: Equatable, Sendable {
    case running, succeeded, failed, refused

    public init(outcome: ChatToolOutcome?) {
        switch outcome {
        case nil: self = .running
        case .ok: self = .succeeded
        case .error: self = .failed
        case .refused: self = .refused
        }
    }
}
