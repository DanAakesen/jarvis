import Charts
import JarvisCore
import SwiftUI

private struct JarvisWorkspaceRuntimeKey: EnvironmentKey {
    static let defaultValue: WorkspaceRuntime? = nil
}

extension EnvironmentValues {
    /// The runtime that opens app routes for generated content shown outside the workspace sheet.
    var jarvisWorkspaceRuntime: WorkspaceRuntime? {
        get { self[JarvisWorkspaceRuntimeKey.self] }
        set { self[JarvisWorkspaceRuntimeKey.self] = newValue }
    }
}

/// One generated block inside an assistant message. It scrolls with the thread, has no handle, close button or
/// dimming, and draws only from the stored block, so it never changes after the reply was written.
struct JarvisChatBlockView: View {
    let block: ChatBlock
    let language: JarvisAppLanguage

    @Environment(\.jarvisWorkspaceRuntime) private var runtime
    @Environment(\.openURL) private var openURL
    @State private var showsData = false
    @State private var notice: String?

    private var locale: Locale { language.locale }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            Text(heading)
                .font(.headline)
                .foregroundStyle(.primary)
                .accessibilityAddTraits(.isHeader)
            content
            if block.source.isPartial {
                Label(block.source.reason ?? text(.blockPartial), systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if showsData, case .chart(let chart) = block.content {
                ChatBlockDataTable(table: chart.table(locale: locale, missing: text(.blockMissing)), language: language)
            }
            footer
        }
        .padding(JarvisDesignTokens.rowSpacing + JarvisDesignTokens.compactSpacing)
        .frame(maxWidth: 560, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceCornerRadius)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.block.\(block.id)")
    }

    /// A forecast names its place and date from its own data, so the heading can never disagree with the values.
    private var heading: String {
        if case .forecast(let forecast) = block.content {
            let date = ChatBlockFormatting.forecastDate(forecast.date, locale: locale) ?? forecast.date
            return "\(forecast.place) · \(date)"
        }
        return block.title
    }

    private var sourceLine: String {
        let issued = ChatBlockFormatting.issuedText(block.source.issuedAt, locale: locale) ?? block.source.issuedAt
        return String(format: text(.blockSourceLine), block.source.label, issued)
    }

    @ViewBuilder
    private var content: some View {
        switch block.content {
        case .forecast(let forecast):
            ChatBlockForecastView(forecast: forecast, summary: block.summary, language: language)
        case .chart(let chart):
            ChatBlockChartView(chart: chart, summary: block.summary, language: language)
        case .view(let view):
            if let runtime {
                GeneratedViewContent(
                    view: view,
                    runtime: runtime,
                    webAppURL: runtime.webAppURL,
                    language: language,
                    previewImage: nil,
                    onAction: perform
                )
            } else {
                unsupported
            }
        case .unsupported:
            unsupported
        }
    }

    private var unsupported: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
            Text(block.summary)
                .font(.body)
                .foregroundStyle(.primary)
            Label(text(.blockUnsupported), systemImage: "exclamationmark.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var footer: some View {
        HStack(alignment: .center, spacing: JarvisDesignTokens.rowSpacing) {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                Text(sourceLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let notice {
                    Text(notice)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if case .chart = block.content {
                JarvisMenuButton(
                    title: text(.blockActions),
                    systemImage: "ellipsis",
                    identifier: "chat.block.menu.\(block.id)"
                ) {
                    Button {
                        showsData.toggle()
                    } label: {
                        Label(text(showsData ? .blockHideData : .blockViewData), systemImage: "tablecells")
                    }
                    Button(action: copyData) {
                        Label(text(.blockCopyData), systemImage: "doc.on.doc")
                    }
                }
            }
        }
    }

    private func copyData() {
        UIPasteboard.general.string = block.plainText(
            locale: locale,
            missing: text(.blockMissing),
            sourceLine: sourceLine
        )
        notice = text(.blockCopied)
        AccessibilityNotification.Announcement(text(.blockCopied)).post()
    }

    private func perform(_ action: GeneratedViewAction) {
        switch action {
        case .openRoute(let route):
            if runtime?.openRoute(route) != true { notice = text(.blockUnsupported) }
        case .openLink(let value, _):
            if let url = URL(string: value) { openURL(url) } else { notice = text(.blockUnsupported) }
        case .callTool, .window:
            notice = text(.blockUnsupported)
        }
    }

    private func text(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: language)
    }
}

private struct ChatBlockForecastView: View {
    let forecast: ChatBlockForecast
    let summary: String
    let language: JarvisAppLanguage

