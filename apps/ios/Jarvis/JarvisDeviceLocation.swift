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

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    /// Returns true when the saved location was updated. Does nothing without permission, and saves at most
    /// once per hour.
    func sync(using settings: JarvisSettingsClient) async -> Bool {
        let last = UserDefaults.standard.double(forKey: Self.lastSyncKey)
        guard Date().timeIntervalSince1970 - last > 3600 else { return false }
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
            for _ in 0..<60 where manager.authorizationStatus == .notDetermined {
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        guard manager.authorizationStatus == .authorizedWhenInUse ||
                manager.authorizationStatus == .authorizedAlways,
              let location = await currentLocation(),
              let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first,
              let city = placemark.locality ?? placemark.administrativeArea,
              let patch = DeviceLocationSettings.patch(
                city: city,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude
              ) else { return false }
        do {
            _ = try await settings.saveSettings(patch)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastSyncKey)
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
