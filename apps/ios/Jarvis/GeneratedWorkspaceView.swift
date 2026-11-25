import JarvisCore
import Charts
import SwiftUI

struct GeneratedWorkspaceSheet: View {
    let presented: PresentedWorkspaceView
    let runtime: WorkspaceRuntime
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var actionNotice: String?

    private var language: JarvisAppLanguage {
        .default
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
                    GeneratedViewContent(
                        view: presented.view,
                        runtime: runtime,
                        language: language,
                        previewImage: nil,
                        onAction: perform
                    )
                    if let actionNotice {
                        Text(actionNotice)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
                .padding(JarvisDesignTokens.contentInset)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .jarvisAmbientBackground()
            .navigationTitle(presented.view.workspaceTitle(language: language))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    JarvisSheetCloseButton(title: text(.closeAccessibility)) { dismiss() }
                }
                .sharedBackgroundVisibility(.hidden)
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground { JarvisScreenBackground() }
        .environment(\.locale, language.locale)
    }

    private func perform(_ action: GeneratedViewAction) {
        actionNotice = performGeneratedViewAction(action, runtime: runtime, language: language, openURL: openURL)
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}

/// Runs an action from generated content and returns the notice to show when it cannot be done.
@MainActor
func performGeneratedViewAction(
    _ action: GeneratedViewAction,
    runtime: WorkspaceRuntime,
    language: JarvisAppLanguage,
    openURL: OpenURLAction
) -> String? {
    func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
    switch action {
    case .openRoute(let route):
        return runtime.openRoute(route) ? nil : text(.destinationUnavailable)
    case .openLink(let value, _):
        guard let url = URL(string: value) else { return text(.invalidLink) }
        openURL(url)
        return nil
    case .callTool:
        return text(.toolUnavailable)
    case .window(let windowAction):
        return runtime.perform(windowAction) ? nil : text(.windowActionUnavailable)
    }
}

struct GeneratedViewContent: View {
    let view: GeneratedView
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let previewImage: Image?
    var artifactVersion: Int? = nil
    var voiceHTMLHeight: CGFloat? = nil
    let onAction: (GeneratedViewAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
            renderer
            let actions = view.workspaceActions
            if !actions.isEmpty {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                    ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                        GeneratedActionControl(
                            action: action,
                            runtime: runtime,
                            language: language,
                            onAction: onAction
                        )
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var renderer: some View {
        switch view {
        case .table(let envelope):
            TableRenderer(data: envelope.data, language: language, fitsVoiceWindow: voiceHTMLHeight != nil)
        case .list(let envelope):
            ListRenderer(data: envelope.data, runtime: runtime, language: language, onAction: onAction)
        case .map(let envelope):
            JarvisAppleMapsCard(card: envelope.data)
        case .detail(let envelope):
            DetailRenderer(data: envelope.data)
        case .text(let envelope):
            TextRenderer(data: envelope.data)
        case .timeline(let envelope):
            TimelineRenderer(data: envelope.data)
        case .chart(let envelope):
            ChartRenderer(data: envelope.data, language: language, fitsVoiceWindow: voiceHTMLHeight != nil)
        case .taskCard(let envelope):
            TaskCardRenderer(data: envelope.data)
        case .status(let envelope):
            StatusRenderer(data: envelope.data, language: language)
        case .image(let envelope):
            ImageRenderer(data: envelope.data, previewImage: previewImage, language: language)
        case .htmlApp(let envelope):
            HTMLAppRenderer(
                artifactId: envelope.data.artifactId,
                runtime: runtime,
                language: language,
                artifactVersion: artifactVersion,
                voiceHeight: voiceHTMLHeight,
                revision: voiceHTMLHeight == nil ? nil : envelope.source.updatedAt
            )
        case .knowledgeGraph(let envelope):
            KnowledgeGraphRenderer(data: envelope.data, language: language, onOpenNotes: runtime.openNotesGraph)
        case .code(let envelope):
            CodeRenderer(data: envelope.data, fitsVoiceWindow: voiceHTMLHeight != nil)
        case .unsupportedVersion:
            UnsupportedRenderer(kind: text(.unsupportedVersion), language: language)
        case .unknown:
            UnsupportedRenderer(kind: text(.unsupportedView), language: language)
        }
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}

private struct TableRenderer: View {
    let data: GeneratedTableData
    let language: JarvisAppLanguage
    let fitsVoiceWindow: Bool

    var body: some View {
        Group {
            if fitsVoiceWindow {
                ViewThatFits(in: .horizontal) {
                    grid.fixedSize(horizontal: true, vertical: false)
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                        ForEach(Array(data.rows.enumerated()), id: \.offset) { index, row in
                            if index > 0 { Divider() }
                            ForEach(Array(row.enumerated()), id: \.offset) { column, value in
                                VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                                    if data.columns.indices.contains(column) {
                                        Text(data.columns[column]).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text(display(value, language: language))
                                }
                            }
                        }
                    }
                }
            } else {
                ScrollView(.horizontal) { grid }
            }
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel(
            JarvisWorkspaceLocalization.formatted(
                .tableSize,
                language: language,
                arguments: [data.columns.count, data.rows.count]
            )
        )
    }

    private var grid: some View {
        Grid(alignment: .leading, horizontalSpacing: JarvisDesignTokens.contentSpacing, verticalSpacing: JarvisDesignTokens.rowSpacing) {
            GridRow {
                ForEach(Array(data.columns.enumerated()), id: \.offset) { _, column in
                    Text(column)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(Array(data.rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, value in
                        Text(display(value, language: language))
                            .font(.body)
                            .foregroundStyle(.primary)
                    }
                }
            }
        }
        .padding(.vertical, JarvisDesignTokens.listRowVerticalInset)
    }
}

private struct ListRenderer: View {
    let data: GeneratedListData
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let onAction: (GeneratedViewAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
            ForEach(Array(data.items.enumerated()), id: \.offset) { index, item in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                    Text(item.title)
                        .font(.title3.weight(.semibold))
                    if let description = item.description {
                        Text(description)
                            .foregroundStyle(.secondary)
                    }
                    if let details = item.details, !details.isEmpty {
                        LabelValueList(fields: details)
                    }
                    if let action = item.action {
                        GeneratedActionControl(
                            action: action,
                            runtime: runtime,
                            language: language,
                            onAction: onAction
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, JarvisDesignTokens.listRowVerticalInset)
                if index < data.items.count - 1 {
                    Rectangle()
                        .fill(Color(uiColor: .separator))
                        .frame(height: 0.5)
                        .accessibilityHidden(true)
                }
            }
        }
    }
}

private struct DetailRenderer: View {
    let data: GeneratedDetailData

    var body: some View {
        LabelValueList(fields: data.fields)
    }
}

private struct LabelValueList: View {
    let fields: [GeneratedViewLabelValue]

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                    Text(field.label)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(field.value)
                        .font(.body)
                        .textSelection(.enabled)
                }
            }
        }
    }
}

private struct TextRenderer: View {
    let data: GeneratedTextData

