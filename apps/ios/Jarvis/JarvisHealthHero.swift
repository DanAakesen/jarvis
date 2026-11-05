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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let goals: JarvisHealthGoals
    let language: JarvisAppLanguage
    let client: JarvisHealthClient?
    let accessory: Accessory

    @ScaledMetric(relativeTo: .body) private var heroHeight = JarvisDesignTokens.healthHeroHeight
    @State private var page: JarvisHealthHeroPage = .training

    init(
        data: JarvisHealthDashboardData,
        period: JarvisHealthPeriod,
        goals: JarvisHealthGoals,
        client: JarvisHealthClient?,
        language: JarvisAppLanguage,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.data = data
        self.period = period
        self.goals = goals
        self.client = client
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
                JarvisHealthSleepHero(data: data, period: period, goals: goals, language: language, client: client, accessory: accessory)
                    .tag(JarvisHealthHeroPage.sleep)
                    .accessibilityIdentifier(JarvisHealthHeroPage.sleep.identifier)
                JarvisHealthNutritionHero(data: data, period: period, goals: goals, language: language, client: client, accessory: accessory)
                    .tag(JarvisHealthHeroPage.nutrition)
                    .accessibilityIdentifier(JarvisHealthHeroPage.nutrition.identifier)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: heroHeight)
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
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment:
                    page = JarvisHealthHeroPage(rawValue: page.rawValue + 1) ?? page
                case .decrement:
                    page = JarvisHealthHeroPage(rawValue: page.rawValue - 1) ?? page
                @unknown default: break
                }
            }
            .accessibilityIdentifier("health.hero.dots")
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: page)
    }
}

