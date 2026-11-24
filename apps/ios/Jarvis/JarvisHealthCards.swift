import AVFoundation
import Charts
import JarvisCore
import SwiftUI
import UIKit

struct JarvisHealthCards<Lifts: View>: View {
    let data: JarvisHealthDashboardData
    let goals: JarvisHealthGoals
    let language: JarvisAppLanguage
    let client: JarvisHealthClient?
    let steps: JarvisStepsSnapshot?
    let stages: [JarvisHealthSleepSegment]
    let onPhoto: ((Data) -> Void)?
    let onMealSaved: () async -> Void
    @ViewBuilder let lifts: () -> Lifts
    @State private var training = JarvisHealthPeriodPreset.sevenDays
    @State private var stepRange = JarvisHealthPeriodPreset.today
    @State private var sleep = JarvisHealthPeriodPreset.today
    @State private var nutrition = JarvisHealthPeriodPreset.today
    @State private var selectedDay: String?
    @State private var showingMeal = false
    @State private var pendingMeal: JarvisManualMeal?
    @State private var showingCamera = false
    @State private var captured: Data?
    @State private var captureError: String?
    @State private var mealReceipt: JarvisManualMeal?

    @Environment(\.dynamicTypeSize) private var typeSize
    private let accent = JarvisDesignTokens.healthAccent
    private let secondary = JarvisDesignTokens.healthAccentSecondary
    private func period(_ value: JarvisHealthPeriodPreset) -> JarvisHealthPeriod {
        .make(value, now: data.activityNow)
    }
    private func range(_ value: Binding<JarvisHealthPeriodPreset>, _ key: String) -> some View {
        JarvisPeriodSelector(title: "Period", identifierPrefix: "health.\(key).period",
            items: JarvisHealthPeriodPreset.dashboardPresets.map {
                JarvisTabItem(tag: $0, title: $0 == .today ? "Today" : "\($0.dayCount)d", identifier: "health.\(key).\($0.rawValue)")
            }, selection: value)
    }
    private func number(_ value: Double?) -> String {
        value?.formatted(.number.locale(language.locale).precision(.fractionLength(0))) ?? "—"
    }
    private func duration(_ hours: Double?) -> String {
        guard let hours else { return "—" }
        let mins = Int((hours * 60).rounded())
        if mins < 60 { return "\(mins)m" }
        if mins.isMultiple(of: 60) { return "\(mins / 60)h" }
        return "\(mins / 60)h \(mins % 60)m"
    }

