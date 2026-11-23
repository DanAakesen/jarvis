import CoreLocation
import JarvisCore
import MapKit

@MainActor
final class JarvisAppleMaps: NSObject, CLLocationManagerDelegate {
    private lazy var locationManager: CLLocationManager = {
        let manager = CLLocationManager()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        return manager
    }()

    func lookup(_ request: AppleMapsRequest) async throws -> (result: AppleMapsResult, status: WorkspaceMapReceipt.Reason?) {
        var origin: AppleMapsOrigin?
        var reason: String?
        var status: WorkspaceMapReceipt.Reason?
        var start: MKMapItem?
        if request.searchOnly != true, let manual = request.origin {
            do {
                let matches = try await search(manual)
                if matches.count == 1, let item = matches.first {
                    start = item
                    let coordinate = item.location.coordinate
                    origin = AppleMapsOrigin(name: item.name ?? manual, latitude: coordinate.latitude, longitude: coordinate.longitude)
                } else {
                    reason = matches.isEmpty ? "Apple Maps could not find the starting address." : "Several starting places matched. Ask for the full starting address."
                }
            } catch {
                try Task.checkCancellation()
                reason = "Apple Maps could not look up the starting address."
            }
        } else if request.searchOnly != true {
            if let point = try await currentOrigin() {
                start = MKMapItem(location: CLLocation(latitude: point.latitude, longitude: point.longitude), address: nil)
                origin = AppleMapsOrigin(name: "Current location", latitude: point.latitude, longitude: point.longitude, isCurrentLocation: true)
            } else {
                let denied = [.denied, .restricted].contains(locationManager.authorizationStatus)
                reason = denied ? "Location access is off. Ask for a starting address." : "The iPhone has no recent location fix for this route. Ask for a starting address."
            }
        }

        if !request.canSearchDestination(hasOrigin: start != nil) {
            return (AppleMapsResult(places: [], mode: request.mode ?? "driving", observedAt: Date().ISO8601Format(), reason: reason), .needsOrigin)
        }

        var places: [AppleMapsPlace] = []
        do {
            let matches = try await search(request.query, near: start?.location.coordinate, business: request)
            let indices: [Int]
            if (request.nearby != nil || request.nearest == true), let center = start?.location {
                indices = request.rankedBusinessIndices(matches.map { ($0.name, $0.location.distance(from: center)) })
            } else {
                indices = Array(matches.indices.prefix(3))
            }
            for index in indices {
                let item = matches[index]
                try Task.checkCancellation()
                let route: MKRoute?
                if let start {
                    let directions = MKDirections.Request()
                    directions.source = start
                    directions.destination = item
                    directions.transportType = request.mode == "walking" ? .walking : .automobile
                    if let arrivalDate = request.arrivalDate { directions.arrivalDate = arrivalDate }
                    route = try? await MKDirections(request: directions).calculate().routes.first
                } else {
                    route = nil
                }
                try Task.checkCancellation()
                let coordinate = item.location.coordinate
                places.append(AppleMapsPlace(name: item.name ?? request.query, address: item.address?.fullAddress ?? "",
                    latitude: coordinate.latitude, longitude: coordinate.longitude,
                    travelSeconds: route?.expectedTravelTime, distanceMeters: route?.distance,
                    straightLineMeters: start.map { item.location.distance(from: $0.location) },
                    path: route.map { sampledPath($0.polyline, fromDevice: request.origin == nil) }))
            }
            if places.isEmpty {
                status = .noMatches
                reason = request.nearby == nil ? "Apple Maps found no matching destination." : "Apple Maps found no matching place within \(AppleMapsRequest.nearbyRadiusMeters / 1000) km."
            } else if start != nil && places.contains(where: { $0.travelSeconds == nil }) {
                status = .partial
                reason = "Apple Maps did not return a route for every destination."
            }
        } catch {
            try Task.checkCancellation()
            status = .unavailable
            reason = "Apple Maps could not search for the destination."
        }
        let result = AppleMapsResult(places: places, mode: request.mode ?? "driving", observedAt: Date().ISO8601Format(),
            origin: origin, arriveBy: request.arriveBy, bufferMinutes: request.bufferMinutes ?? 0, reason: reason,
            nearbyRadiusMeters: request.nearby != nil && status != .unavailable ? AppleMapsRequest.nearbyRadiusMeters : nil,
            nearest: request.nearest == true && !places.isEmpty ? true : nil)
        return (result, status)
    }

    private func search(_ query: String, near coordinate: CLLocationCoordinate2D? = nil, business: AppleMapsRequest? = nil) async throws -> [MKMapItem] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        let nearby = business?.nearby != nil
        let nearest = business?.nearest == true
        request.resultTypes = nearby || nearest ? [.pointOfInterest] : [.address, .pointOfInterest]
        if let coordinate {
            // For nearest, bias the regional search around the origin while allowing results beyond it.
            let span = nearest ? 500_000.0 : Double(AppleMapsRequest.nearbyRadiusMeters * 2)
            request.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: span, longitudinalMeters: span)
            if nearby { request.regionPriority = .required }
        }
        do {
            return try await MKLocalSearch(request: request).start().mapItems
        } catch let error as MKError where error.code == .placemarkNotFound {
            return []
        }
    }

    private func currentOrigin() async throws -> AppleMapsPoint? {
        let manager = locationManager
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
            for _ in 0..<24 where manager.authorizationStatus == .notDetermined {
                try await Task.sleep(for: .milliseconds(250))
            }
        }
        guard [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) else { return nil }
        manager.startUpdatingLocation()
        defer { manager.stopUpdatingLocation() }
        for _ in 0..<24 {
            try Task.checkCancellation()
            if let fix = manager.location, abs(fix.timestamp.timeIntervalSinceNow) < 120,
               (0...500).contains(fix.horizontalAccuracy), CLLocationCoordinate2DIsValid(fix.coordinate) {
                return AppleMapsRequest.approximate(AppleMapsPoint(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude))
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        return nil
    }

    private func sampledPath(_ polyline: MKPolyline, fromDevice: Bool) -> [AppleMapsPoint] {
        let points = polyline.points()
        return AppleMapsRequest.sampleIndices(pointCount: polyline.pointCount).map { index in
            let coordinate = points[index].coordinate
            let point = AppleMapsPoint(latitude: coordinate.latitude, longitude: coordinate.longitude)
            return fromDevice && index == 0 ? AppleMapsRequest.approximate(point) : point
        }
    }
}
