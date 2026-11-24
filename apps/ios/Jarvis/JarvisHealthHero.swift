import Charts
import Foundation
import JarvisCore
import SwiftUI

struct JarvisManualMealSheet: View {
    @Environment(\.dismiss) private var dismiss
    let client: JarvisHealthClient
    @Binding var pending: JarvisManualMeal?
    let onSaved: (JarvisManualMeal) async -> Void
    @State private var amount = ""
    @State private var protein = ""
    @State private var saving = false
    @State private var saveError: String?
    @FocusState private var focused: Bool

    private var kcal: Double? {
        guard let value = Double(amount.replacingOccurrences(of: ",", with: ".")),
              value.isFinite, value > 0, value <= 10_000 else { return nil }
        return value
    }

    private var proteinGrams: Double? {
        guard let value = Double(protein.replacingOccurrences(of: ",", with: ".")),
              (0...1000).contains(value) else { return nil }
        return value
    }

    private var invalidProtein: Bool { !protein.isEmpty && proteinGrams == nil }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section {
                    LabeledContent("Energy (kcal)") {
                        TextField("kcal", text: $amount)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .focused($focused)
                            .disabled(saving || pending != nil)
                            .accessibilityLabel("Meal energy in kcal")
                            .accessibilityIdentifier("health.nutrition.amount")
                    }
                    LabeledContent("Protein (g)") {
                        TextField("Optional", text: $protein)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .disabled(saving || pending != nil)
                            .accessibilityLabel("Meal protein in grams, optional")
                            .accessibilityIdentifier("health.nutrition.protein")
                    }
                } footer: {
                    if let saveError {
                        Text(saveError)
                    } else if pending != nil && !saving {
                        Text("Retry to check the previous save.")
                    } else if !amount.isEmpty && kcal == nil {
                        Text("Enter more than 0 and at most 10,000 kcal.")
                    } else if invalidProtein {
                        Text("Enter 0 to 1,000 g of protein or leave it blank.")
                    }
                }
            }
            .navigationTitle("Log today’s meal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(confirmTitle: pending != nil && !saving ? "Retry" : "Save",
                    closeTitle: "Close", isWorking: saving, isConfirmDisabled: pending == nil && (kcal == nil || invalidProtein),
                    onConfirm: { Task { await save() } }, onClose: { dismiss() })
            }
            .jarvisAmbientBackground(transparentNavigationBar: true)
            .onAppear {
                if let pending {
                    amount = pending.energyKcal.formatted(.number.grouping(.never))
                    protein = pending.proteinGrams?.formatted(.number.grouping(.never)) ?? ""
                } else { focused = true }
            }
        }
        .interactiveDismissDisabled(saving)
    }

    private func save() async {
        guard !saving else { return }
        let submission: JarvisManualMeal
        if let pending {
            submission = pending
        } else if let kcal, !invalidProtein {
            submission = JarvisManualMeal(energyKcal: kcal, proteinGrams: proteinGrams)
        } else {
            return
        }
        pending = submission
        saving = true
        saveError = nil
        defer { saving = false }
        do {
            try await client.saveManualMeal(submission)
            pending = nil
            dismiss()
            await onSaved(submission)
        } catch JarvisClientError.httpStatus(400) {
            pending = nil
            saveError = "Check the meal values and device time, then save again."
        } catch JarvisClientError.httpStatus(409) {
            pending = nil
            amount = ""
            protein = ""
            saveError = "This meal has already changed. Check Meals before adding another."
        } catch {
            saveError = "Save could not be confirmed. Retry to check this same meal."
        }
    }
}

struct JarvisHealthHeroStat: View {
    let value: String
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
            Text(value).font(.title2.weight(.semibold))
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The one Health bar chart: headline (average or the tapped day), target chip, dashed target line,
/// weekday labels, bars that grow from the baseline, tap a bar to show that day and tap it again to return.
struct JarvisHealthBarChart: View {
    let values: JarvisHealthChartValues
    let unit: String
    let title: String
    let identifier: String
    let language: JarvisAppLanguage
    var state: JarvisHealthReadState = .available
    let format: (Double) -> String

