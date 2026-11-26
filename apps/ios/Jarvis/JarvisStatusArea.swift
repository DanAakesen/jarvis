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
        .jarvisPageBackground()
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
    }

    private var overview: some View {
        JarvisInsightsCard(title: text(.serviceChecks)) {
            if let snapshot = state.snapshot {
                let healthy = snapshot.entries.filter { JarvisStatusLogic.displayStatus(for: $0, now: now) == .ok }.count
                checkedLine(snapshot)
                Text("\(healthy) / \(snapshot.entries.count) " + text(.healthyChecks))
                    .font(.title.bold())
                if !snapshot.entries.isEmpty {
                    HStack(spacing: 3) {
                        ForEach(snapshot.entries) { entry in
                            let tone = JarvisStatusLogic.displayStatus(for: entry, now: now)
                            Capsule().fill(tone == .ok ? JarvisDesignTokens.secondaryAccent : tone == .unknown ? Color.secondary : Color.red)
                        }
                    }
                    .frame(height: 10).accessibilityHidden(true)
                }
            } else { Text("—").font(.title.bold()) }
        }
        .accessibilityIdentifier("status.hero")
    }

    private func loaded(_ snapshot: JarvisStatusSnapshot) -> some View {
        let entries = JarvisStatusLogic.visible(snapshot.entries, filter: .all, now: now)
        let mirror = snapshot.vaultMirror ?? JarvisVaultMirror(state: .notSetUp, readReason: "status-missing")
        let healthy = entries.filter { JarvisStatusLogic.displayStatus(for: $0, now: now) == .ok }
        let unknown = entries.filter { JarvisStatusLogic.displayStatus(for: $0, now: now) == .unknown }
        let issues = entries.filter { [.down, .degraded].contains(JarvisStatusLogic.displayStatus(for: $0, now: now)) }
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
            if !issues.isEmpty {
                JarvisInsightsCard(title: text(.statusFilterIssues)) { ForEach(issues) { checkRow($0) } }
            }
            if !unknown.isEmpty {
                JarvisInsightsCard(title: text(.unconfirmedChecks)) { ForEach(unknown) { checkRow($0) } }
            }
            if !healthy.isEmpty {
                JarvisInsightsDisclosure(title: text(.healthyChecks) + " · \(healthy.count)") {
                    ForEach(healthy) { checkRow($0) }
                }
            }
            JarvisInsightsDisclosure(title: text(.maintenance)) {
                mirrorRow(mirror)
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
        let tone = JarvisStatusLogic.displayStatus(for: entry, now: now)
        let reason = JarvisStatusLogic.reason(for: entry, now: now)
        let checked = checkedText(entry.checkedAt)
        let evidence = JarvisStatusLogic.detailEvidence(for: entry)
        return JarvisStatusRow(
            title: title,
            tone: tone,
            toneTitle: text(tone.localizationKey),
            isExpanded: expanded.contains(entry.id),
            identifier: "status.row.\(entry.id)",
            language: language,
            subtitle: reasonText(reason) ?? checked
        ) {
            toggle(entry.id)
        } detail: {
            VStack(alignment: .leading, spacing: 6) {
                if reason != nil, let checked {
                    Text(checked)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let evidence {
                    Text(text(.statusEvidence) + ": " + evidence)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(text(tone.localizationKey))
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
        let summary = lastRunText(mirror)
        return JarvisStatusRow(
            title: text(.statusMirror),
            tone: displayState.tone,
            toneTitle: text(displayState.localizationKey),
            isExpanded: expanded.contains("vault-mirror"),
            identifier: "status.row.vault-mirror",
            language: language,
            subtitle: summary
        ) {
            toggle("vault-mirror")
        } detail: {
            VStack(alignment: .leading, spacing: 8) {
                if let lastSuccessAt = mirror.lastSuccessAt.flatMap(JarvisInsightsDates.parse) {
                    let line = JarvisInsightsLocalization.format(
                        .statusMirrorLastSuccess, language: language,
                        JarvisInsightsDates.elapsed(from: lastSuccessAt, now: now, language: language)
                    )
                    if line != summary {
                        Text(line)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                if let outcome = mirror.outcome {
                    Text(text(.statusMirrorLastOutcome) + ": " + JarvisStatusLogic.readable(outcome))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let reasons = mirror.guardReasons, !reasons.isEmpty {
                    Text(reasons.map(mirrorGuardReasonText).joined(separator: " "))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let changedOnGitHub = mirror.changedOnGitHub {
                    Text(text(.statusMirrorChangedGitHub) + ": \(changedOnGitHub)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let changedOnObsidian = mirror.changedOnObsidian {
                    Text(text(.statusMirrorChangedObsidian) + ": \(changedOnObsidian)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let deletedOnGitHub = mirror.deletedOnGitHub {
                    Text(text(.statusMirrorDeletedGitHub) + ": \(deletedOnGitHub)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let deletedOnObsidian = mirror.deletedOnObsidian {
                    Text(text(.statusMirrorDeletedObsidian) + ": \(deletedOnObsidian)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let deferredOnGitHub = mirror.deferredOnGitHub {
                    Text(text(.statusMirrorDeferredGitHub) + ": \(deferredOnGitHub)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let deferredOnObsidian = mirror.deferredOnObsidian {
                    Text(text(.statusMirrorDeferredObsidian) + ": \(deferredOnObsidian)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
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

    private func lastRunText(_ mirror: JarvisVaultMirror) -> String {
        let deferred = (mirror.deferredOnGitHub ?? 0) + (mirror.deferredOnObsidian ?? 0)
        let withDeferred = { (base: String) in
            deferred > 0 ? base + " · \(deferred) deferred to next run" : base
        }
        guard let last = mirror.lastRunAt.flatMap(JarvisInsightsDates.parse) else {
            if let readReason = mirror.readReason { return mirrorReadReasonText(readReason) }
            return withDeferred(lastSuccessText(mirror))
        }
        return withDeferred(JarvisInsightsLocalization.format(
            .statusMirrorLastRun,
            language: language,
            JarvisInsightsDates.elapsed(from: last, now: now, language: language)
        ))
    }

    private func mirrorReadReasonText(_ reason: String) -> String {
        switch reason {
        case "backend-not-configured":
            "The backend has no mirror status reader configured; the job's existence is not established."
        case "status-missing":
            "No mirror status document has been received; the job's existence is not established."
        case "access-denied":
            "The backend identity could not read the private mirror status."
        case "timed-out":
            "The mirror status read timed out."
        case "invalid":
            "The mirror status document is invalid."
        default:
            "The mirror status document could not be read."
        }
    }

    private func mirrorGuardReasonText(_ reason: String) -> String {
        switch reason {
        case "max-changed-G": "The per-run cap would be exceeded by changes to GitHub."
        case "max-changed-O": "The per-run cap would be exceeded by changes to Obsidian."
        case "max-deletes-G": "The delete cap would be exceeded in GitHub."
        case "max-deletes-O": "The delete cap would be exceeded in Obsidian."
        case "base-deletion-ratio": "The delete ratio safety limit was exceeded."
        case "empty-side": "One complete side appears empty while the other has notes."
        case "missing-base-O": "Obsidian is missing too much of the recorded base."
        case "missing-base-G": "GitHub is missing too much of the recorded base."
        default: "The planner rejected an invalid input."
        }
    }

    private func checkedText(_ timestamp: String) -> String? {
        guard let date = JarvisInsightsDates.parse(timestamp) else { return nil }
        return JarvisInsightsLocalization.format(.statusChecked, language: language,
            JarvisInsightsDates.format(date, language: language, dateStyle: .none, timeStyle: .short))
    }

    private func smokeRow(_ smoke: JarvisStatusSmoke?) -> some View {
        let tone = JarvisStatusLogic.smokeStatus(smoke, now: now)
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
                }
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
