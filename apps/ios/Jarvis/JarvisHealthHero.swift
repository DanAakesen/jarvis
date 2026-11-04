import Charts
import Foundation
import JarvisCore
import SwiftUI

/// The three swipeable hero cards under the Health headline: Training, Sleep, Nutrition.
/// HIG: Page controls, Charts, Layout, Accessibility. API: TabView, Chart, BarMark, RuleMark.
enum JarvisHealthHeroPage: Int, CaseIterable, Identifiable {
    case training
    case sleep
    case nutrition

    var id: Int { rawValue }
    var identifier: String {
        switch self {
        case .training: "health.hero.training"
        case .sleep: "health.hero.sleep"
        case .nutrition: "health.hero.nutrition"
        }
    }
}

struct JarvisHealthHeroCarousel<Accessory: View>: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let goals: JarvisHealthGoals
    let language: JarvisAppLanguage
    let accessory: Accessory

    @State private var page: JarvisHealthHeroPage = .training

    init(
        data: JarvisHealthDashboardData,
        period: JarvisHealthPeriod,
        goals: JarvisHealthGoals,
        language: JarvisAppLanguage,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.data = data
        self.period = period
        self.goals = goals
        self.language = language
        self.accessory = accessory()
    }

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
            TabView(selection: $page) {
                JarvisHealthRingsSection(data: data, period: period, language: language) { accessory }
                    .fillingHeight()
                    .tag(JarvisHealthHeroPage.training)
                    .accessibilityIdentifier(JarvisHealthHeroPage.training.identifier)
                JarvisHealthSleepHero(data: data, period: period, goals: goals, language: language)
                    .tag(JarvisHealthHeroPage.sleep)
                    .accessibilityIdentifier(JarvisHealthHeroPage.sleep.identifier)
                JarvisHealthNutritionHero(data: data, period: period, goals: goals, language: language)
                    .tag(JarvisHealthHeroPage.nutrition)
                    .accessibilityIdentifier(JarvisHealthHeroPage.nutrition.identifier)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: JarvisDesignTokens.healthHeroHeight)
            HStack(spacing: JarvisDesignTokens.healthMenuSpacing) {
                ForEach(JarvisHealthHeroPage.allCases) { item in
                    Circle()
                        .fill(item == page ? JarvisDesignTokens.healthAccent : Color.secondary.opacity(0.35))
                        .frame(width: 7, height: 7)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(copy.text(.heroPages))
            .accessibilityValue("\(page.rawValue + 1) / \(JarvisHealthHeroPage.allCases.count)")
            .accessibilityIdentifier("health.hero.dots")
        }
        .animation(.easeInOut(duration: 0.2), value: page)
    }
}

struct JarvisHealthSleepHero: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let goals: JarvisHealthGoals
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    private var nights: [String: JarvisHealthSleepNight] {
        JarvisHealthSleepNight.nights(from: data.sleep.items)
    }

    private var latest: JarvisHealthSleepNight? {
        nights.values
            .filter { $0.date <= period.endDate && $0.total != nil }
            .max { $0.date < $1.date }
    }

    private var chartValues: JarvisHealthChartValues {
        JarvisHealthChartValues(
            values: nights.compactMapValues(\.total),
            endingOn: period.endDate,
            count: 7,
            target: goals.sleepHours
        )
    }

    var body: some View {
        JarvisPageHeroCard(title: copy.text(.sleep)) {
            if data.sleep.state == .loading || data.sleep.state == .notServed ||
                data.sleep.state == .failed || data.sleep.state == .offline {
                JarvisHealthStateLine(state: data.sleep.state, language: language)
            } else {
                content
            }
        }
        .fillingHeight()
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthSectionSpacing) {
            HStack(spacing: JarvisDesignTokens.healthSectionSpacing) {
                JarvisHealthHeroRing(
                    progress: JarvisHealthLogic.ringProgress(value: latest?.total, target: goals.sleepHours),
                    text: latest?.total.map { formatHours($0, language: language) } ?? "—",
                    unit: copy.text(.hourShort),
                    tint: JarvisDesignTokens.healthAccent
                )
                VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                    stageRow(.deepSleep, latest?.deep)
                    stageRow(.remSleep, latest?.rem)
                    stageRow(.lightSleep, latest?.light)
                    stageRow(.awake, latest?.awake)
                }
            }
            JarvisHealthBarChart(
                values: chartValues,
                unit: copy.text(.hourShort),
                title: copy.text(.sleepChart),
                identifier: "health.chart.sleep",
                language: language,
                format: { formatHours($0, language: language) }
            )
        }
    }

    private func stageRow(_ key: JarvisHealthLocalizationKey, _ hours: Double?) -> some View {
        HStack {
            Text(copy.text(key))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text(hours.map { "\(formatHours($0, language: language)) \(copy.text(.hourShort))" } ?? "—")
                .font(.subheadline.weight(.medium))
        }
        .accessibilityElement(children: .combine)
    }
}

