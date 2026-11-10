import Foundation

/// Recorded body measurements only: gaps stay empty and different units never share a scale.
public struct JarvisBodyTrend: Equatable, Sendable {
    public struct Reading: Equatable, Identifiable, Sendable {
        public let id: Int
        public let day: String
        public let date: Date
        public let value: Double
        public let unit: String
    }

    public let readings: [Reading]
    public let excludesOtherUnits: Bool
    public var latest: Reading? { readings.last }

    public init(rows: [[String: JSONValue]], period: JarvisHealthPeriod) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        var valid: [Reading] = []
        for (index, row) in rows.enumerated() {
            guard case .string(let rawDay) = row["metric_date"],
                  let day = JarvisHealthLogic.day(rawDay) else { continue }
            guard day >= period.startDate, day <= period.endDate,
                  JarvisHealthPeriod(startDate: day, endDate: day) != nil,
                  let date = formatter.date(from: day) else { continue }
            let value: Double
            if case .number(let recorded) = row["value"] {
                value = recorded
            } else if case .number(let average) = row["avg_value"] {
                value = average
            } else {
                continue
            }
            guard value.isFinite, case .string(let unit) = row["unit"], !unit.isEmpty else { continue }
            valid.append(Reading(id: index, day: day, date: date, value: value, unit: unit))
        }
        valid.sort { lhs, rhs in
            if lhs.date == rhs.date { return lhs.id < rhs.id }
            return lhs.date < rhs.date
        }
        let unit = valid.last?.unit
        readings = valid.filter { $0.unit == unit }
        excludesOtherUnits = readings.count != valid.count
    }

    /// A sparse chart selects a recorded point, never an interpolated measurement.
    public func nearest(to date: Date) -> Reading? {
        readings.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }
    }

    /// Row positions can change during refresh; retain only the same recorded measurement.
    public func selectionID(retaining selectedID: Int?, from previous: Self) -> Int? {
        guard let selectedID, let selected = previous.readings.first(where: { $0.id == selectedID }) else {
            return nil
        }
        return readings.first {
            $0.day == selected.day && $0.value == selected.value && $0.unit == selected.unit
        }?.id
    }

    /// A labelled, padded scale keeps single/constant readings visible without manufacturing a trend.
    public var domain: ClosedRange<Double> {
        let low = readings.map(\.value).min() ?? 0
        let high = readings.map(\.value).max() ?? 0
        let padding = max((high - low) * 0.2, 1)
        return (low - padding)...(high + padding)
    }
}
