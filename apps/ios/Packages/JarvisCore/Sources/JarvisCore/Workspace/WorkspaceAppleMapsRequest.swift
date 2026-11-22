import Foundation

/// The only lookup evidence that leaves the phone.
public struct WorkspaceMapReceipt: Encodable, Equatable, Sendable {
    public enum Reason: String, Encodable, Sendable {
        case needsOrigin = "needs_origin"
        case noMatches = "no_matches"
        case partial, unavailable
    }
    public let matches: Int
    public let spoken: Bool
    public let reason: Reason?

    public init(matches: Int, spoken: Bool, reason: Reason? = nil) {
        self.matches = matches
        self.spoken = spoken
        self.reason = reason
    }
}

extension AppleMapsRequest {
    public init?(command: WorkspaceCommand) {
        guard command.operation == "apple-maps", command.fields["target"] == .string("phone"),
              let data = try? JSONEncoder().encode(command.fields),
              let request = try? JSONDecoder().decode(Self.self, from: data),
              request.mode == nil || request.mode == "driving" || request.mode == "walking",
              !request.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              request.query.count <= 300, (request.origin?.count ?? 0) <= 300,
              request.origin?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != true,
              request.bufferMinutes.map({ (0...1440).contains($0) }) ?? true,
              request.arriveBy == nil || request.arrivalDate != nil else { return nil }
        self = request
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
