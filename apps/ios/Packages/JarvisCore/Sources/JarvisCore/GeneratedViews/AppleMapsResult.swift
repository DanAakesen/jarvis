import Foundation

public struct AppleMapsRequest: Codable, Equatable, Sendable {
    public enum Nearby: String, Codable, Sendable { case name, category }

    public let query: String
    public let origin: String?
    public let mode: String?
    public let arriveBy: String?
    public let bufferMinutes: Int?
    public let searchOnly: Bool?
    public let nearby: Nearby?

    public init(query: String, origin: String? = nil, mode: String? = nil, arriveBy: String? = nil,
                bufferMinutes: Int? = nil, searchOnly: Bool? = nil, nearby: Nearby? = nil) {
        self.query = query
        self.origin = origin
        self.mode = mode
        self.arriveBy = arriveBy
        self.bufferMinutes = bufferMinutes
        self.searchOnly = searchOnly
        self.nearby = nearby
    }
}

/// The conversation retains the owner's request. MapKit's response lives temporarily on the iPhone.
public struct AppleMapsViewData: Codable, Equatable, Sendable {
    public let lookupId: String
    public let request: AppleMapsRequest?
}

public struct AppleMapsPoint: Codable, Equatable, Sendable {
    public let latitude: Double
    public let longitude: Double

    public init(
        latitude: Double,
        longitude: Double
    ) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

public struct AppleMapsOrigin: Codable, Equatable, Sendable {
    public let name: String
    public let latitude: Double
    public let longitude: Double

    public let isCurrentLocation: Bool?

    public init(
        name: String,
        latitude: Double,
        longitude: Double,
        isCurrentLocation: Bool? = nil
    ) {
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.isCurrentLocation = isCurrentLocation
    }
}

public struct AppleMapsPlace: Codable, Equatable, Sendable {
    public let name: String
    public let address: String
    public let latitude: Double
    public let longitude: Double
    public let travelSeconds: Double?
    public let distanceMeters: Double?
    public let path: [AppleMapsPoint]?

    public init(
        name: String,
        address: String,
        latitude: Double,
        longitude: Double,
        travelSeconds: Double? = nil,
        distanceMeters: Double? = nil,
        path: [AppleMapsPoint]? = nil
    ) {
        self.name = name
        self.address = address
        self.latitude = latitude
        self.longitude = longitude
        self.travelSeconds = travelSeconds
        self.distanceMeters = distanceMeters
        self.path = path
    }
}

public struct AppleMapsResult: Codable, Equatable, Sendable {
    public let places: [AppleMapsPlace]
    public let mode: String
    public let observedAt: String
    public let origin: AppleMapsOrigin?
    public let arriveBy: String?
    public let bufferMinutes: Int?
    public let reason: String?
    public let nearbyRadiusMeters: Int?

    public init(
        places: [AppleMapsPlace],
        mode: String,
        observedAt: String,
        origin: AppleMapsOrigin? = nil,
        arriveBy: String? = nil,
        bufferMinutes: Int? = nil,
        reason: String? = nil,
        nearbyRadiusMeters: Int? = nil
    ) {
        self.places = places
        self.mode = mode
        self.observedAt = observedAt
        self.origin = origin
        self.arriveBy = arriveBy
        self.bufferMinutes = bufferMinutes
        self.reason = reason
        self.nearbyRadiusMeters = nearbyRadiusMeters
    }
}

extension AppleMapsPlace {
    public var travelMinutes: Int? {
        guard let travelSeconds, travelSeconds.isFinite, travelSeconds >= 0,
              let minutes = Int(exactly: ceil(travelSeconds / 60)) else { return nil }
        return max(1, minutes)
    }
}

extension AppleMapsResult {
    public func selecting(ordinal: Int) -> AppleMapsResult? {
        guard ordinal > 0, ordinal <= places.count else { return nil }
        let place = places[ordinal - 1]
        return AppleMapsResult(places: [place], mode: mode, observedAt: observedAt, origin: origin,
                               arriveBy: arriveBy, bufferMinutes: bufferMinutes,
                               reason: place.travelSeconds == nil && reason != nil ? "Apple Maps did not return a route for this place." : nil,
                               nearbyRadiusMeters: nearbyRadiusMeters)
    }

    public static func date(_ text: String) -> Date? {
        (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text)) ??
        (try? Date.ISO8601FormatStyle().parse(text))
    }
}