    @State private var selected: String?
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    private var yMax: Double {
        let top = max(values.days.compactMap(\.value).max() ?? 0, values.target ?? 0)
        return top > 0 ? top * 1.15 : 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
            HStack(alignment: .top) {
                (
                    Text(values.headline(selected: selected).map(format) ?? "—")
                        .font(.headline)
                    + Text(" \(unit) · \(caption)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                )
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.numericText())
                Spacer(minLength: 0)
                if let target = values.target {
                    Text("\(copy.text(.targetLabel)) \(format(target))")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(JarvisDesignTokens.healthAccent)
                        .padding(.horizontal, JarvisDesignTokens.healthMenuSpacing + 2)
                        .padding(.vertical, 4)
                        .background(JarvisDesignTokens.healthAccent.opacity(0.15), in: Capsule())
                        .accessibilityLabel("\(copy.text(.targetLabel)) \(format(target)) \(unit)")
                        .accessibilityIdentifier("\(identifier).target")
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("\(identifier).headline")
            if values.hasData {
                chart
            } else if state != .available && state != .empty {
                JarvisHealthStateLine(state: state, language: language)
                    .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.healthChartHeight)
            } else {
                Text(copy.text(.empty))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.healthChartHeight)
                    .accessibilityIdentifier("\(identifier).empty")
            }
        }
        .accessibilityIdentifier(identifier)
        .onAppear { grown = true }
        .onChange(of: values.days.map(\.date)) { selected = nil }
    }

    private var caption: String {
        if let selected, !values.isShowingAverage(selected: selected) {
            return JarvisHealthLocalization.formattedDate(selected, language: language)
        }
        return copy.text(.average)
    }

    private var axisDates: [String] {
        let dates = values.days.map(\.date)
        guard dates.count > 7 else { return dates }
        return (0...4).map { dates[Int((Double(dates.count - 1) * Double($0) / 4).rounded())] }
    }

    private func axisLabelAnchor(_ date: String) -> UnitPoint? {
        guard values.days.count > 7 else { return nil }
        if date == values.days.first?.date { return .topLeading }
        if date == values.days.last?.date { return .topTrailing }
        return .top
    }

    private var chart: some View {
        Chart {
            ForEach(values.days) { day in
                if let value = day.value {
                    BarMark(
                        x: .value(copy.text(.date), day.date),
                        y: .value(title, grown ? value : 0)
                    )
                    .cornerRadius(JarvisDesignTokens.healthBarRadius)
                    .foregroundStyle(
                        selected == day.date ? JarvisDesignTokens.healthAccent : Color.secondary
                    )
                }
            }
            if let target = values.target {
                RuleMark(y: .value(copy.text(.targetLabel), target))
                    .lineStyle(StrokeStyle(
                        lineWidth: JarvisDesignTokens.healthTargetLineWidth,
                        dash: JarvisDesignTokens.healthTargetLineDash
                    ))
                    .foregroundStyle(JarvisDesignTokens.healthAccent)
            }
        }
        .chartYScale(domain: 0...yMax)
        .chartXScale(domain: values.days.map(\.date))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: axisDates) { value in
                if let date = value.as(String.self) {
                    AxisValueLabel(
                        centered: values.days.count > 7 ? false : nil,
                        anchor: axisLabelAnchor(date)
                    ) {
                        Text(weekday(date))
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(.clear)
                    .contentShape(Rectangle())
                    .onTapGesture(coordinateSpace: .local) { location in
                        guard let frame = proxy.plotFrame else { return }
                        let x = location.x - geometry[frame].origin.x
                        guard let date: String = proxy.value(atX: x),
                              values.days.first(where: { $0.date == date })?.value != nil else { return }
                        selected = JarvisHealthChartValues.toggled(selected: selected, tapped: date)
                    }
            }
        }
        .frame(height: JarvisDesignTokens.healthChartHeight)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.6), value: grown)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: selected)
        .accessibilityLabel(title)
        .accessibilityValue(summary)
    }

    private func weekday(_ date: String) -> String {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.calendar = Calendar(identifier: .gregorian)
        input.timeZone = TimeZone(secondsFromGMT: 0)
        input.dateFormat = "yyyy-MM-dd"
        guard let parsed = input.date(from: date) else { return date }
        let output = DateFormatter()
        output.locale = language.locale
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.dateFormat = values.days.count > 7 ? "d MMM" : "EEE"
        return output.string(from: parsed)
    }

    private var summary: String {
        let days = values.days.compactMap { day in
            day.value.map { "\(weekday(day.date)) \(format($0)) \(unit)" }
        }
        return days.joined(separator: ", ")
    }
}

/// Hours with one decimal ("7,5"), because compact numbers drop decimals below ten.
func formatHours(_ value: Double, language: JarvisAppLanguage) -> String {
    let formatter = NumberFormatter()
    formatter.locale = language.locale
    formatter.numberStyle = .decimal
    formatter.usesGroupingSeparator = false
    formatter.maximumFractionDigits = 1
    formatter.roundingMode = .halfUp
    return formatter.string(from: NSNumber(value: value)) ?? formatNumber(value, language: language)
}