    var body: some View {
        VStack(spacing: 12) {
            JarvisPageHeroCard(title: "Training", accessory: { range($training, "training") }) {
                trainingSummary
                Divider()
                lifts()
            }.environment(\.jarvisCardRole, "training").accessibilityIdentifier("health.hero.training")
            JarvisPageHeroCard(title: stepRange == .today ? "Steps today" : "Steps", accessory: { range($stepRange, "steps") }) {
                stepSummary
            }.environment(\.jarvisCardRole, "steps")
            JarvisPageHeroCard(title: "Sleep", accessory: { range($sleep, "sleep") }) {
                sleepSummary
            }.environment(\.jarvisCardRole, "sleep").accessibilityIdentifier("health.hero.sleep").id("sleep")
            JarvisPageHeroCard(title: "Nutrition", accessory: { range($nutrition, "nutrition") }) {
                nutritionSummary
                let mealLayout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 12))
                mealLayout {
                    JarvisLabelledButton(title: "Log meal", systemImage: "plus", identifier: "health.nutrition.add",
                        isDisabled: client == nil) { showingMeal = true }
                    JarvisLabelledButton(title: "Scan meal", systemImage: "camera", isDisabled: onPhoto == nil) {
                        Task { await openCamera() }
                    }
                }.frame(maxWidth: .infinity).padding(.top, 4)
                if let captureError { Text(captureError).font(.footnote) }
                if let mealReceipt { Text("\(number(mealReceipt.energyKcal)) kcal logged").font(.footnote).accessibilityIdentifier("health.nutrition.saved") }
            }.environment(\.jarvisCardRole, "nutrition").accessibilityIdentifier("health.hero.nutrition").id("nutrition")
        }
        .onChange(of: training) { _, _ in selectedDay = nil }
        .sheet(isPresented: $showingMeal) {
            if let client {
                JarvisManualMealSheet(client: client, pending: $pendingMeal) { meal in
                    mealReceipt = meal
                    await onMealSaved()
                }.presentationDetents([.medium, .large])
            }
        }
        .fullScreenCover(isPresented: $showingCamera, onDismiss: {
            if let captured { onPhoto?(captured); self.captured = nil }
        }) {
            JarvisMealCamera { photo in
                captured = photo
                showingCamera = false
            } failed: {
                captureError = "The photo could not be attached. Try taking it again."
                showingCamera = false
            }.ignoresSafeArea()
        }
    }

    private func day(_ row: [String: JSONValue]) -> String? {
        JarvisHealthLogic.day(row["workout_date"]?.stringValue ?? row["start_at"]?.stringValue)
    }
    private func name(_ row: [String: JSONValue]) -> String {
        row["session"]?.stringValue ?? row["workout_type"]?.stringValue ?? "Workout"
    }
    private func metric(_ row: [String: JSONValue], energy: Bool) -> Double? {
        if !energy { return row["duration_seconds"]?.numberValue.map { $0 / 60 } }
        guard let value = row["active_energy_value"]?.numberValue else { return nil }
        switch row["active_energy_unit"]?.stringValue?.lowercased() {
        case "kcal", "kilocalories": return value
        case "kj": return value / 4.184
        case "j": return value / 4184
        default: return nil
        }
    }
    private func sum(_ rows: [[String: JSONValue]], energy: Bool) -> Double? {
        let values = rows.compactMap { metric($0, energy: energy) }
        return values.isEmpty && !rows.isEmpty ? nil : values.reduce(0, +)
    }

    private var trainingSummary: some View {
        let window = period(training)
        let rows = data.workouts.items.filter { row in day(row).map { (window.startDate...window.endDate).contains($0) } ?? false }
        let workouts = rows.filter { JarvisHealthLogic.workoutKind($0["workout_type"]?.stringValue) != .other }
        let readable = data.workouts.state == .available || data.workouts.state == .empty
        let targets = data.trainingTargets?.targets
        let weekly = targets.flatMap { t in
            t.gymSessionsPerWeek.flatMap { gym in t.runSessionsPerWeek.map { gym + $0 } }
        }
        let goal = JarvisHealthLogic.sessionTarget(weekly, days: window.dayCount)
        let counts = "\(readable ? String(workouts.count) : "—") / \(number(goal))"
        let grouped = Dictionary(grouping: workouts) { day($0) ?? "" }
        let days = JarvisHealthChartValues(values: [:], endingOn: window.endDate, count: window.dayCount, target: nil).days
        return VStack(alignment: .leading, spacing: 12) {
            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout(alignment: .top, spacing: 8))
            layout { trainingMetrics(counts, workouts, readable) }
            Divider()
            if readable {
                let walks = rows.filter {
                    ["walk", "walking", "52", "healthkit52"].contains(JarvisHealthLogic.normalizedWorkoutType($0["workout_type"]?.stringValue))
                }.count
                HStack {
                    Text(rows.count == 1 ? "1 workout total" : "\(rows.count) workouts total")
                    Spacer()
                    if walks > 0 { Text(walks == 1 ? "Includes 1 walk" : "Includes \(walks) walks") }
                }.font(.footnote).foregroundStyle(.secondary)
                HStack {
                    Text("Training minutes").font(.subheadline.weight(.semibold))
                    Spacer()
                    ForEach(["Gym", "Run"], id: \.self) { kind in
                        HStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 2).fill(kind == "Gym" ? accent : secondary).frame(width: 7, height: 7)
                            Text(kind).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                Chart {
                    ForEach(days) { item in
                        ForEach(["Gym", "Run"], id: \.self) { kind in
                            let matching = (grouped[item.date] ?? []).filter { (JarvisHealthLogic.workoutKind($0["workout_type"]?.stringValue) == .gym) == (kind == "Gym") }
                            if let minutes = sum(matching, energy: false) {
                                BarMark(x: .value("Day", item.date), y: .value("Minutes", minutes))
                                    .foregroundStyle(by: .value("Type", kind))
                                    .opacity(selectedDay == nil || selectedDay == item.date ? 1 : 0.45)
                            }
                        }
                        if days.count <= 7, let minutes = sum(grouped[item.date] ?? [], energy: false), minutes > 0 {
                            PointMark(x: .value("Day", item.date), y: .value("Minutes", minutes))
                                .symbolSize(0).annotation(position: .top, spacing: 2) {
                                    Text(number(minutes)).font(.caption2.weight(.medium))
                                }
                        }
                    }
                }
                .chartLegend(.hidden)
                .chartXScale(domain: days.map(\.date))
                .chartForegroundStyleScale(["Gym": accent, "Run": secondary])
                .chartXAxis { AxisMarks(values: stride(from: 0, to: days.count, by: max(1, (days.count + 6) / 7)).map { days[$0].date }) { value in
                    if let key = value.as(String.self) { AxisValueLabel(JarvisHealthBarChart.dayLabel(key, language: language, dense: days.count > 7)) }
                } }
                .chartXSelection(value: $selectedDay)
                .frame(height: 128)
                if let selectedDay {
                    Text(selectedDay).font(.caption).foregroundStyle(.secondary)
                    let chosen = rows.filter { day($0) == selectedDay }
                    if chosen.isEmpty { Text("No workouts recorded").font(.footnote) }
                    ForEach(Array(chosen.enumerated()), id: \.offset) { _, row in
                        LabeledContent(name(row), value: "\(number(metric(row, energy: false))) min")
                    }
                }
            } else {
                JarvisHealthStateLine(state: data.workouts.state, language: language)
            }
        }
    }

    @ViewBuilder private func trainingMetrics(_ counts: String, _ rows: [[String: JSONValue]], _ readable: Bool) -> some View {
        JarvisHealthHeroStat(value: counts, title: counts.replacingOccurrences(of: " / ", with: " of ") + " workouts completed", tint: accent)
        JarvisHealthHeroStat(value: recordedTotal(rows, energy: false, readable: readable), title: "Workout minutes")
        JarvisHealthHeroStat(value: recordedTotal(rows, energy: true, readable: readable), title: "Active kcal burned", tint: secondary)
    }

    private func recordedTotal(_ rows: [[String: JSONValue]], energy: Bool, readable: Bool) -> String {
        guard readable, let total = sum(rows, energy: energy) else { return "—" }
        let partial = rows.contains { metric($0, energy: energy) == nil }
        return (partial ? "≥ " : "") + number(total)
    }

    private var stepSummary: some View {
        let window = period(stepRange)
        var values: [String: Double] = [:]
        for row in data.steps.items {
            if let day = JarvisHealthLogic.day(row["metric_date"]?.stringValue), let value = row["value"]?.numberValue { values[day] = value }
        }
        let series = JarvisHealthChartValues(values: values, endingOn: window.endDate, count: window.dayCount, target: data.trainingTargets?.targets.dailySteps)
        return VStack(alignment: .leading, spacing: 8) {
            Text(number(stepRange == .today ? values[window.endDate] : series.average) + (stepRange == .today ? " steps" : " steps/day"))
                .font(.title2.bold()).foregroundStyle(accent)
            if stepRange == .today {
                if let steps, values[window.endDate] != nil {
                    let hour = JarvisHealthSyncWindow.calendar.component(.hour, from: data.activityNow)
                    Chart {
                        ForEach(0...hour, id: \.self) { index in
                            LineMark(x: .value("Hour", index), y: .value("Steps", steps.hourly.prefix(index + 1).reduce(0,+)), series: .value("Series", "Today"))
                                .foregroundStyle(accent)
                        }
                        if let usual = steps.typicalCumulative {
                            ForEach(0..<24, id: \.self) { index in
                                LineMark(x: .value("Hour", index), y: .value("Steps", usual[index]), series: .value("Series", "Usual"))
                                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4,3])).foregroundStyle(secondary)
                            }
                        }
                    }.chartXScale(domain: 0...24).frame(height: 92)
                    if let usual = steps.typicalCumulative {
                        Text("Usually \(number(usual[hour])) by the end of this hour").font(.caption).foregroundStyle(.secondary)
                    }
                } else { Text("Hourly steps unavailable").font(.footnote).foregroundStyle(.secondary) }
            } else { bars(series, unit: "steps", title: "Daily steps", id: "health.chart.steps", state: data.steps.state) }
        }
    }

    private var sleepSummary: some View {
        let window = period(sleep)
        let measured = JarvisSleepTimeline(segments: stages)
        var items = data.sleep.items
        if let night = measured.dailyRow(date: period(.today).endDate) {
            let date = period(.today).endDate
            if sleep == .today || JarvisHealthSleepNight.nights(from: items)[date]?.total == nil {
                items.removeAll { $0["sleep_date"]?.stringValue.map { String($0.prefix(10)) } == date }
                items.append(night)
            }
        }
        let average = JarvisHealthSleepSummary(items: items, period: window)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading) {
                    Text(duration(average.total)).font(.title.bold()).foregroundStyle(accent)
                    Text(sleep == .today ? "Asleep last night" : "Average sleep").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(duration(goals.sleepHours)) goal").font(.footnote)
            }
            if sleep == .today {
                if measured.segments.isEmpty { Text("Sleep stage timeline unavailable").font(.footnote).foregroundStyle(.secondary) }
                else { JarvisNightChart(timeline: measured) }
                Divider()
                HStack {
                    ForEach(Array(zip(["Awake", "REM", "Core", "Deep"], [average.awake, average.rem, average.light, average.deep])), id: \.0) { label, hours in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(label).font(.caption).foregroundStyle(.secondary)
                            Text(duration(hours)).font(.footnote.bold())
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else {
                let values = JarvisHealthSleepNight.nights(from: items).compactMapValues(\.total)
                JarvisHealthBarChart(values: .init(values: values, endingOn: window.endDate, count: window.dayCount, target: goals.sleepHours),
                    unit: "", title: "Sleep by night", identifier: "health.chart.sleep", language: language, state: data.sleep.state,
                    showSummary: false, barColor: secondary, format: { duration($0) })
                Text("\(average.nightCount) of \(window.dayCount) nights recorded").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var nutritionSummary: some View {
        let window = period(nutrition)
        let recorded = JarvisHealthNutritionSummary(items: data.nutritionDays.items, period: window)
        let today = nutrition == .today
        let budget = data.todayBudget?.kcal
        let amount = today ? budget?.eatenKcal : recorded.average(.kcal)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading) {
                    Text("\(number(amount)) kcal").font(.title2.bold()).foregroundStyle(accent)
                    Text(today ? "Food logged today" : "Average per logged day").font(.caption)
                }
                Spacer()
                if today, let remaining = budget?.remainingKcal {
                    Text("\(number(abs(remaining))) kcal \(remaining >= 0 ? "left" : "over")")
                }
            }
            if today {
                if let amount, let allowance = budget?.allowanceKcal, allowance > 0 {
                    ProgressView(value: min(allowance, amount), total: allowance).tint(accent)
                }
                HStack {
                    if data.nutritionDays.state == .available || data.nutritionDays.state == .empty {
                        Text("\(recorded.mealCount) meals logged")
                    }
                    Spacer()
                    Text("Intake target \(number(budget?.allowanceKcal)) kcal")
                }.font(.caption).foregroundStyle(.secondary)
                let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout(alignment: .top))
                layout {
                    budgetValue("Resting target", budget?.restingKcal)
                    budgetValue("Active kcal", budget?.activeKcal)
                    budgetValue("Planned deficit", budget?.deficitKcal.map { -$0 })
                }
            } else {
                bars(.init(values: JarvisHealthNutritionDays.values(from: data.nutritionDays.items, nutrient: .kcal), endingOn: window.endDate, count: window.dayCount, target: nil),
                     unit: "kcal", title: "Daily intake", id: "health.chart.nutrition", state: data.nutritionDays.state)
            }
            Divider()
            macro("Protein", recorded.average(.protein), data.nutritionTargets?.targets.proteinGrams ?? goals.proteinGrams, accent)
            macro("Carbs", recorded.average(.carbs), goals.carbsGrams, secondary)
            macro("Fat", recorded.average(.fat), goals.fatGrams, .secondary)
        }.font(.subheadline)
    }

    private func budgetValue(_ title: String, _ kcal: Double?) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(kcal.map { number($0) + " kcal" } ?? "—").font(.footnote.weight(.semibold))
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func macro(_ title: String, _ value: Double?, _ target: Double, _ tint: Color) -> some View {
        HStack {
            Text(title).frame(width: 54, alignment: .leading)
            if let value, target > 0 { ProgressView(value: min(value, target), total: target).tint(tint) }
            Spacer(minLength: 4)
            Text("\(number(value)) / \(number(target)) g").font(.caption.monospacedDigit())
        }
    }

    private func bars(_ values: JarvisHealthChartValues, unit: String, title: String, id: String, state: JarvisHealthReadState) -> some View {
        JarvisHealthBarChart(values: values, unit: unit, title: title, identifier: id, language: language, state: state, format: number)
    }

    @MainActor private func openCamera() async {
        captureError = nil
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { captureError = "Camera unavailable on this device."; return }
        guard await AVCaptureDevice.requestAccess(for: .video) else { captureError = "Allow camera access in Settings to scan a meal."; return }
        showingCamera = true
    }
}

