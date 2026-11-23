import CoreLocation
import Foundation
import JarvisCore

/// Asks for Location Services (while in use), reads one coarse fix and saves it as the home location the weather
/// tool uses, so the assistant knows the device's position after permission is granted.
/// API: CLLocationManager.requestWhenInUseAuthorization, CLGeocoder.reverseGeocodeLocation.
@MainActor
final class JarvisDeviceLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private static let lastSyncKey = "jarvis.deviceLocation.lastSync"
    private static let lastPermissionKey = "jarvis.deviceLocation.lastPermission"

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    /// Returns true when the saved location was updated. Does nothing without permission, and saves at most
    /// once per hour.
    func sync(using settings: JarvisSettingsClient) async -> Bool {
        let last = UserDefaults.standard.double(forKey: Self.lastSyncKey)
        let previous = UserDefaults.standard.object(forKey: Self.lastPermissionKey) as? Int
        guard Int(manager.authorizationStatus.rawValue) != previous || Date().timeIntervalSince1970 - last > 3600 else { return false }
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
            for _ in 0..<60 where manager.authorizationStatus == .notDetermined {
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return false }
            }
        }
        let authorization = manager.authorizationStatus
        func recordSync() {
            UserDefaults.standard.set(Int(authorization.rawValue), forKey: Self.lastPermissionKey)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastSyncKey)
        }
        if authorization == .notDetermined {
            if let patch = DeviceLocationSettings.permissionPatch("not_determined"),
               (try? await settings.saveSettings(patch)) != nil {
                recordSync()
            }
            return false
        }
        if authorization == .denied || authorization == .restricted {
            let value = authorization == .denied ? "denied" : "restricted"
            if let patch = DeviceLocationSettings.permissionPatch(value),
               (try? await settings.saveSettings(patch)) != nil {
                recordSync()
            }
            return false
        }
        guard authorization == .authorizedWhenInUse ||
                authorization == .authorizedAlways,
              let location = await currentLocation(),
              let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first,
              !Task.isCancelled, manager.authorizationStatus == authorization,
              let city = placemark.locality ?? placemark.administrativeArea,
              let patch = DeviceLocationSettings.patch(
                city: city,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                observedAt: location.timestamp
              ) else { return false }
        do {
            _ = try await settings.saveSettings(patch)
            recordSync()
            return true
        } catch {
            return false
        }
    }

    private func currentLocation() async -> CLLocation? {
        if let cached = manager.location, abs(cached.timestamp.timeIntervalSinceNow) < 900 { return cached }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            continuation?.resume(returning: locations.last)
            continuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            continuation?.resume(returning: nil)
            continuation = nil
        }
    }
}