struct JarvisHealthSleepHero<Accessory: View>: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let goals: JarvisHealthGoals
    let language: JarvisAppLanguage

    let client: JarvisHealthClient?
    let accessory: Accessory

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    private var nights: [String: JarvisHealthSleepNight] {
        JarvisHealthSleepNight.nights(from: data.sleep.items)
    }

    private var summary: JarvisHealthSleepSummary {
        JarvisHealthSleepSummary(items: data.sleep.items, period: period)
    }

    private var chartValues: JarvisHealthChartValues {
        JarvisHealthChartValues(
            values: nights.compactMapValues(\.total),
            endingOn: period.endDate,
            count: max(period.dayCount, 7),
            target: goals.sleepHours
        )
    }

    var body: some View {
        JarvisPageHeroCard(title: copy.text(.sleep), accessory: { accessory }) {
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
                NavigationLink {
                    let day = summary.latestDate ?? period.endDate
                    JarvisHealthDetailView(client: client, capabilities: data.capabilities,
                        kind: .sleep(day, JarvisHealthPeriod(startDate: day, endDate: day)!), language: language)
                } label: {
                    sleepDonut
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copy.text(.sleep))
                .accessibilityIdentifier("health.sleep.details")
                VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                    stageRow(.deepSleep, summary.deep, JarvisDesignTokens.healthAccent)
                    stageRow(.remSleep, summary.rem, JarvisDesignTokens.healthAccentSecondary)
                    stageRow(.lightSleep, summary.light, .secondary)
                    stageRow(.awake, summary.awake, .secondary.opacity(0.4))
                }
            }
            Divider()
            HStack(alignment: .top, spacing: JarvisDesignTokens.healthSectionSpacing) {
                JarvisHealthHeroStat(value: summary.total.map { "\(formatHours($0, language: language)) \(copy.text(.hourShort))" } ?? "—",
                    title: copy.text(.average))
                Divider()
                JarvisHealthHeroStat(value: formatNumber(Double(summary.nightCount), language: language),
                    title: copy.text(.nightsRecorded))
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("health.sleep.summary")
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

    @ViewBuilder private var sleepDonut: some View {
        if let deep = summary.deep, let rem = summary.rem,
           let light = summary.light, let awake = summary.awake,
           deep + rem + light + awake > 0 {
            Chart {
                SectorMark(angle: .value(copy.text(.deepSleep), deep), innerRadius: .ratio(JarvisDesignTokens.healthDonutInnerRatio))
                    .foregroundStyle(JarvisDesignTokens.healthAccent)
                SectorMark(angle: .value(copy.text(.remSleep), rem), innerRadius: .ratio(JarvisDesignTokens.healthDonutInnerRatio))
                    .foregroundStyle(JarvisDesignTokens.healthAccentSecondary)
                SectorMark(angle: .value(copy.text(.lightSleep), light), innerRadius: .ratio(JarvisDesignTokens.healthDonutInnerRatio))
                    .foregroundStyle(Color.secondary)
                SectorMark(angle: .value(copy.text(.awake), awake), innerRadius: .ratio(JarvisDesignTokens.healthDonutInnerRatio))
                    .foregroundStyle(Color.secondary.opacity(0.4))
            }
            .chartLegend(.hidden)
            .frame(width: JarvisDesignTokens.healthHeroRingSize, height: JarvisDesignTokens.healthHeroRingSize)
            .overlay {
                VStack(spacing: 0) {
                    Text(summary.total.map { formatHours($0, language: language) } ?? "—")
                        .font(.title3.weight(.semibold))
                    Text(copy.text(.hourShort)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(copy.text(.sleep))
            .accessibilityValue(summary.total.map { "\(formatHours($0, language: language)) \(copy.text(.hourShort))" } ?? copy.text(.unavailable))
        } else {
            JarvisHealthHeroRing(
                progress: JarvisHealthLogic.ringProgress(value: summary.total, target: goals.sleepHours),
                text: summary.total.map { formatHours($0, language: language) } ?? "—",
                unit: copy.text(.hourShort), tint: JarvisDesignTokens.healthAccent
            )
        }
    }

    private func stageRow(_ key: JarvisHealthLocalizationKey, _ hours: Double?, _ tint: Color) -> some View {
        HStack {
            Circle().fill(tint)
                .frame(width: JarvisDesignTokens.healthLegendDotSize, height: JarvisDesignTokens.healthLegendDotSize)
                .accessibilityHidden(true)
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

struct JarvisHealthNutritionHero<Accessory: View>: View {
    let data: JarvisHealthDashboardData
    let period: JarvisHealthPeriod
    let goals: JarvisHealthGoals
    let language: JarvisAppLanguage

    let client: JarvisHealthClient?
    let accessory: Accessory

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }

    private func values(_ nutrient: JarvisHealthNutrient) -> [String: Double] {
        JarvisHealthNutritionDays.values(from: data.nutritionDays.items, nutrient: nutrient)
    }

    private var proteinTarget: Double {
        data.nutritionTargets?.targets.proteinGrams ?? goals.proteinGrams
    }

    private var summary: JarvisHealthNutritionSummary {
        JarvisHealthNutritionSummary(items: data.nutritionDays.items, period: period)
    }

    var body: some View {
        JarvisPageHeroCard(title: copy.text(.nutrition), accessory: { accessory }) {
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
        let kcal = summary.average(.kcal)
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.healthSectionSpacing) {
            HStack(spacing: JarvisDesignTokens.healthSectionSpacing) {
                NavigationLink {
                    JarvisHealthDetailView(client: client, capabilities: data.capabilities,
                        kind: .meals(period), language: language)
                } label: {
                    JarvisHealthHeroRing(
                        progress: JarvisHealthLogic.ringProgress(value: kcal, target: goals.kcal),
                        text: kcal.map { formatNumber($0, language: language) } ?? "—",
                        unit: "kcal",
                        tint: JarvisDesignTokens.healthAccent
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copy.text(.nutrition))
                .accessibilityIdentifier("health.nutrition.details")
                VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                    macroRow(.protein, summary.average(.protein), proteinTarget, JarvisDesignTokens.healthAccent)
                    macroRow(.carbs, summary.average(.carbs), goals.carbsGrams, JarvisDesignTokens.healthAccentSecondary)
                    macroRow(.fat, summary.average(.fat), goals.fatGrams, .secondary)
                }
            }
            Divider()
            HStack(alignment: .top, spacing: JarvisDesignTokens.healthSectionSpacing) {
                JarvisHealthHeroStat(value: kcal.map { "\(formatNumber(period.dayCount == 1 ? max(0, goals.kcal - $0) : $0, language: language)) kcal" } ?? "—",
                    title: copy.text(period.dayCount == 1 ? .caloriesLeft : .dailyAverage))
                Divider()
                JarvisHealthHeroStat(value: formatNumber(Double(summary.mealCount), language: language),
                    title: copy.text(.mealsLogged))
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("health.nutrition.summary")
            JarvisHealthBarChart(
                values: JarvisHealthChartValues(
                    values: values(.protein), endingOn: period.endDate, count: max(period.dayCount, 7), target: proteinTarget
                ),
                unit: "g",
                title: copy.text(.proteinChart),
                identifier: "health.chart.protein",
                language: language,
                format: { formatNumber($0, language: language) }
            )
        }
    }

    private func macroRow(_ key: JarvisHealthLocalizationKey, _ value: Double?, _ target: Double, _ tint: Color) -> some View {
        HStack {
            Circle().fill(tint)
                .frame(width: JarvisDesignTokens.healthLegendDotSize, height: JarvisDesignTokens.healthLegendDotSize)
                .accessibilityHidden(true)
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

private struct JarvisHealthHeroStat: View {
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