private struct JarvisMealCamera: UIViewControllerRepresentable {
    let captured: (Data?) -> Void
    let failed: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let camera = UIImagePickerController()
        camera.sourceType = .camera
        camera.delegate = context.coordinator
        return camera
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: JarvisMealCamera
        init(parent: JarvisMealCamera) { self.parent = parent }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.captured(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let image = info[.originalImage] as? UIImage, let bytes = image.jpegData(compressionQuality: 0.78) else {
                parent.failed(); return
            }
            parent.captured(bytes)
        }
    }
}

/// Four fixed lanes keep brief awakenings visible even when the night spans many hours.
private struct JarvisNightChart: View {
    let timeline: JarvisSleepTimeline
    private let stages = ["Awake", "REM", "Core", "Deep"]

    var body: some View {
        if let first = timeline.segments.first, let last = timeline.segments.last {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(stages, id: \.self) { Text($0).font(.caption2).frame(height: 20) }
                }.foregroundStyle(.secondary)
                VStack(spacing: 4) {
                    Canvas { context, size in
                        for index in stages.indices {
                            let y = CGFloat(index) * 20 + 10
                            var guide = Path()
                            guide.move(to: CGPoint(x: 0, y: y))
                            guide.addLine(to: CGPoint(x: size.width, y: y))
                            context.stroke(guide, with: .color(.secondary.opacity(0.25)), lineWidth: 0.6)
                        }
                        let scale = size.width / CGFloat(last.end.timeIntervalSince(first.start))
                        let secondary = JarvisDesignTokens.secondaryAccent
                        let colors = [JarvisDesignTokens.primaryAccent, secondary, secondary.opacity(0.78), Color.indigo]
                        var previous: (end: Date, y: CGFloat)?
                        for segment in timeline.segments {
                            guard let lane = stages.firstIndex(where: { $0.lowercased() == segment.stage }) else { continue }
                            let x = CGFloat(segment.start.timeIntervalSince(first.start)) * scale
                            let width = CGFloat(segment.end.timeIntervalSince(segment.start)) * scale
                            let y = CGFloat(lane) * 20 + 10
                            if let previous, previous.end == segment.start {
                                var connector = Path()
                                connector.move(to: .init(x: x, y: previous.y))
                                connector.addLine(to: .init(x: x, y: y))
                                context.stroke(connector, with: .color(secondary.opacity(0.55)), lineWidth: 1)
                            }
                            let rect = CGRect(x: x, y: y - 5, width: max(1, width), height: 10)
                            context.fill(Path(roundedRect: rect, cornerRadius: min(2, width / 2)), with: .color(colors[lane]))
                            previous = (segment.end, y)
                        }
                    }.frame(height: 80)
                    HStack {
                        Text(first.start, style: .time)
                        Spacer()
                        Text(last.end, style: .time)
                    }.font(.caption2).foregroundStyle(.secondary)
                }
            }.accessibilityElement(children: .combine)
            .accessibilityLabel("Sleep stages from \(first.start.formatted(date: .omitted, time: .shortened)) to \(last.end.formatted(date: .omitted, time: .shortened))")
        }
    }
}
