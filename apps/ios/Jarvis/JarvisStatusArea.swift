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
            JarvisPageHeader(
                title: JarvisDestination.status.localizedTitle(language: language),
                language: language
            )
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                    if let snapshot = state.snapshot {
                        JarvisPageHeadline(phrase: JarvisStatusPagePhrase.make(snapshot, language: language))
                    }
                    JarvisTabStrip(
                        title: text(.statusFilterLabel),
                        identifierPrefix: "status.filter",
                        items: JarvisStatusFilter.allCases.map { JarvisTabItem(tag: $0, title: text($0.localizationKey)) },
                        selection: $filter
                    )
                    content
                }
                    .padding(.horizontal)
                    .padding(.bottom, JarvisDesignTokens.healthSectionSpacing)
            }
            .refreshable { await refresh() }
            .accessibilityIdentifier("status.scroll")
        }
        .jarvisAmbientBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: reloadToken) { await refresh() }
        .task { await keepClockFresh() }
    }

    private func refresh() async {
        guard let client else {
            state = JarvisStatusViewState(snapshot: state.snapshot, failure: .notConfigured, isLoading: false)
            return
        }
        state.begin()
        do {
            let snapshot = try await client.snapshot()
            if Task.isCancelled { return }
            tick = Date()
            state.succeeded(snapshot)
        } catch {
            if Task.isCancelled { return }
            state.failed(error)
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
    }

    private func loaded(_ snapshot: JarvisStatusSnapshot) -> some View {
        let entries = JarvisStatusLogic.visible(snapshot.entries, filter: filter)
        let mirror = snapshot.vaultMirror
        let showMirror = mirror.map { filter == .all || $0.displayState(now: now).tone != .ok } ?? false
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            checkedLine(snapshot)
            if state.isPartial, let failure = state.failure {
                JarvisInsightsBadge(
                    title: text(.statusPartial) + " · " + text(failure.localizationKey),
                    systemImage: "exclamationmark.arrow.circlepath",
                    tint: JarvisDesignTokens.primaryAccent
                )
                .accessibilityIdentifier("status.partial")
            }
            if entries.isEmpty && !showMirror {
                JarvisInsightsCard {
                    JarvisInsightsStateView(
                        kind: .empty,
                        emptyTitle: text(.statusNoIssues),
                        language: language,
                        identifier: "status.empty"
                    )
                }
            } else {
                JarvisInsightsCard {
                    VStack(spacing: 0) {
                        if let mirror, showMirror { mirrorRow(mirror) }
                        ForEach(entries) { entry in checkRow(entry) }
                    }
                }
            }
            smokeCard(snapshot.smoke)
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
            language: language
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
            language: language
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

    private func smokeCard(_ smoke: JarvisStatusSmoke?) -> some View {
        JarvisInsightsCard(title: text(.statusSmoke)) {
            if let smoke {
                let allOK = smoke.okCount == smoke.entries.count
                HStack(spacing: 8) {
                    Image(systemName: allOK ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(allOK ? JarvisDesignTokens.secondaryAccent : JarvisDesignTokens.primaryAccent)
                        .accessibilityHidden(true)
                    Text(
                        JarvisInsightsLocalization.format(
                            .statusSmokeSummary, language: language, smoke.okCount, smoke.entries.count
                        )
                    )
                    .font(.subheadline)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("status.smoke")
            } else {
                Text(text(.statusSmokeNone))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("status.smoke")
            }
        }
    }
}

/// One expandable row. The whole header is the button; the sentence under it appears when it is open.
private struct JarvisStatusRow<Detail: View>: View {
    let title: String
    let tone: JarvisStatusValue
    let toneTitle: String
    let isExpanded: Bool
    let identifier: String
    let language: JarvisAppLanguage
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
                HStack(spacing: 10) {
                    Image(systemName: symbol)
                        .foregroundStyle(tint)
                        .frame(width: 24)
                        .accessibilityHidden(true)
                    Text(title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                        .layoutPriority(1)
                    Spacer(minLength: 8)
                    Text(toneTitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(2)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        .accessibilityHidden(true)
                }
                .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title + ", " + toneTitle)
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
    }
}
