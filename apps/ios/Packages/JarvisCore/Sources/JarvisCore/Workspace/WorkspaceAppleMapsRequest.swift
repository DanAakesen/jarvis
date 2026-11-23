import Foundation

/// The only lookup evidence that leaves the phone.
public struct WorkspaceMapReceipt: Encodable, Equatable, Sendable {
    public enum Reason: String, Encodable, Sendable {
        case needsOrigin = "needs_origin"
        case noMatches = "no_matches"
        case partial, unavailable
        case expiredLookup = "expired_lookup"
        case invalidChoice = "invalid_choice"
    }
    public let matches: Int
    public let spoken: Bool
    public let reason: Reason?
    public let nearbyRadiusMeters: Int?

    public init(matches: Int, spoken: Bool, reason: Reason? = nil, nearbyRadiusMeters: Int? = nil) {
        self.matches = matches
        self.spoken = spoken
        self.reason = reason
        self.nearbyRadiusMeters = nearbyRadiusMeters
    }
}

public struct AppleMapsSelection: Equatable, Sendable {
    public let lookupId: String
    public let ordinal: Int

    public init?(command: WorkspaceCommand) {
        guard command.operation == "apple-maps", command.fields["target"] == .string("phone"),
              command.fields.keys.allSatisfy({ ["target", "speakResult", "lookupId", "ordinal"].contains($0) }),
              case .string(let id)? = command.fields["lookupId"], UUID(uuidString: id) != nil,
              case .number(let number)? = command.fields["ordinal"], let ordinal = Int(exactly: number),
              (1...3).contains(ordinal) else { return nil }
        self.lookupId = id
        self.ordinal = ordinal
    }
}

extension AppleMapsRequest {
    public init?(command: WorkspaceCommand) {
        guard command.operation == "apple-maps", command.fields["target"] == .string("phone"),
              command.fields["lookupId"] == nil, command.fields["ordinal"] == nil,
              let data = try? JSONEncoder().encode(command.fields),
              let request = try? JSONDecoder().decode(Self.self, from: data),
              request.nearby == nil || request.searchOnly != true,
              request.mode == nil || request.mode == "driving" || request.mode == "walking",
              !request.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              request.query.count <= 300, (request.origin?.count ?? 0) <= 300,
              request.origin?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != true,
              request.bufferMinutes.map({ (0...1440).contains($0) }) ?? true,
              request.arriveBy == nil || request.arrivalDate != nil else { return nil }
        self = request
    }

    public func canSearchDestination(hasOrigin: Bool) -> Bool {
        hasOrigin || (searchOnly == true && nearby == nil)
    }

    public static let nearbyRadiusMeters = 10_000

    /// MapKit can return an approximate name match. A branded lookup needs the requested name on the POI itself.
    public func acceptsNearbyPlace(name: String?, distanceMeters: Double) -> Bool {
        guard let nearby, (0...Double(Self.nearbyRadiusMeters)).contains(distanceMeters),
              let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        guard nearby == .name else { return true }
        func normalizedName(_ text: String) -> String {
            text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
        }
        let requested = normalizedName(query)
        return !requested.isEmpty && " \(normalizedName(name)) ".contains(" \(requested) ")
    }

    public var arrivalDate: Date? {
        guard let arriveBy else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        let date = formatter.date(from: arriveBy) ?? ISO8601DateFormatter().date(from: arriveBy)
        return date?.addingTimeInterval(-Double(bufferMinutes ?? 0) * 60)
    }

    /// Quantize before passing a device fix into directions, so route geometry never starts from raw GPS.
    public static func approximate(_ point: AppleMapsPoint) -> AppleMapsPoint {
        let latitude = (point.latitude * 1000).rounded() / 1000
        let degreesPerStep = 0.001 / max(0.05, cos(latitude * .pi / 180))
        return AppleMapsPoint(latitude: latitude,
                              longitude: min(180, max(-180, (point.longitude / degreesPerStep).rounded() * degreesPerStep)))
    }

    /// Keep both ends and sample evenly across the points MapKit actually returned.
    public static func sampleIndices(pointCount: Int) -> [Int] {
        guard pointCount > 0 else { return [] }
        let count = min(64, pointCount)
        guard count > 1 else { return [0] }
        return (0..<count).map { Int((Double($0) * Double(pointCount - 1) / Double(count - 1)).rounded()) }
    }
}
