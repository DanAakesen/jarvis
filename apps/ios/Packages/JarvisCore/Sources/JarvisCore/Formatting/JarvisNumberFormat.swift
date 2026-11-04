import Foundation

/// How large numbers are written everywhere in the app: thousands with k and millions with M, so 4,200 steps read
/// "4.2k" ("4,2k" in Danish). Numbers below 1,000 are written in full.
public enum JarvisNumberFormat {
    public static func compact(_ value: Int, language: JarvisAppLanguage = .default) -> String {
        compact(Double(value), language: language)
    }

    public static func compact(_ value: Double, language: JarvisAppLanguage = .default) -> String {
        guard value.isFinite else { return "—" }
        let magnitude = abs(value)
        if magnitude < 999.5 { return plain(value, fractionDigits: 0, language: language) }
        if magnitude < 999_500 {
            return plain(value / 1_000, fractionDigits: magnitude < 9_950 ? 1 : 0, language: language) + "k"
        }
        return plain(value / 1_000_000, fractionDigits: magnitude < 9_950_000 ? 1 : 0, language: language) + "M"
    }

    /// Like `compact`, but thousands always keep one decimal ("8,0k"), so a goal reads the same width as a count.
    public static func compactOneDecimal(_ value: Int, language: JarvisAppLanguage = .default) -> String {
        let magnitude = abs(Double(value))
        guard magnitude >= 999.5, magnitude < 999_500 else { return compact(value, language: language) }
        return plain(Double(value) / 1_000, fractionDigits: 1, minimumFractionDigits: 1, language: language) + "k"
    }

    private static func plain(
        _ value: Double,
        fractionDigits: Int,
        minimumFractionDigits: Int = 0,
        language: JarvisAppLanguage
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = language.locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = minimumFractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(Int(value.rounded()))
    }
}