struct JarvisHealthNutritionHero: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let goals: JarvisHealthGoals
    let language: JarvisAppLanguage

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    private func values(_ nutrient: JarvisHealthNutrient) -> [String: Double] {
        JarvisHealthNutritionDays.values(from: data.nutritionDays.items, nutrient: nutrient)
    }

    private var proteinTarget: Double {
        data.nutritionTargets?.targets.proteinGrams ?? goals.proteinGrams
    }

    var body: some View {
        JarvisPageHeroCard(title: copy.text(.nutrition)) {
            if data.nutritionDays.state == .loading || data.nutritionDays.state == .notServed ||
                data.nutritionDays.state == .failed || data.nutritionDays.state == .offline {
                JarvisHealthStateLine(state: data.nutritionDays.state, language: language)
            } else {
                content
            }
        }
        .fillingHeight()
    }

    private var content: some View {
        let day = period.endDate
        let kcal = values(.kcal)[day]
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.healthSectionSpacing) {
            HStack(spacing: JarvisDesignTokens.healthSectionSpacing) {
                JarvisHealthHeroRing(
                    progress: JarvisHealthLogic.ringProgress(value: kcal, target: goals.kcal),
                    text: kcal.map { formatNumber($0, language: language) } ?? "—",
                    unit: "kcal",
                    tint: JarvisDesignTokens.healthAccent
                )
                VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                    macroRow(.protein, values(.protein)[day], proteinTarget)
                    macroRow(.carbs, values(.carbs)[day], goals.carbsGrams)
                    macroRow(.fat, values(.fat)[day], goals.fatGrams)
                    HStack {
                        Text(copy.text(.kcalEaten))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        Text("\(kcal.map { formatNumber($0, language: language) } ?? "—") / \(formatNumber(goals.kcal, language: language)) kcal")
                            .font(.subheadline.weight(.medium))
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            JarvisHealthBarChart(
                values: JarvisHealthChartValues(
                    values: values(.protein), endingOn: period.endDate, count: 7, target: proteinTarget
                ),
                unit: "g",
                title: copy.text(.proteinChart),
                identifier: "health.chart.protein",
                language: language,
                format: { formatNumber($0, language: language) }
            )
        }
    }

    private func macroRow(_ key: JarvisHealthLocalizationKey, _ value: Double?, _ target: Double) -> some View {
        HStack {
            Text(copy.text(key))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text("\(value.map { formatNumber($0, language: language) } ?? "—") / \(formatNumber(target, language: language)) g")
                .font(.subheadline.weight(.medium))
        }
        .accessibilityElement(children: .combine)
    }
}

struct JarvisHealthHeroRing: View {
    let progress: Double?
    let text: String
    let unit: String
    let tint: Color

    var body: some View {
        ZStack {
            Circle()
                .stroke(.quaternary, lineWidth: JarvisDesignTokens.healthRingStroke)
            if let progress {
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(
                        tint,
                        style: StrokeStyle(lineWidth: JarvisDesignTokens.healthRingStroke, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
            }
            VStack(spacing: 0) {
                Text(text)
                    .font(.title3.weight(.semibold))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(unit)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(JarvisDesignTokens.healthMenuSpacing)
        }
        .frame(width: JarvisDesignTokens.healthHeroRingSize, height: JarvisDesignTokens.healthHeroRingSize)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(unit)
        .accessibilityValue(text)
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
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(values.headline(selected: selected).map(format) ?? "—")
                            .font(.title2.weight(.semibold))
                            .contentTransition(.numericText())
                        Text(unit)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Text(caption)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if let target = values.target {
                    Text("\(copy.text(.targetLabel)) \(format(target)) \(unit)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(JarvisDesignTokens.healthAccent)
                        .padding(.horizontal, JarvisDesignTokens.healthMenuSpacing + 2)
                        .padding(.vertical, 4)
                        .background(JarvisDesignTokens.healthAccent.opacity(0.15), in: Capsule())
                        .accessibilityIdentifier("\(identifier).target")
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("\(identifier).headline")
            if values.hasData {
                chart
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
    }

    private var caption: String {
        if let selected, !values.isShowingAverage(selected: selected) {
            return JarvisHealthLocalization.formattedDate(selected, language: language)
        }
        return copy.text(.average)
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
                        JarvisDesignTokens.healthAccent.opacity(
                            selected == nil || selected == day.date ? 1 : 0.35
                        )
                    )
                }
            }
            if let target = values.target {
                RuleMark(y: .value(copy.text(.targetLabel), target))
                    .lineStyle(StrokeStyle(
                        lineWidth: JarvisDesignTokens.healthTargetLineWidth,
                        dash: JarvisDesignTokens.healthTargetLineDash
                    ))
                    .foregroundStyle(.secondary)
            }
        }
        .chartYScale(domain: 0...yMax)
        .chartXScale(domain: values.days.map(\.date))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: values.days.map(\.date)) { value in
                AxisValueLabel {
                    if let date = value.as(String.self) {
                        Text(weekday(date))
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
        output.dateFormat = "EEE"
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