    var body: some View {
        Group {
            if data.format == .markdown {
                Text((try? AttributedString(markdown: data.content)) ?? AttributedString(data.content))
            } else {
                Text(data.content)
            }
        }
        .font(.body)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TimelineRenderer: View {
    let data: GeneratedTimelineData

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
            ForEach(Array(data.events.enumerated()), id: \.offset) { _, event in
                HStack(alignment: .top, spacing: JarvisDesignTokens.rowSpacing) {
                    Image(systemName: "circle.fill")
                        .font(.system(size: JarvisDesignTokens.timelineMarkerSize))
                        .foregroundStyle(Color.accentColor)
                        .padding(.top, JarvisDesignTokens.timelineMarkerTopInset)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                        if let at = event.at ?? event.label {
                            Text(at)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Text(event.title)
                            .font(.body.weight(.semibold))
                        if let description = event.description {
                            Text(description)
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

private struct ChartRenderer: View {
    let data: GeneratedChartData
    let language: JarvisAppLanguage
    let fitsVoiceWindow: Bool

    var body: some View {
        Group {
            if chartPoints.isEmpty {
                Label(text(.noChartData), systemImage: "chart.xyaxis.line")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
                    GeometryReader { geometry in
                        let width = max(
                            geometry.size.width,
                            min(
                                CGFloat(chartPoints.count) * JarvisDesignTokens.chartMinimumPointSpacing,
                                JarvisDesignTokens.chartMaximumWidth
                            )
                        )
                        if fitsVoiceWindow {
                            chart(width: geometry.size.width)
                        } else {
                            ScrollView(.horizontal) { chart(width: width) }
                        }
                    }
                    .frame(height: JarvisDesignTokens.chartHeight)

                    DisclosureGroup(text(.showValues)) {
                        VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
                            ForEach(Array(data.series.enumerated()), id: \.offset) { _, series in
                                VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                                    Text(series.name)
                                        .font(.subheadline.weight(.semibold))
                                    ForEach(Array(series.points.enumerated()), id: \.offset) { _, point in
                                        Text("\(label(point.x)) · \(formatNumber(point.y))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        .padding(.top, JarvisDesignTokens.compactSpacing)
                    }
                }
            }
        }
    }

    private func chart(width: CGFloat) -> some View {
        Chart(chartPoints) { point in
            if data.kind == .bar {
                BarMark(
                    x: .value(text(.xAxis), point.x),
                    yStart: .value(text(.baseline), 0),
                    yEnd: .value(text(.yAxis), point.y)
                )
                .position(by: .value(text(.series), point.series))
                .foregroundStyle(by: .value(text(.series), point.series))
            } else if data.kind == .area {
                AreaMark(
                    x: .value(text(.xAxis), point.x),
                    yStart: .value(text(.baseline), 0),
                    yEnd: .value(text(.yAxis), point.y)
                )
                .foregroundStyle(by: .value(text(.series), point.series))
                .opacity(JarvisDesignTokens.chartAreaOpacity)
                LineMark(x: .value(text(.xAxis), point.x), y: .value(text(.yAxis), point.y))
                    .foregroundStyle(by: .value(text(.series), point.series))
            } else {
                LineMark(x: .value(text(.xAxis), point.x), y: .value(text(.yAxis), point.y))
                    .foregroundStyle(by: .value(text(.series), point.series))
            }
        }
        .chartForegroundStyleScale(
            domain: data.series.map(\.name),
            range: data.series.indices.map { JarvisDesignTokens.chartSeriesColors[$0 % JarvisDesignTokens.chartSeriesColors.count] }
        )
        .chartXScale(domain: xDomain)
        .chartYScale(domain: yDomain)
        .chartXAxis {
            AxisMarks(values: xAxisValues(maxLabels: fitsVoiceWindow ? max(2, Int(width / 76)) : 6)) { value in
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(xLabel(number))
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: yAxisValues) { value in
                AxisGridLine()
                AxisTick()
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(formatNumber(number))
                    }
                }
            }
        }
        .chartLegend(position: .bottom, alignment: .leading)
        .frame(width: width, height: JarvisDesignTokens.chartHeight)
        .accessibilityLabel(chartSummary)
    }

    private var chartPoints: [WorkspaceChartDataPoint] {
        let allPoints = data.series.flatMap(\.points)
        let categorical = data.kind == .bar || allPoints.contains { if case .string = $0.x { true } else { false } }
        let categories = categoryLabels
        let points = data.series.enumerated().flatMap { seriesIndex, series in
            series.points.enumerated().map { pointIndex, point in
                let position: Double
                switch point.x {
                case .number(let value):
                    position = categorical
                        ? Double(categories.firstIndex(of: label(point.x)) ?? 0)
                        : value
                case .string:
                    position = Double(categories.firstIndex(of: label(point.x)) ?? 0)
                }
                return WorkspaceChartDataPoint(
                    id: "\(seriesIndex)-\(pointIndex)",
                    seriesIndex: seriesIndex,
                    pointIndex: pointIndex,
                    series: series.name,
                    x: position,
                    y: point.y
                )
            }
        }
        return points.sorted {
            if $0.seriesIndex != $1.seriesIndex { return $0.seriesIndex < $1.seriesIndex }
            return categorical ? $0.pointIndex < $1.pointIndex : $0.x < $1.x
        }
    }

    private var categoryLabels: [String] {
        var labels: [String] = []
        for point in data.series.flatMap(\.points) {
            let value = label(point.x)
            if !labels.contains(value) { labels.append(value) }
        }
        return labels
    }

    private var xDomain: ClosedRange<Double> {
        if data.kind == .bar || data.series.flatMap(\.points).contains(where: {
            if case .string = $0.x { true } else { false }
        }) {
            let count = Double(max(categoryLabels.count, 1))
            return -0.5...(count - 0.5)
        }
        let values = chartPoints.map(\.x)
        guard let minimum = values.min(), let maximum = values.max() else { return 0...1 }
        return minimum == maximum ? (minimum - 0.5)...(maximum + 0.5) : minimum...maximum
    }

    private var yDomain: ClosedRange<Double> {
        let values = chartPoints.map(\.y)
        guard var minimum = values.min(), var maximum = values.max() else { return 0...1 }
        if data.kind != .line {
            minimum = min(minimum, 0)
            maximum = max(maximum, 0)
        }
        if minimum == maximum {
            minimum -= 0.5
            maximum += 0.5
        }
        return minimum...maximum
    }

    private func xAxisValues(maxLabels: Int) -> [Double] {
        if data.kind == .bar || data.series.flatMap(\.points).contains(where: {
            if case .string = $0.x { true } else { false }
        }) {
            let count = categoryLabels.count
            let ticks = min(count, maxLabels)
            guard ticks > 1 else { return count == 0 ? [] : [0] }
            return (0..<ticks).map { (Double($0) * Double(count - 1) / Double(ticks - 1)).rounded() }
        }
        let range = xDomain
        let intervals = min(4, maxLabels - 1)
        return (0...intervals).map { range.lowerBound + (range.upperBound - range.lowerBound) * Double($0) / Double(intervals) }
    }

    private var yAxisValues: [Double] {
        let range = yDomain
        let rawStep = (range.upperBound - range.lowerBound) / 4
        let magnitude = pow(10, floor(log10(rawStep)))
        let normalized = rawStep / magnitude
        let step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
        let first = floor(range.lowerBound / step) * step
        return (0..<7).map { first + Double($0) * step }
            .filter { $0 >= range.lowerBound - step / 2 && $0 <= range.upperBound + step / 2 }
    }

    private var chartSummary: String {
        let kind: JarvisWorkspaceLocalizationKey
        switch data.kind {
        case .line: kind = .chartLine
        case .bar: kind = .chartBar
        case .area: kind = .chartArea
        }
        let summary = data.series.map { series in
            guard let minimum = series.points.map(\.y).min(),
                  let maximum = series.points.map(\.y).max() else {
                return formatted(.chartNoValues, series.name)
            }
            return formatted(.chartRange, series.name, formatNumber(minimum), formatNumber(maximum))
        }.joined(separator: ". ")
        return formatted(.chartSummary, text(kind), summary)
    }

    private func xLabel(_ value: Double) -> String {
        if data.kind == .bar || data.series.flatMap(\.points).contains(where: {
            if case .string = $0.x { true } else { false }
        }) {
            let index = Int(value.rounded())
            guard categoryLabels.indices.contains(index) else { return "" }
            return categoryLabels[index]
        }
        return formatNumber(value)
    }

    private func label(_ coordinate: GeneratedChartPoint.Coordinate) -> String {
        switch coordinate {
        case .number(let value): formatNumber(value)
        case .string(let value): value
        }
    }

    private func formatNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).locale(language.locale))
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }

    private func formatted(_ key: JarvisWorkspaceLocalizationKey, _ arguments: CVarArg...) -> String {
        JarvisWorkspaceLocalization.formatted(key, language: language, arguments: arguments)
    }
}

private struct WorkspaceChartDataPoint: Identifiable {
    let id: String
    let seriesIndex: Int
    let pointIndex: Int
    let series: String
    let x: Double
    let y: Double
}

private struct TaskCardRenderer: View {
    let data: GeneratedTaskCardData

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
            Text(data.title)
                .font(.title2.weight(.semibold))
            Label(data.state.capitalized, systemImage: "checkmark.circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let summary = data.summary {
                Text(summary)
                    .font(.body)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct StatusRenderer: View {
    let data: GeneratedStatusData
    let language: JarvisAppLanguage

    var body: some View {
        HStack(alignment: .top, spacing: JarvisDesignTokens.rowSpacing) {
            Image(systemName: symbol(for: data.state))
                .font(.system(size: JarvisDesignTokens.iconSize))
                .foregroundStyle(color(for: data.state))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                Text(data.label)
                    .font(.title3.weight(.semibold))
                if let value = data.value {
                    Text(value)
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                Text(statusTitle)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(color(for: data.state))
            }
        }
    }

    private var statusTitle: String {
        let key: JarvisWorkspaceLocalizationKey
        switch data.state {
        case .ok: key = .statusOK
        case .warning: key = .statusWarning
        case .error: key = .statusError
        case .unknown: key = .statusUnknown
        }
        return JarvisWorkspaceLocalization.string(key, language: language)
    }

    private func symbol(for state: GeneratedStatusData.State) -> String {
        switch state {
        case .ok: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .error: "xmark.octagon.fill"
        case .unknown: "questionmark.circle"
        }
    }

    private func color(for state: GeneratedStatusData.State) -> Color {
        switch state {
        case .ok: .green
        case .warning: .orange
        case .error: .red
        case .unknown: .secondary
        }
    }
}

private struct ImageRenderer: View {
    let data: GeneratedImageData
    let previewImage: Image?
    let language: JarvisAppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
            ForEach(Array(data.images.enumerated()), id: \.offset) { _, image in
                if let previewImage {
                    previewImage
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
                        .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceCornerRadius))
                        .accessibilityLabel(image.alt)
                } else if let url = URL(string: image.url) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let loaded):
                            loaded
                                .resizable()
                                .scaledToFit()
                        case .failure:
                            Label(text(.imageUnavailable), systemImage: "photo")
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
                        case .empty:
                            JarvisLoadingView(title: text(.loadingImage))
                                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
                        @unknown default:
                            Label(text(.imageUnavailable), systemImage: "photo")
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceCornerRadius))
                    .accessibilityLabel(image.alt)
                }
            }
        }
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}

