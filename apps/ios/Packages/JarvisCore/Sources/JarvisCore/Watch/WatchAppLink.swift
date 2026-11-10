import Foundation

/// Navigation only. Opening a capture destination never authorizes a save.
public enum WatchAppLink: String, CaseIterable, Sendable {
    case dashboard, chat, menu, tasks, health, agenda, notes, home, nutrition, dictate, voice
    case bodyFat = "body-fat"
    case logLift = "log-lift"
    case endVoice = "end-voice"

    public var url: URL { URL(string: "jarvis-watch://\(rawValue)")! }

    public init?(url: URL) {
        guard url.scheme?.lowercased() == "jarvis-watch", url.user == nil, url.password == nil,
              url.port == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/", let host = url.host?.lowercased() else { return nil }
        if host == "bodyfat" { self = .bodyFat }
        else {
            guard let value = Self(rawValue: host) else { return nil }
            self = value
        }
    }
}
