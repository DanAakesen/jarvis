import JarvisCore
import SwiftUI

/// The Status page: the 11 backend checks, the vault mirror and the smoke summary, from `GET /status`.
/// A failed refresh keeps the last snapshot on screen and says so.
/// HIG: Disclosure controls, Segmented controls, Status, Loading. API: Picker, Button, accessibilityAddTraits.
struct JarvisStatusArea: View {
    let client: JarvisStatusClient?
    let language: JarvisAppLanguage
    let onRetryConfiguration: () -> Void
    /// A fixed clock for fixtures; `nil` follows the real time and re-checks staleness every 30 seconds.
    var fixedNow: Date?

    @State private var state = JarvisStatusViewState()
    @State private var filter = JarvisStatusFilter.all
    @State private var expanded: Set<String> = []
    @State private var reloadToken = 0
    @State private var tick = Date()

    private var now: Date { fixedNow ?? tick }

    private func text(_ key: JarvisInsightsLocalizationKey) -> String {
        jarvisInsightsText(key, language)
    }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.healthRowSpacing) {
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                    if let snapshot = state.snapshot {
                        JarvisPageHeadline(phrase: JarvisStatusPagePhrase.make(snapshot, language: language, now: now))
                    }
                    content
                }
                    .padding(.horizontal)
                    .padding(.bottom, JarvisDesignTokens.healthSectionSpacing)
            }
            .refreshable { await refresh(force: true) }
            .accessibilityIdentifier("status.scroll")
        }
        .jarvisPageHeader {
            JarvisPageHeader(
                title: JarvisDestination.status.localizedTitle(language: language),
                language: language
            )
        }
        .jarvisAmbientBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: reloadToken) { await refresh(force: reloadToken > 0) }
        .task { await keepClockFresh() }
    }

    /// Reads through the repository: cached data first, then a quiet refresh when it is stale (or forced). A failed
    /// refresh keeps the cached snapshot on screen and marks the page partial.
    private func refresh(force: Bool = false) async {
        guard let client else {
            state = JarvisStatusViewState(snapshot: state.snapshot, failure: .notConfigured, isLoading: false)
            return
        }
        state.begin()
        let repository: JarvisRepository<JarvisStatusSnapshot> = await JarvisAppCache.repository(.status) {
            try await client.fetchSnapshot(validator: $0)
        }
        for await update in repository.updates(force: force) {
            if Task.isCancelled { return }
            switch update {
            case .cached(let snapshot, _), .fresh(let snapshot):
                tick = Date()
                state.succeeded(snapshot)
            case .refreshing:
                break
            case .failed(let error, _):
                state.failed(error)
            }
        }
    }

    private func keepClockFresh() async {
        guard fixedNow == nil else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(30))
            if Task.isCancelled { return }
            tick = Date()
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            overview
            JarvisSegmentedBar(
                title: text(.statusFilterLabel),
                identifierPrefix: "status.filter",
                items: JarvisStatusFilter.allCases.map { JarvisTabItem(tag: $0, title: text($0.localizationKey)) },
                selection: $filter
            )
            if let snapshot = state.snapshot {
                loaded(snapshot)
            } else if let failure = state.failure {
                JarvisInsightsStateView(kind: .failure(failure), language: language, identifier: "status.error") {
                    if client == nil { onRetryConfiguration() }
                    reloadToken += 1
                }
            } else {
                JarvisInsightsStateView(kind: .loading, language: language, identifier: "status.loading")
            }
            if state.snapshot == nil {
                JarvisRowGroup {
                    ForEach(JarvisStatusCheckID.allCases, id: \.rawValue) { check in
                        pendingRow(text(check.localizationKey))
                    }
                }
                JarvisRowGroup {
                    pendingRow(text(.statusMirror))
                    pendingRow(text(.statusSmoke))
                }
            }
        }
    }

    private func pendingRow(_ title: String) -> some View {
        HStack(spacing: JarvisDesignTokens.rowSpacing) {
            Image(systemName: "questionmark.circle")
                .foregroundStyle(.secondary)
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(title).font(.body).lineLimit(2)
            Spacer(minLength: 0)
            if state.failure == nil { JarvisLoadingView().accessibilityHidden(true) }
            else { Text("—").foregroundStyle(.secondary) }
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
        .jarvisListRow()
        .accessibilityElement(children: .combine)
        .accessibilityValue(text(state.failure?.localizationKey ?? .loading))
    }

    private var overview: some View {
        JarvisPageHeroCard(title: text(.overview)) {
            if let snapshot = state.snapshot { checkedLine(snapshot) }
        } content: {
            JarvisPageStatGrid(
                stats: JarvisStatusValue.allCases.map { tone in
                    JarvisPageStat(
                        id: tone.rawValue,
                        value: state.snapshot?.entries.filter { $0.status == tone }.count,
                        label: text(tone.localizationKey),
                        systemImage: tone == .ok ? "checkmark.circle" : tone == .unknown ? "questionmark.circle" : "exclamationmark.circle",
                        tint: tone == .down ? .red : JarvisDesignTokens.primaryAccent,
                        isLoading: state.failure == nil
                    )
                },
                language: language
            )
        }
        .accessibilityIdentifier("status.hero")
    }

    private func loaded(_ snapshot: JarvisStatusSnapshot) -> some View {
        let entries = JarvisStatusLogic.visible(snapshot.entries, filter: filter)
        let mirror = snapshot.vaultMirror
        let showMirror = mirror.map { filter == .all || $0.displayState(now: now).tone != .ok } ?? false
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            if state.isPartial, let failure = state.failure {
                HStack {
                    JarvisInsightsBadge(
                        title: text(.statusPartial) + " · " + text(failure.localizationKey),
                        systemImage: "exclamationmark.arrow.circlepath",
                        tint: JarvisDesignTokens.primaryAccent
                    )
                    .accessibilityIdentifier("status.partial")
                    JarvisIconButton(title: text(.retry), systemImage: "arrow.clockwise", identifier: "status.partial.retry") {
                        reloadToken += 1
                    }
                }
            }
            if entries.isEmpty {
                JarvisInsightsCard {
                    JarvisInsightsStateView(
                        kind: .empty,
                        emptyTitle: text(.statusNoIssues),
                        language: language,
                        identifier: "status.empty"
                    )
                }
            } else {
                JarvisRowGroup {
                    ForEach(entries) { entry in checkRow(entry) }
                }
            }
            JarvisRowGroup {
                if let mirror, showMirror { mirrorRow(mirror) }
                smokeRow(snapshot.smoke)
            }
        }
    }

    private func checkedLine(_ snapshot: JarvisStatusSnapshot) -> some View {
        let checked = JarvisInsightsDates.parse(snapshot.checkedAt)
        let stale = JarvisStatusLogic.isStale(checkedAt: snapshot.checkedAt, now: now)
        return HStack(spacing: 8) {
            if let checked {
                let sameDay = JarvisInsightsDates.dayKey(checked) == JarvisInsightsDates.dayKey(now)
                Text(
                    JarvisInsightsLocalization.format(
                        .statusChecked,
                        language: language,
                        JarvisInsightsDates.format(
                            checked, language: language, dateStyle: sameDay ? .none : .short, timeStyle: .short
                        )
                    )
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("status.checked")
            }
            if stale {
                JarvisInsightsBadge(
                    title: text(.statusStale),
                    systemImage: "clock.badge.exclamationmark",
                    tint: JarvisDesignTokens.primaryAccent
                )
                .accessibilityIdentifier("status.stale")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
    }

    // MARK: Rows

    private func checkRow(_ entry: JarvisStatusEntry) -> some View {
        let title = entry.check.map { text($0.localizationKey) } ?? JarvisStatusLogic.readable(entry.id)
        let reason = JarvisStatusLogic.reason(for: entry)
        return JarvisStatusRow(
            title: title,
            tone: entry.status,
            toneTitle: text(entry.status.localizationKey),
            isExpanded: expanded.contains(entry.id),
            identifier: "status.row.\(entry.id)",
            language: language,
            subtitle: reasonText(reason) ?? checkedText(entry.checkedAt)
        ) {
            toggle(entry.id)
        } detail: {
            VStack(alignment: .leading, spacing: 6) {
                Text(reasonText(reason) ?? text(entry.status.localizationKey))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("status.reason.\(entry.id)")
            }
        }
    }

    private func reasonText(_ reason: JarvisStatusReason?) -> String? {
        switch reason {
        case .key(let key): text(key)
        case .text(let value): value
        case nil: nil
        }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    private func mirrorRow(_ mirror: JarvisVaultMirror) -> some View {
        let displayState = mirror.displayState(now: now)
        return JarvisStatusRow(
            title: text(.statusMirror),
            tone: displayState.tone,
            toneTitle: text(displayState.localizationKey),
            isExpanded: expanded.contains("vault-mirror"),
            identifier: "status.row.vault-mirror",
            language: language,
            subtitle: lastSuccessText(mirror)
        ) {
            toggle("vault-mirror")
        } detail: {
            VStack(alignment: .leading, spacing: 8) {
                Text(lastSuccessText(mirror))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let writeBack = mirror.writeBack {
                    Text(
                        text(.statusMirrorWriteBack) + ": "
                            + (writeBack == "dry-run" ? text(.statusMirrorWriteBackDryRun) : text(.statusMirrorWriteBackOn))
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                if let reason = mirror.reason {
                    Text(JarvisStatusLogic.readable(reason))
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let counts = mirror.counts {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 96), spacing: 8, alignment: .topLeading)],
                        alignment: .leading,
                        spacing: 8
                    ) {
                        ForEach(Array(counts.rows.enumerated()), id: \.offset) { _, row in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(row.1)")
                                    .font(.subheadline.weight(.semibold))
                                    .monospacedDigit()
                                Text(text(row.0))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                let paths = mirror.visibleConflictPaths
                if !paths.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(text(.statusMirrorConflictPaths))
                            .font(.caption.weight(.semibold))
                        ForEach(paths, id: \.self) { path in
                            Text(path)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .truncationMode(.middle)
                        }
                    }
                }
            }
            .accessibilityIdentifier("status.reason.vault-mirror")
        }
    }

    private func lastSuccessText(_ mirror: JarvisVaultMirror) -> String {
        guard let last = mirror.lastSuccessAt.flatMap(JarvisInsightsDates.parse) else {
            return text(.statusMirrorNoSuccess)
        }
        return JarvisInsightsLocalization.format(
            .statusMirrorLastSuccess,
            language: language,
            JarvisInsightsDates.elapsed(from: last, now: now, language: language)
        )
    }

    private func checkedText(_ timestamp: String) -> String? {
        guard let date = JarvisInsightsDates.parse(timestamp) else { return nil }
        return JarvisInsightsLocalization.format(.statusChecked, language: language,
            JarvisInsightsDates.format(date, language: language, dateStyle: .none, timeStyle: .short))
    }

    private func smokeRow(_ smoke: JarvisStatusSmoke?) -> some View {
        let tone: JarvisStatusValue = smoke.map { $0.entries.isEmpty ? .unknown : $0.okCount == $0.entries.count ? .ok : .degraded } ?? .unknown
        return JarvisStatusRow(title: text(.statusSmoke), tone: tone,
            toneTitle: smoke.map { "\($0.okCount)/\($0.entries.count)" } ?? "—",
            isExpanded: expanded.contains("smoke"), identifier: "status.smoke", language: language,
            subtitle: smoke.flatMap { checkedText($0.checkedAt) } ?? text(.statusSmokeNone)) {
                toggle("smoke")
            } detail: {
                if let smoke {
                    ForEach(smoke.entries) { entry in
                        VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                            Text(JarvisStatusLogic.readable(entry.id) + " · " + text(entry.status.localizationKey))
                            if let reason = entry.reason { Text(JarvisStatusLogic.readable(reason)).foregroundStyle(.secondary) }
                        }.font(.subheadline)
                    }
                } else { Text(text(.statusSmokeNone)).font(.subheadline).foregroundStyle(.secondary) }
            }
    }

}

/// One expandable row. The whole header is the button; the sentence under it appears when it is open.
private struct JarvisStatusRow<Detail: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let title: String
    let tone: JarvisStatusValue
    let toneTitle: String
    let isExpanded: Bool
    let identifier: String
    let language: JarvisAppLanguage
    var subtitle: String? = nil
    let onToggle: () -> Void
    @ViewBuilder let detail: () -> Detail

    private var symbol: String {
        switch tone {
        case .ok: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .down: "xmark.octagon.fill"
        case .unknown: "questionmark.circle"
        }
    }

    private var tint: Color {
        switch tone {
        case .ok: JarvisDesignTokens.secondaryAccent
        case .degraded: JarvisDesignTokens.primaryAccent
        case .down: .red
        case .unknown: .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: JarvisDesignTokens.rowSpacing) {
                    Image(systemName: symbol)
                        .foregroundStyle(tint)
                        .frame(width: 24)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        Text(title).font(.body).foregroundStyle(.primary).lineLimit(2)
                        if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                        if dynamicTypeSize.isAccessibilitySize {
                            Text(toneTitle).font(.caption.weight(.semibold)).foregroundStyle(tint)
                        }
                    }
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if !dynamicTypeSize.isAccessibilitySize {
                        Text(toneTitle)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(tint)
                            .fixedSize()
                            .layoutPriority(1)
                    }
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 0 : -90))
                        .accessibilityHidden(true)
                }
                .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel([title, subtitle, toneTitle].compactMap { $0 }.joined(separator: ", "))
            .accessibilityValue(isExpanded ? "1" : "0")
            .accessibilityHint(jarvisInsightsText(.statusExpand, language))
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier(identifier)
            if isExpanded {
                detail()
                    .padding(.leading, 34)
                    .padding(.bottom, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .jarvisListRow()
    }
}
