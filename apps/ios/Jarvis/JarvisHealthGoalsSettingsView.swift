import JarvisCore
import SwiftUI

/// Sleep, calorie, carb and fat goals for the Health charts. Stored on this device; protein uses the server target.
struct JarvisHealthGoalsSettingsView: View {
    let language: JarvisAppLanguage

    @Environment(\.dismiss) private var dismiss
    @State private var original = JarvisHealthGoals.load()
    @State private var sleep = ""
    @State private var kcal = ""
    @State private var carbs = ""
    @State private var fat = ""

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    private static func parse(_ text: String, maximum: Double) -> Double? {
        let value = Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
        guard let value, value > 0, value <= maximum else { return nil }
        return value
    }

    private var edited: JarvisHealthGoals? {
        guard let sleep = Self.parse(sleep, maximum: 24),
              let kcal = Self.parse(kcal, maximum: 20_000),
              let carbs = Self.parse(carbs, maximum: 2_000),
              let fat = Self.parse(fat, maximum: 2_000) else { return nil }
        var goals = original
        goals.sleepHours = sleep
        goals.kcal = kcal
        goals.carbsGrams = carbs
        goals.fatGrams = fat
        return goals
    }

    var body: some View {
        JarvisForm {
            field(.sleepGoal, text: $sleep, id: "health.goal.sleep")
            field(.goalKcal, text: $kcal, id: "health.goal.kcal")
            field(.goalCarbs, text: $carbs, id: "health.goal.carbs")
            field(.goalFat, text: $fat, id: "health.goal.fat")
        }
        .navigationTitle(copy(.healthGoalsRow))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            original = JarvisHealthGoals.load()
            sleep = Self.text(original.sleepHours)
            kcal = Self.text(original.kcal)
            carbs = Self.text(original.carbsGrams)
            fat = Self.text(original.fatGrams)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSheetConfirmButton(
                    title: copy(.save),
                    isDisabled: edited == nil || edited == original
                ) {
                    edited?.save()
                    dismiss()
                }
            }
            .sharedBackgroundVisibility(.hidden)
        }
    }

    private func field(_ title: JarvisSettingsLocalizationKey, text: Binding<String>, id: String) -> some View {
        HStack {
            Text(copy(title))
            Spacer(minLength: 0)
            TextField(copy(title), text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 100)
                .accessibilityIdentifier(id)
        }
    }

    private static func text(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}
