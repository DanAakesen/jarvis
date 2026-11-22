import Foundation

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

    public init(
        name: String,
        latitude: Double,
        longitude: Double
    ) {
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
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

    public init(
        places: [AppleMapsPlace],
        mode: String,
        observedAt: String,
        origin: AppleMapsOrigin? = nil,
        arriveBy: String? = nil,
        bufferMinutes: Int? = nil,
        reason: String? = nil
    ) {
        self.places = places
        self.mode = mode
        self.observedAt = observedAt
        self.origin = origin
        self.arriveBy = arriveBy
        self.bufferMinutes = bufferMinutes
        self.reason = reason
    }
}
