import Foundation

/// Turns a device fix into the saved home-location setting that the weather tool reads, so the assistant has the
/// device's position once Location Services permission is granted. Coordinates are rounded to about one kilometre.
public enum DeviceLocationSettings {
    public static func patch(city: String, latitude: Double, longitude: Double) -> JarvisSettingsPatch? {
        guard latitude.isFinite, longitude.isFinite,
              (-90...90).contains(latitude), (-180...180).contains(longitude) else { return nil }
        let trimmed = String(city.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
        guard !trimmed.isEmpty else { return nil }
        return JarvisSettingsPatch(areas: [
            "location": [
                "city": .string(trimmed),
                "latitude": .number(rounded(latitude)),
                "longitude": .number(rounded(longitude)),
            ],
        ])
    }

    public static func rounded(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }
}
