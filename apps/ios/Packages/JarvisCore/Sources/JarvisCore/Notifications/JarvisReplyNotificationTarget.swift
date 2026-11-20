import Foundation

/// Exact stored conversation identity carried by an ordinary Jarvis reply notification.
public struct JarvisReplyNotificationTarget: Codable, Equatable, Sendable {
    public static let pendingDefaultsKey = "jarvis.reply.pendingTarget"
    public static let activeDefaultsKey = "jarvis.reply.activeTarget"

    private enum CodingKeys: String, CodingKey {
        case sessionID, messageID
    }

    public let sessionID: String
    public let messageID: String

    public init?(sessionID: String, messageID: String) {
        guard Self.validID(sessionID), Self.validID(messageID) else { return nil }
        self.sessionID = sessionID
        self.messageID = messageID
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(sessionID, forKey: .sessionID)
        try values.encode(messageID, forKey: .messageID)
    }

    public init?(userInfo: [AnyHashable: Any]) {
        guard let sessionID = userInfo["sessionID"] as? String,
              let messageID = userInfo["messageID"] as? String else {
            return nil
        }
        self.init(sessionID: sessionID, messageID: messageID)
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let sessionID = try values.decode(String.self, forKey: .sessionID)
        let messageID = try values.decode(String.self, forKey: .messageID)
        guard Self.validID(sessionID), Self.validID(messageID) else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Invalid reply target")
            )
        }
        self.sessionID = sessionID
        self.messageID = messageID
    }

    public func store(in defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults.set(data, forKey: Self.pendingDefaultsKey)
    }

    public static func pending(in defaults: UserDefaults = .standard) -> Self? {
        guard let data = defaults.data(forKey: pendingDefaultsKey), data.count <= 256 else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }

    public func clear(in defaults: UserDefaults = .standard) {
        guard Self.pending(in: defaults) == self else { return }
        defaults.removeObject(forKey: Self.pendingDefaultsKey)
    }

    public func activate(in defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults.set(data, forKey: Self.activeDefaultsKey)
        if Self.pending(in: defaults) == self {
            defaults.removeObject(forKey: Self.pendingDefaultsKey)
        }
    }

    public static func active(in defaults: UserDefaults = .standard) -> Self? {
        guard let data = defaults.data(forKey: activeDefaultsKey), data.count <= 256 else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }

    public func clearActive(in defaults: UserDefaults = .standard) {
        guard Self.active(in: defaults) == self else { return }
        defaults.removeObject(forKey: Self.activeDefaultsKey)
    }

    private static func validID(_ value: String) -> Bool {
        guard value.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil,
              let number = Int64(value) else {
            return false
        }
        return number > 0
    }
}
