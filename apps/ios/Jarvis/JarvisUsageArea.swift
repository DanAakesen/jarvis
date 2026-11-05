import Charts
import JarvisCore
import SwiftUI

/// The Usage page: what Jarvis work cost in the chosen period, from `GET /usage`. No polling: it reloads on
/// retry, refresh or a new period.
/// HIG: Charting data, Segmented controls, Layout, Accessibility. API: Charts (BarMark, chartXSelection), Picker.
struct JarvisUsageArea: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let client: JarvisUsageClient?
    let language: JarvisAppLanguage
    let onRetryConfiguration: () -> Void

    @State private var period = JarvisUsagePeriod.default
    @State private var groupBy = JarvisUsageGroupBy.project
    @State private var load: JarvisInsightsLoad<JarvisUsageSummary> = .loading
    @State private var selectedBucketID: String?
    @State private var chartSelection: String?
    @State private var selectedSliceID: String?
    @State private var reloadToken = 0
    @State private var refreshFailedWithCache = false
    @State private var forceReload = false
    @State private var showAllTasks = false

    private struct LoadKey: Hashable {
        let period: JarvisUsagePeriod
        let token: Int
    }

    private func text(_ key: JarvisInsightsLocalizationKey) -> String {
        jarvisInsightsText(key, language)
    }

    private var isLoading: Bool {
        if case .loading = load { return true }
        return false
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                if case .loaded(let summary) = load {
                    JarvisPageHeadline(phrase: JarvisUsagePagePhrase.make(summary, language: language))
                }
                if refreshFailedWithCache {
                    Text(text(.refreshFailedShowingSaved))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("usage.refreshFailed")
                }
                content
            }
            .padding(.horizontal)
            .padding(.bottom, JarvisDesignTokens.healthSectionSpacing)
        }
        .refreshable { forceReload = true; reloadToken += 1 }
        .accessibilityIdentifier("usage.scroll")
        .jarvisPageHeader {
            JarvisPageHeader(
                title: JarvisDestination.usage.localizedTitle(language: language),
                language: language
            )
        }
        .jarvisAmbientBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: LoadKey(period: period, token: reloadToken)) { await reload() }
        .onChange(of: chartSelection) { _, newValue in
            if let newValue { selectedBucketID = newValue }
        }
    }

    @ViewBuilder private var content: some View {
        switch load {
        case .loading:
            JarvisPageLoadingView(title: text(.loading), identifier: "usage.loading")
        case .failed(let failure):
            JarvisInsightsStateView(kind: .failure(failure), language: language, identifier: "usage.error") {
                if client == nil { onRetryConfiguration() }
                forceReload = true
                reloadToken += 1
            }
        case .loaded(let summary):
            loaded(summary)
        }
    }

    /// Reads through the repository: cached data first, then a quiet refresh only when it is stale (or forced).
    private func reload() async {
        guard let client else {
            load = .failed(.notConfigured)
            return
        }
        let force = forceReload
        forceReload = false
        selectedBucketID = nil
        chartSelection = nil
        selectedSliceID = nil
        refreshFailedWithCache = false
        let selected = period
        // Reset before the cache bind can suspend, so old totals never acquire the new range label.
        if case .loaded(let summary) = load, summary.period == selected {} else { load = .loading }
        await JarvisAppCache.bindIfNeeded()
        guard !Task.isCancelled else { return }
        let repository = JarvisRepository<JarvisUsageReport>(
            cache: JarvisAppCache.shared,
            kind: .usage,
            scope: selected.rawValue
        ) { try await client.fetchReport(period: selected, validator: $0) }
        for await update in repository.updates(force: force) {
            if Task.isCancelled { return }
            switch update {
            case .cached(let report, _), .fresh(let report):
                load = .loaded(JarvisUsageSummary(report: report, period: selected))
            case .refreshing:
                break
            case .failed(let error, let cached):
                if let cached {
                    load = .loaded(JarvisUsageSummary(report: cached, period: selected))
                    refreshFailedWithCache = true
                } else {
                    load = .failed(JarvisInsightsFailure(error))
                }
            }
        }
        if !Task.isCancelled, case .loading = load { load = .failed(.failed) }
    }

    // MARK: Loaded

    @ViewBuilder private func loaded(_ summary: JarvisUsageSummary) -> some View {
        VStack(spacing: JarvisDesignTokens.healthSectionSpacing) {
            overview(summary)
            if summary.isEmpty {
                JarvisInsightsCard {
                    JarvisInsightsStateView(
                        kind: .empty,
                        emptyTitle: text(.usageNoUsage),
                        language: language,
                        identifier: "usage.empty"
                    )
                }
            } else {
                breakdown(summary)
                topTasks(summary)
            }
            toolCalls(summary)
        }
    }

    private func selectedBucket(_ summary: JarvisUsageSummary) -> JarvisUsageBucket? {
        summary.buckets.first { $0.id == selectedBucketID }
    }

    private func overview(_ summary: JarvisUsageSummary) -> some View {
        let bucket = selectedBucket(summary)
        let totals = summary.totals(in: bucket)
        return JarvisPageHeroCard(title: text(.overview)) {
            JarvisPeriodSelector(
                title: text(.usageRangeLabel),
                identifierPrefix: "usage.range",
                items: JarvisUsagePeriod.allCases.map { JarvisTabItem(tag: $0, title: text($0.localizationKey), identifier: "usage.range.\($0.rawValue)") },
                selection: $period
            )
        } content: {
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                if dynamicTypeSize.isAccessibilitySize {
                    overviewAmount(summary, bucket: bucket)
                    chart(summary)
                } else {
                    HStack(alignment: .center, spacing: JarvisPageHeaderMetrics.spacing) {
                        overviewAmount(summary, bucket: bucket)
                            .frame(minWidth: JarvisPageHeaderMetrics.heroValueMinimumWidth, alignment: .leading)
                        chart(summary).frame(maxWidth: .infinity)
                    }
                }
                Divider()
                totalsGrid(totals)
            }
        }
        .accessibilityIdentifier("usage.hero")
    }

    private func overviewAmount(_ summary: JarvisUsageSummary, bucket: JarvisUsageBucket?) -> some View {
        let value = summary.value(in: bucket)
        let amount = summary.usesCost
            ? cost(value) : number(value)
        return VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.actionSpacing) {
            (Text(amount + " ") + Text(text(summary.usesCost ? .currencyUnit : .usageRecords)).font(.caption.weight(.semibold)))
                .font(.largeTitle.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .accessibilityLabel(valueText(value, summary: summary))
                .accessibilityIdentifier("usage.total")
            if let bucket {
                Text(label(for: bucket)).font(.caption).accessibilityIdentifier("usage.selection")
                JarvisIconButton(title: text(.closeSheet), systemImage: "xmark", identifier: "usage.clearSelection") {
                    selectedBucketID = nil
                    chartSelection = nil
                }
            }
            indicators(summary)
        }
    }

    private func indicators(_ summary: JarvisUsageSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if summary.hasEstimates {
                Text(text(.usageIncludesEstimates)).font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("usage.estimates")
            }
            if summary.truncated {
                HStack(spacing: 8) {
                    JarvisInsightsBadge(
                        title: JarvisInsightsLocalization.format(
                            .usageTruncated, language: language, summary.entries.count, summary.totalEntries
                        ),
                        systemImage: "scissors",
                        tint: JarvisDesignTokens.primaryAccent
                    )
                    JarvisIconButton(
                        title: text(.usageRefreshReport),
                        systemImage: "arrow.clockwise",
                        identifier: "usage.refreshReport"
                    ) { forceReload = true; reloadToken += 1 }
                }
                .accessibilityIdentifier("usage.truncated")
            }
        }
    }

    // MARK: Chart

    private func barTitle(_ summary: JarvisUsageSummary) -> String {
        switch (summary.period.bucketKind, summary.usesCost) {
        case (.day, true): text(.usagePerDay)
        case (.week, true): text(.usagePerWeek)
        case (.month, true): text(.usagePerMonth)
        case (.day, false): text(.usageRecordsPerDay)
        case (.week, false): text(.usageRecordsPerWeek)
        case (.month, false): text(.usageRecordsPerMonth)
        }
    }

    private func chart(_ summary: JarvisUsageSummary) -> some View {
        let title = barTitle(summary)
        return VStack(spacing: 4) {
            Chart(summary.buckets) { bucket in
                BarMark(
                    x: .value(title, bucket.startKey),
                    y: .value(title, bucket.value)
                )
                .foregroundStyle(
                    (selectedBucketID ?? summary.buckets.last?.id) == bucket.id
                        ? JarvisDesignTokens.primaryAccent
                        : Color.secondary
                )
                .cornerRadius(3)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartXSelection(value: $chartSelection)
            .frame(height: JarvisPageHeaderMetrics.compactChartHeight)
            .accessibilityLabel(title)
            .accessibilityHint(text(.usageBarHint))
            .accessibilityIdentifier("usage.chart")
            if let first = summary.buckets.first, let last = summary.buckets.last {
                HStack {
                    Text(label(for: first))
                    Spacer(minLength: 8)
                    Text(label(for: last))
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .accessibilityHidden(true)
            }
        }
    }

    private func label(for bucket: JarvisUsageBucket) -> String {
        guard let start = JarvisInsightsDates.date(fromDayKey: bucket.startKey) else { return bucket.startKey }
        switch bucket.kind {
        case .day:
            return JarvisInsightsDates.template(start, "dMMM", language: language)
        case .month:
            let first = JarvisInsightsDates.template(start, "MMMyyyy", language: language)
            if bucket.startKey.prefix(7) != bucket.endKey.prefix(7), let end = JarvisInsightsDates.date(fromDayKey: bucket.endKey) {
                return first + " – " + JarvisInsightsDates.template(end, "MMMyyyy", language: language)
            }
            return first
        case .week:
            let end = JarvisInsightsDates.date(fromDayKey: bucket.endKey) ?? start
            return JarvisInsightsDates.template(start, "dMMM", language: language) + " – "
                + JarvisInsightsDates.template(end, "dMMM", language: language)
        }
    }

    // MARK: Totals

    private func totalsGrid(_ totals: JarvisUsageTotals) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 72), spacing: 8, alignment: .topLeading)],
            alignment: .leading,
            spacing: 8
        ) {
            tile(text(.usageSandbox), number(totals.sandboxMinutes) + " " + text(.usageMinutesUnit), "usage.tile.sandbox")
            tile(text(.usageTokens), compact(totals.tokens), "usage.tile.tokens")
            tile(text(.usageTurns), number(totals.turns), "usage.tile.turns")
            tile(text(.usagePremium), number(totals.premiumRequests), "usage.tile.premium")
        }
    }

    private func tile(_ title: String, _ value: String, _ identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    // MARK: Breakdown

    private var palette: [Color] {
        let accent = JarvisDesignTokens.primaryAccent
        let stone = JarvisDesignTokens.secondaryAccent
        return [accent, stone, accent.opacity(0.55), stone.opacity(0.55), accent.opacity(0.3), stone.opacity(0.3)]
    }

    private func breakdown(_ summary: JarvisUsageSummary) -> some View {
        let slices = summary.slices(by: groupBy)
        return JarvisPageHeroCard(title: text(.usageBreakdown)) {
            JarvisPeriodSelector(
                title: text(.usageBreakdown),
                identifierPrefix: "usage.groupBy",
                items: JarvisUsageGroupBy.allCases.map { JarvisTabItem(tag: $0, title: text($0.localizationKey), identifier: "usage.groupBy.\($0.rawValue)") },
                selection: $groupBy
            )
            .onChange(of: groupBy) { _, _ in selectedSliceID = nil }
        } content: {
            splitBar(slices, summary: summary)
            VStack(spacing: 0) {
                ForEach(Array(slices.prefix(8).enumerated()), id: \.element.id) { index, slice in
                    sliceRow(slice, index: index, summary: summary)
                }
            }
        }
    }

    private func splitBar(_ slices: [JarvisUsageSlice], summary: JarvisUsageSummary) -> some View {
        GeometryReader { proxy in
            let gap: CGFloat = 2
            let available = max(0, proxy.size.width - gap * CGFloat(max(0, slices.count - 1)))
            let total = slices.reduce(0) { $0 + $1.value }
            HStack(spacing: gap) {
                ForEach(Array(slices.enumerated()), id: \.element.id) { index, slice in
                    Button {
                        selectedSliceID = selectedSliceID == slice.id ? nil : slice.id
                    } label: {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(palette[index % palette.count])
                            .opacity(selectedSliceID == nil || selectedSliceID == slice.id ? 1 : 0.3)
                            .frame(height: 20)
                            .frame(maxHeight: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(width: total > 0 ? available * CGFloat(slice.value / total) : 0)
                    .accessibilityLabel(sliceTitle(slice))
                    .accessibilityValue("\(slice.share) %")
                    .accessibilityIdentifier("usage.segment.\(slice.id)")
                }
            }
        }
        .frame(height: JarvisDesignTokens.chatMinimumTapTarget)
    }

    private func sliceRow(_ slice: JarvisUsageSlice, index: Int, summary: JarvisUsageSummary) -> some View {
        Button {
            selectedSliceID = selectedSliceID == slice.id ? nil : slice.id
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(palette[index % palette.count])
                    .frame(width: 10, height: 10)
                    .accessibilityHidden(true)
                Text(sliceTitle(slice))
                    .font(.subheadline)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)
                Spacer(minLength: 8)
                Text(valueText(slice.value, summary: summary))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text("\(slice.share) %")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .frame(minWidth: 44, alignment: .trailing)
            }
            .foregroundStyle(.primary)
            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            selectedSliceID == slice.id ? JarvisDesignTokens.primaryAccent.opacity(0.1) : Color.clear,
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
        .accessibilityAddTraits(selectedSliceID == slice.id ? .isSelected : [])
        .accessibilityIdentifier("usage.slice.\(slice.id)")
    }

    private func sliceTitle(_ slice: JarvisUsageSlice) -> String {
        switch groupBy {
        case .project:
            return slice.name ?? text(.usageNoProject)
        case .agent:
            switch slice.id {
            case "codex": return text(.usageSourceCodex)
            case "copilot": return text(.usageSourceCopilot)
            default: return text(.usageAgentJarvis)
            }
        case .source:
            switch slice.id {
            case "sandbox": return text(.usageSourceSandbox)
            case "jarvis_model": return text(.usageSourceModel)
            case "voice": return text(.usageSourceVoice)
            case "codex": return text(.usageSourceCodex)
            case "copilot": return text(.usageSourceCopilot)
            default: return slice.id
            }
        }
    }

    // MARK: Top tasks and tools

    private func topTasks(_ summary: JarvisUsageSummary) -> some View {
        let ranks = summary.topTasks()
        let maximum = ranks.map(\.value).max() ?? 0
        return VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
            JarvisSectionHeadline(text(.usageTopTasks))
            JarvisRowGroup {
                ForEach(showAllTasks ? ranks : Array(ranks.prefix(3))) { rank in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(taskTitle(rank))
                                .font(.subheadline)
                                .lineLimit(2)
                                .layoutPriority(1)
                            Spacer(minLength: 8)
                            Text(valueText(rank.value, summary: summary))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                        GeometryReader { proxy in
                            Capsule()
                                .fill(JarvisDesignTokens.secondaryAccent.opacity(0.6))
                                .frame(width: maximum > 0 ? proxy.size.width * CGFloat(rank.value / maximum) : 0)
                        }
                        .frame(height: 4)
                        .accessibilityHidden(true)
                    }
                    .jarvisListRow()
                    .accessibilityElement(children: .combine)
                }
                if ranks.count > 3 {
                    JarvisTextButton(title: showAllTasks ? text(.showLess) : JarvisInsightsLocalization.format(.showMore, language: language, ranks.count - 3),
                        identifier: "usage.showMore") { showAllTasks.toggle() }
                        .jarvisListRow(separator: false)
                }
            }
            .accessibilityIdentifier("usage.topTasks")
        }
    }

    private func taskTitle(_ rank: JarvisUsageTaskRank) -> String {
        if let title = rank.title, !title.isEmpty { return title }
        if let taskId = rank.taskId {
            return JarvisInsightsLocalization.format(.usageTaskNumber, language: language, String(taskId.prefix(8)))
        }
        switch rank.source {
        case "voice": return text(.usageConversation)
        case "jarvis_model": return text(.usageModelUse)
        default: return text(.usageUnlinked)
        }
    }

    private func toolCalls(_ summary: JarvisUsageSummary) -> some View {
        JarvisInsightsCard(title: text(summary.toolCallsAreDaily ? .usageToolCalls : .usageToolCallsPeriod)) {
            VStack(alignment: .leading, spacing: 8) {
                if summary.toolCalls.isEmpty {
                    Text(text(!summary.toolCallsAvailable ? .usageToolsUnavailable : summary.toolCallsAreDaily ? .usageNoToolCalls : .usageNoToolCallsPeriod))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(summary.toolCalls.prefix(8), id: \.tool) { call in
                        HStack(spacing: 8) {
                            Text(call.tool)
                                .font(.subheadline)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .layoutPriority(1)
                            Spacer(minLength: 8)
                            Text(number(Double(call.count) ?? 0))
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                Text(
                    summary.codexResearchCalls.map {
                        JarvisInsightsLocalization.format(.usageCodexResearch, language: language, $0)
                    } ?? text(.usageCodexResearchUnavailable)
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("usage.toolCalls")
        }
    }

    // MARK: Formatting

    private func number(_ value: Double) -> String {
        JarvisNumberFormat.compact(value, language: language)
    }

    private func compact(_ value: Double) -> String {
        JarvisNumberFormat.compact(value, language: language)
    }

    private func cost(_ value: Double) -> String {
        value >= 999.5 ? compact(value) : value.formatted(.number.precision(.fractionLength(0...2)).locale(language.locale))
    }

    /// Cost in DKK when the report carries cost; otherwise the number of records, as the page says it counts.
    private func valueText(_ value: Double, summary: JarvisUsageSummary) -> String {
        if summary.usesCost {
            let amount = cost(value)
            return amount + " " + text(.currencyUnit)
        }
        return number(value) + " " + text(.usageRecords)
    }
}
