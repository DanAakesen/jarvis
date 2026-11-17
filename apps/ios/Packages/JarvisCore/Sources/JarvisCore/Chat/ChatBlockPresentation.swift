import Foundation

/// Text and numbers for conversational blocks. Everything here is derived from the stored block, so a block
/// reads the same every time it is shown.
public enum ChatBlockFormatting {
    /// "Fri 20 Nov" from a YYYY-MM-DD calendar date. The date is not shifted by any time zone.
    public static func forecastDate(_ value: String, locale: Locale) -> String? {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: value), parser.string(from: date) == value else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEE d MMM"
        return formatter.string(from: date)
    }

    /// "16 Nov, 16:02" from an RFC 3339 instant, in the reader's time zone.
    public static func issuedText(_ value: String, locale: Locale, timeZone: TimeZone = .current) -> String? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        guard let date = fractional.date(from: value) ?? plain.date(from: value) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateFormat = "d MMM, HH:mm"
        return formatter.string(from: date)
    }

    /// "9°C", "20%" or "4.5 km": percent and degree units sit against the number, others after a space.
    public static func value(_ value: Double, unit: String, locale: Locale, maximumFractionDigits: Int = 1) -> String {
        let number = number(value, locale: locale, maximumFractionDigits: maximumFractionDigits)
        if unit.isEmpty { return number }
        let attached = unit == "%" || unit.hasPrefix("°")
        return attached ? number + unit : number + "\u{00A0}" + unit
    }

    public static func number(_ value: Double, locale: Locale, maximumFractionDigits: Int = 1) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = maximumFractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// SF Symbol for a forecast symbol; an unknown symbol is a plain cloud, never a wrong weather claim.
    public static func symbolName(for symbol: String) -> String {
        switch symbol {
        case "clear": "sun.max"
        case "partly-cloudy": "cloud.sun"
        case "cloudy": "cloud"
        case "fog": "cloud.fog"
        case "drizzle": "cloud.drizzle"
        case "rain": "cloud.rain"
        case "snow": "cloud.snow"
        case "thunder": "cloud.bolt.rain"
        case "wind": "wind"
        default: "cloud"
        }
    }
}

extension ChatBlockForecast {
    /// "9° / 5°", with a dash for a value the source did not give.
    public func highLowText(locale: Locale) -> String {
        func part(_ value: Double?) -> String {
            value.map { ChatBlockFormatting.number($0, locale: locale) + "°" } ?? "–"
        }
        return "\(part(highC)) / \(part(lowC))"
    }

    public var hasTemperature: Bool { highC != nil || lowC != nil }
}

extension ChatBlockChartPanel {
    public struct Row: Equatable, Sendable {
        public let label: String
        /// One entry per series, in series order; `nil` is a missing value.
        public let values: [Double?]
    }

    /// X labels in the order they first appear across the series.
    public func labels(locale: Locale) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for series in self.series {
            for point in series.points {
                let label = Self.label(for: point.x, locale: locale)
                if seen.insert(label).inserted { ordered.append(label) }
            }
        }
        return ordered
    }

    public func rows(locale: Locale) -> [Row] {
        labels(locale: locale).map { label in
            Row(
                label: label,
                values: series.map { series in
                    series.points.first { Self.label(for: $0.x, locale: locale) == label }?.y
                }
            )
        }
    }

    public var hasMissingValues: Bool {
        series.contains { $0.points.contains { $0.y == nil } }
    }

    public var hasValues: Bool {
        series.contains { $0.points.contains { $0.y != nil } }
    }

    /// The value scale of this panel alone. Bars, areas and percentages start at zero.
    public var domain: ClosedRange<Double> {
        let values = series.flatMap { $0.points.compactMap(\.y) }
        guard let low = values.min(), let high = values.max() else { return 0...1 }
        if unit == "%" {
            return 0...max(10, min(100, (high / 10).rounded(.up) * 10), high.rounded(.up))
        }
        if kind != .line {
            let lower = min(0, low)
            let upper = max(0, high)
            return lower...(upper > lower ? upper : lower + 1)
        }
        let padding = max((high - low) * 0.2, 1)
        return (low - padding).rounded(.down)...(high + padding).rounded(.up)
    }

    /// A sentence per panel for VoiceOver and for copying: every point with its value, missing ones said so.
    public func dataDescription(xLabel: String, locale: Locale, missing: String) -> String {
        let lines = series.map { series -> String in
            let points = series.points.map { point -> String in
                let value = point.y.map { ChatBlockFormatting.value($0, unit: unit, locale: locale) } ?? missing
                return "\(Self.label(for: point.x, locale: locale)) \(value)"
            }
            return "\(series.name): \(points.joined(separator: ", "))"
        }
        return "\(title) (\(unit)), \(xLabel). \(lines.joined(separator: ". "))"
    }

    public static func label(for coordinate: GeneratedChartPoint.Coordinate, locale: Locale) -> String {
        switch coordinate {
        case .string(let value): value
        case .number(let value): ChatBlockFormatting.number(value, locale: locale, maximumFractionDigits: 2)
        }
    }
}

extension ChatBlockChart {
    public struct Table: Equatable, Sendable {
        public let header: [String]
        public let rows: [[String]]
    }

    /// X labels of every panel, in the order they first appear.
    public func labels(locale: Locale) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for label in panels.flatMap({ $0.labels(locale: locale) }) where seen.insert(label).inserted {
            ordered.append(label)
        }
        return ordered
    }

    /// Every plotted value as text, one row per x label and one column per series. A value the source did
    /// not give reads as `missing`, never as zero.
    public func table(locale: Locale, missing: String) -> Table {
        let columns = panels.flatMap { panel in panel.series.map { (panel: panel, series: $0) } }
        let header = [xLabel] + columns.map { "\($0.series.name) (\($0.panel.unit))" }
        let rows = labels(locale: locale).map { label -> [String] in
            [label] + columns.map { column in
                let point = column.series.points.first {
                    ChatBlockChartPanel.label(for: $0.x, locale: locale) == label
                }
                return point?.y.map { ChatBlockFormatting.value($0, unit: column.panel.unit, locale: locale) } ?? missing
            }
        }
        return Table(header: header, rows: rows)
    }
}

extension ChatBlock {
    /// The block as plain text, for copying: title, source line and the data.
    public func plainText(locale: Locale, missing: String, sourceLine: String) -> String {
        var lines = [title]
        switch content {
        case .forecast(let forecast):
            let date = ChatBlockFormatting.forecastDate(forecast.date, locale: locale) ?? forecast.date
            lines.append("\(forecast.place), \(date)")
            lines.append("\(forecast.conditions), \(forecast.highLowText(locale: locale))")
            if let chance = forecast.rainChancePercent {
                lines.append(ChatBlockFormatting.value(chance, unit: "%", locale: locale))
            }
        case .chart(let chart):
            lines += chart.panels.map { $0.dataDescription(xLabel: chart.xLabel, locale: locale, missing: missing) }
        case .view, .unsupported:
            lines.append(summary)
        }
        lines.append(sourceLine)
        return lines.joined(separator: "\n")
    }
}
