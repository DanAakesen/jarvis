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

    private static func plain(_ value: Double, fractionDigits: Int, language: JarvisAppLanguage) -> String {
        let formatter = NumberFormatter()
        formatter.locale = language.locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(Int(value.rounded()))
    }
}