/// A view this version of the app has no renderer for. The title is the view's own and is shown by the page that
/// presents it, so this says only why there is nothing to draw.
private struct UnsupportedRenderer: View {
    let kind: String
    let language: JarvisAppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            Label(kind, systemImage: "rectangle.slash")
                .font(.subheadline)
            Text(text(.nativeUnavailable))
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}

/// Which notes a search matched. The backend names them by an opaque id, so the card gives the count and the search
/// and sends the owner to the graph in Notes.
private struct KnowledgeGraphRenderer: View {
    let data: GeneratedKnowledgeGraphData
    let language: JarvisAppLanguage
    let onOpenNotes: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            Text(JarvisWorkspaceLocalization.formatted(.knowledgeGraphQuery, language: language, arguments: [data.query]))
                .font(.body)
            Text(JarvisWorkspaceLocalization.formatted(.knowledgeGraphCount, language: language, arguments: [data.highlight.count]))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            JarvisLabelledButton(
                title: JarvisWorkspaceLocalization.string(.openNotes, language: language),
                systemImage: "arrow.up.right",
                identifier: "workspace.knowledgeGraph.openNotes",
                action: onOpenNotes
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Numbered code wraps inside Voice windows and scrolls horizontally in the workspace.
private struct CodeRenderer: View {
    let data: GeneratedCodeData
    let fitsVoiceWindow: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            if !data.location.isEmpty {
                Text(data.location)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            if fitsVoiceWindow {
                lines
            } else {
                ScrollView(.horizontal) { lines }.scrollIndicators(.hidden)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var lines: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(data.displayLines) { line in
                HStack(alignment: .firstTextBaseline, spacing: JarvisDesignTokens.rowSpacing) {
                    Text(line.isHighlighted ? "›" : " ")
                        .font(.system(.footnote, design: .monospaced).weight(.bold))
                        .foregroundStyle(.primary)
                        .accessibilityHidden(true)
                    Text("\(line.number)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 36, alignment: .trailing)
                    Text(line.text.isEmpty ? " " : line.text)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: !fitsVoiceWindow, vertical: true)
                }
                .padding(.vertical, 1)
                .background(line.isHighlighted ? Color.primary.opacity(0.1) : .clear)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

private struct GeneratedActionControl: View {
    let action: GeneratedViewAction
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    let onAction: (GeneratedViewAction) -> Void

    var body: some View {
        if let title = title, runtime.canPerform(action) {
            JarvisLabelledButton(title: title, systemImage: symbol) { onAction(action) }
        } else {
            Label(title ?? text(.actionUnavailable), systemImage: "xmark.circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityLabel(formatted(.actionUnavailableOnPhone, title ?? text(.actionUnavailable)))
        }
    }

    private var title: String? {
        switch action {
        case .openRoute(let route):
            switch GeneratedViewRoute(route: route) {
            case .home: text(.openHome)
            case .usage: text(.openUsage)
            case .settings: text(.openSettings)
            case .factoryTask: text(.openTask)
            case .factoryProject, .factoryRelease: text(.openFactory)
            case nil: formatted(.routeUnavailable, route)
            }
        case .openLink(_, let label):
            label
        case .callTool(let tool):
            formatted(.toolUnavailableLabel, tool)
        case .window(let windowAction):
            switch windowAction.operation {
            case .focus: text(.focusView)
            case .restore: text(.restoreView)
            case .close: text(.closeView)
            case .minimise: text(.minimiseView)
            case .move: text(.moveView)
            case .resize: text(.resizeView)
            }
        }
    }

    private var symbol: String {
        switch action {
        case .openRoute: "arrow.up.right"
        case .openLink: "link"
        case .callTool: "wrench"
        case .window(let windowAction):
            switch windowAction.operation {
            case .focus: "arrow.up.forward.app"
            case .restore: "arrow.up.left.and.arrow.down.right"
            case .close: "xmark"
            case .minimise: "minus"
            case .move, .resize: "arrow.up.left.and.arrow.down.right"
            }
        }
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }

    private func formatted(_ key: JarvisWorkspaceLocalizationKey, _ arguments: CVarArg...) -> String {
        JarvisWorkspaceLocalization.formatted(key, language: language, arguments: arguments)
    }
}

extension GeneratedView {
    func workspaceTitle(language: JarvisAppLanguage) -> String {
        switch self {
        case .table(let value): value.title
        case .list(let value): value.title
        case .map(let value): value.title
        case .detail(let value): value.title
        case .text(let value): value.title
        case .timeline(let value): value.title
        case .chart(let value): value.title
        case .taskCard(let value): value.title
        case .status(let value): value.title
        case .image(let value): value.title
        case .htmlApp(let value): value.title
        case .knowledgeGraph(let value): value.title
        case .code(let value): value.title
        case .unsupportedVersion, .unknown:
            JarvisWorkspaceLocalization.string(.generatedView, language: language)
        }
    }

    /// Where the content came from and whether it is still being produced, partial or unavailable.
    var workspaceSource: GeneratedViewSource? {
        switch self {
        case .table(let value): value.source
        case .list(let value): value.source
        case .map(let value): value.source
        case .detail(let value): value.source
        case .text(let value): value.source
        case .timeline(let value): value.source
        case .chart(let value): value.source
        case .taskCard(let value): value.source
        case .status(let value): value.source
        case .image(let value): value.source
        case .htmlApp(let value): value.source
        case .knowledgeGraph(let value): value.source
        case .code(let value): value.source
        case .unsupportedVersion, .unknown: nil
        }
    }

    var workspaceActions: [GeneratedViewAction] {
        switch self {
        case .table(let value): value.actions ?? []
        case .list(let value): value.actions ?? []
        case .map(let value): value.actions ?? []
        case .detail(let value): value.actions ?? []
        case .text(let value): value.actions ?? []
        case .timeline(let value): value.actions ?? []
        case .chart(let value): value.actions ?? []
        case .taskCard(let value): value.actions ?? []
        case .status(let value): value.actions ?? []
        case .image(let value): value.actions ?? []
        case .htmlApp(let value): value.actions ?? []
        case .knowledgeGraph(let value): value.actions ?? []
        case .code(let value): value.actions ?? []
        case .unsupportedVersion, .unknown: []
        }
    }
}

private func display(_ value: JSONValue, language: JarvisAppLanguage) -> String {
    switch value {
    case .string(let value): value
    case .number(let value): value.formatted(.number.precision(.fractionLength(0...2)).locale(language.locale))
    case .bool(let value):
        JarvisWorkspaceLocalization.string(value ? .yes : .no, language: language)
    case .null: "—"
    case .array, .object: JarvisWorkspaceLocalization.string(.value, language: language)
    }
}

#if DEBUG
private enum GeneratedWorkspacePreviewSamples {
    private static let payloads = [
        """
        {"version":1,"title":"Synthetic table","renderer":"table","source":{"id":"fixture","status":"complete"},"data":{"columns":["Item","State"],"rows":[["Notes","Ready"],["Voice","Paused"]]}}
        """,
        """
        {"version":1,"title":"Synthetic list","renderer":"list","source":{"id":"fixture","status":"complete"},"data":{"items":[{"title":"Workspace item","description":"Synthetic description","details":[{"label":"State","value":"Ready"}]}]}}
        """,
        """
        {"version":1,"title":"Synthetic detail","renderer":"detail","source":{"id":"fixture","status":"complete"},"data":{"fields":[{"label":"Owner","value":"Synthetic"},{"label":"State","value":"Ready"}]}}
        """,
        """
        {"version":1,"title":"Synthetic text","renderer":"text","source":{"id":"fixture","status":"complete"},"data":{"format":"markdown","content":"**Synthetic** generated content."}}
        """,
        """
        {"version":1,"title":"Synthetic timeline","renderer":"timeline","source":{"id":"fixture","status":"complete"},"data":{"events":[{"at":"Today","title":"Created","description":"Synthetic event"},{"at":"Earlier","title":"Updated"}]}}
        """,
        """
        {"version":1,"title":"Synthetic chart","renderer":"chart","source":{"id":"fixture","status":"complete"},"data":{"kind":"line","series":[{"name":"Sample series","points":[{"x":"A","y":2},{"x":"B","y":5},{"x":"C","y":3}]}]}}
        """,
        """
        {"version":1,"title":"Synthetic task","renderer":"task-card","source":{"id":"fixture","status":"complete"},"data":{"id":"fixture-task","title":"Synthetic task","state":"ready","summary":"No owner data."}}
        """,
        """
        {"version":1,"title":"Synthetic status","renderer":"status","source":{"id":"fixture","status":"complete"},"data":{"label":"Service","value":"Available","state":"ok"}}
        """,
        """
        {"version":1,"title":"Synthetic image","renderer":"image","source":{"id":"fixture","status":"complete"},"data":{"images":[{"url":"https://fixture.blob.core.windows.net/synthetic.png","alt":"Synthetic image"}]}}
        """,
        """
        {"version":1,"title":"Synthetic HTML app","renderer":"html-app","source":{"id":"fixture","status":"complete"},"data":{"artifactId":"123e4567-e89b-42d3-a456-426614174000"}}
        """,
        """
        {"version":1,"title":"Synthetic graph","renderer":"knowledge-graph","source":{"id":"fixture","status":"complete"},"data":{"query":"synthetic query","highlight":[]}}
        """,
        """
        {"version":1,"title":"Synthetic code","renderer":"code","source":{"id":"fixture","status":"complete"},"data":{"repo":"example/project","path":"src/example.swift","content":"let sample = true\\n","startLine":1}}
        """,
        """
        {"version":1,"title":"Future renderer","renderer":"future-card","source":{"id":"fixture","status":"complete"},"data":{"sample":true}}
        """,
        """
        {"version":2,"title":"Future version","renderer":"text","source":{"id":"fixture","status":"complete"},"data":{"format":"plain","content":"Synthetic unsupported version."}}
        """,
    ]

    static var views: [GeneratedView] {
        payloads.compactMap { payload in
            let decoder = JSONDecoder()
            decoder.userInfo[GeneratedViewDecodingContext.trustedBlobHostKey] = "fixture.blob.core.windows.net"
            return try? decoder.decode(GeneratedView.self, from: Data(payload.utf8))
        }
    }
}

private struct GeneratedWorkspacePreviewGallery: View {
    @StateObject private var runtime = WorkspaceRuntime(client: nil)

    private var language: JarvisAppLanguage {
        .default
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.contentSpacing) {
                    ForEach(Array(GeneratedWorkspacePreviewSamples.views.enumerated()), id: \.offset) { _, view in
                        GeneratedViewContent(
                            view: view,
                            runtime: runtime,
                            language: language,
                            previewImage: Image(systemName: "photo"),
                            onAction: { _ in }
                        )
                        .padding(JarvisDesignTokens.contentInset)
                        .background {
                            JarvisGlassSurface()
                                .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceCornerRadius))
                        }
                    }
                }
                .padding(JarvisDesignTokens.contentInset)
            }
            .navigationTitle(JarvisWorkspaceLocalization.string(.generatedView, language: language))
        }
        .environment(\.locale, language.locale)
    }
}

#Preview("Generated workspace renderers") {
    GeneratedWorkspacePreviewGallery()
}
#endif