    private var locale: Locale { language.locale }

    var body: some View {
        HStack(alignment: .center, spacing: JarvisDesignTokens.contentSpacing) {
            Image(systemName: ChatBlockFormatting.symbolName(for: forecast.symbol))
                .font(.largeTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                if forecast.hasTemperature {
                    Text(forecast.highLowText(locale: locale))
                        .font(.title.weight(.semibold))
                } else {
                    Text(text(.blockNotAvailable))
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                Text(forecast.conditions)
                    .font(.body)
                if let chance = forecast.rainChancePercent {
                    Text(String(
                        format: text(.blockRainChance),
                        ChatBlockFormatting.value(chance, unit: "%", locale: locale)
                    ))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
    }

    private func text(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: language)
    }
}

private struct ChatBlockDataTable: View {
    let table: ChatBlockChart.Table
    let language: JarvisAppLanguage

    var body: some View {
        ScrollView(.horizontal) {
            Grid(
                alignment: .leading,
                horizontalSpacing: JarvisDesignTokens.contentSpacing,
                verticalSpacing: JarvisDesignTokens.compactSpacing
            ) {
                GridRow {
                    ForEach(Array(table.header.enumerated()), id: \.offset) { _, title in
                        Text(title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            Text(cell).font(.caption)
                        }
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel(JarvisChatLocalization.string(.blockDataTable, language: language))
    }
}

private struct ChatBlockPlotPoint: Identifiable {
    let id: String
    let seriesIndex: Int
    let seriesName: String
    /// Points of one run are joined; a missing value ends the run, so a gap stays a gap.
    let run: String
    let label: String
    let value: Double
}

private struct ChatBlockChartView: View {
    let chart: ChatBlockChart
    let summary: String
    let language: JarvisAppLanguage

    @State private var selectedLabel: String?

    private var locale: Locale { language.locale }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                ForEach(Array(chart.panels.enumerated()), id: \.offset) { index, panel in
                    ChatBlockChartPanelView(
                        panel: panel,
                        panelIndex: index,
                        isLast: index == chart.panels.count - 1,
                        chart: chart,
                        allLabels: chart.labels(locale: locale),
                        language: language,
                        selectedLabel: $selectedLabel
                    )
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(summary)
            .accessibilityValue(accessibilityValue)
            readout
        }
    }

    private var readout: some View {
        Text(readoutText)
            .font(.caption)
            .foregroundStyle(selectedLabel == nil ? .secondary : .primary)
            .accessibilityHidden(true)
    }

    private var readoutText: String {
        guard let selectedLabel else { return text(.blockSelectHint) }
        let values = chart.panels.flatMap { panel in
            panel.series.map { series -> String in
                let point = series.points.first {
                    ChatBlockChartPanel.label(for: $0.x, locale: locale) == selectedLabel
                }
                let value = point?.y.map { ChatBlockFormatting.value($0, unit: panel.unit, locale: locale) }
                return "\(series.name) \(value ?? text(.blockMissing))"
            }
        }
        return String(format: text(.blockSelected), selectedLabel, values.joined(separator: " · "))
    }

    private var accessibilityValue: String {
        chart.panels.map {
            $0.dataDescription(xLabel: chart.xLabel, locale: locale, missing: text(.blockMissing))
        }.joined(separator: " ")
    }

    private func text(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: language)
    }
}

private struct ChatBlockChartPanelView: View {
    let panel: ChatBlockChartPanel
    let panelIndex: Int
    let isLast: Bool
    let chart: ChatBlockChart
    let allLabels: [String]
    let language: JarvisAppLanguage
    @Binding var selectedLabel: String?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var locale: Locale { language.locale }
    private var labels: [String] { panel.labels(locale: locale) }
    private var showsPointValues: Bool { labels.count <= 6 && !dynamicTypeSize.isAccessibilitySize }
    private static let symbols: [BasicChartSymbolShape] = [.circle, .square, .triangle, .diamond]
    private static let legendSymbols = ["circle.fill", "square.fill", "triangle.fill", "diamond.fill"]

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
            Text("\(panel.title) (\(panel.unit))")
                .font(.subheadline.weight(.semibold))
            if panel.series.count > 1 || panel.series.first?.name != panel.title {
                legend
            }
            if panel.hasValues {
                plot
            } else {
                Label(JarvisChatLocalization.string(.blockNoValues, language: language), systemImage: "chart.xyaxis.line")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var legend: some View {
        HStack(spacing: JarvisDesignTokens.rowSpacing) {
            ForEach(Array(panel.series.enumerated()), id: \.offset) { index, series in
                Label(series.name, systemImage: Self.legendSymbols[index % Self.legendSymbols.count])
                    .font(.caption)
                    .foregroundStyle(color(index))
                    .labelStyle(.titleAndIcon)
            }
        }
    }

    private func color(_ seriesIndex: Int) -> Color {
        let colors = JarvisDesignTokens.chartSeriesColors
        return colors[(panelIndex + seriesIndex) % colors.count]
    }

    private var plotPoints: [ChatBlockPlotPoint] {
        var points: [ChatBlockPlotPoint] = []
        for (seriesIndex, series) in panel.series.enumerated() {
            var run = 0
            for (pointIndex, point) in series.points.enumerated() {
                guard let value = point.y else {
                    run += 1
                    continue
                }
                points.append(ChatBlockPlotPoint(
                    id: "\(seriesIndex)-\(pointIndex)",
                    seriesIndex: seriesIndex,
                    seriesName: series.name,
                    run: "\(seriesIndex)-\(run)",
                    label: ChatBlockChartPanel.label(for: point.x, locale: locale),
                    value: value
                ))
            }
        }
        return points
    }

    private var axisLabels: [String] {
        let stride = max(1, Int((Double(allLabels.count) / 6).rounded(.up)))
        return allLabels.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
    }

    private func valueText(_ value: Double) -> String {
        ChatBlockFormatting.value(value, unit: panel.unit, locale: locale)
    }

    @ChartContentBuilder
    private func marks(for point: ChatBlockPlotPoint) -> some ChartContent {
        if panel.kind == .bar {
            BarMark(
                x: .value(chart.xLabel, point.label),
                y: .value(panel.title, point.value)
            )
            .position(by: .value(JarvisChatLocalization.string(.blockSeries, language: language), point.seriesName))
            .foregroundStyle(color(point.seriesIndex))
            .annotation(position: .top) {
                if showsPointValues { Text(valueText(point.value)).font(.caption2) }
            }
        } else {
            if panel.kind == .area {
                AreaMark(
                    x: .value(chart.xLabel, point.label),
                    y: .value(panel.title, point.value),
                    series: .value(JarvisChatLocalization.string(.blockSeries, language: language), point.run),
                    stacking: .unstacked
                )
                .foregroundStyle(color(point.seriesIndex).opacity(JarvisDesignTokens.chartAreaOpacity))
            }
            LineMark(
                x: .value(chart.xLabel, point.label),
                y: .value(panel.title, point.value),
                series: .value(JarvisChatLocalization.string(.blockSeries, language: language), point.run)
            )
            .foregroundStyle(color(point.seriesIndex))
            PointMark(
                x: .value(chart.xLabel, point.label),
                y: .value(panel.title, point.value)
            )
            .symbol(Self.symbols[point.seriesIndex % Self.symbols.count])
            .foregroundStyle(color(point.seriesIndex))
            .annotation(position: .top) {
                if showsPointValues { Text(valueText(point.value)).font(.caption2) }
            }
        }
    }

    private var plot: some View {
        Chart {
            ForEach(plotPoints) { point in
                marks(for: point)
            }
            if let selectedLabel, labels.contains(selectedLabel) {
                RuleMark(x: .value(chart.xLabel, selectedLabel))
                    .foregroundStyle(Color.secondary.opacity(0.5))
            }
        }
        .chartXScale(domain: allLabels)
        .chartYScale(domain: panel.domain)
        .chartXSelection(value: $selectedLabel)
        .chartXAxis {
            AxisMarks(values: axisLabels) { _ in
                AxisValueLabel()
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisGridLine()
                AxisValueLabel()
            }
        }
        .chartXAxisLabel(isLast ? chart.xLabel : "", alignment: .center)
        .frame(height: dynamicTypeSize.isAccessibilitySize ? 200 : 150)
    }
}
