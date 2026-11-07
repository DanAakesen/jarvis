import JarvisCore
import SwiftUI

struct JarvisActivitySheet: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @ObservedObject var model: JarvisChatModel
    let kind: ActivitySheetKind

    private var appLanguage: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: appLanguage)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatSheetRowSpacing) {
                    if let error = model.activityError, model.nowFeed == nil {
                        ContentUnavailableView {
                            Label(copy(.activityUnavailable), systemImage: "wifi.slash")
                        } description: {
                            Text(error)
                        } actions: {
                            JarvisIconButton(
                                title: copy(.activityRetry),
                                systemImage: "arrow.clockwise",
                                identifier: "activity.retry"
                            ) { Task { await model.refreshActivity() } }
                        }
                    } else if let feed = model.nowFeed {
                        let presentation = model.backgroundPresentation
                        let hasActivity = model.shouldShowNowBar
                        if let error = model.activityError {
                            HStack {
                                Text(error)
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                                Spacer()
                                JarvisIconButton(
                                    title: copy(.activityRetry),
                                    systemImage: "arrow.clockwise",
                                    identifier: "activity.retry"
                                ) { Task { await model.refreshActivity() } }
                            }
                        }
                        if let message = model.activityMessage {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .accessibilityAddTraits(.updatesFrequently)
                        }
                        pageHead(feed)
                        if !feed.confirmations.isEmpty {
                            confirmationSection(feed.confirmations)
                        }
                        if !feed.running.isEmpty {
                            runningSection(feed.running)
                        }
                        if !presentation.actionable.isEmpty {
                            failedTaskSection(presentation.actionable)
                        }
                        if !presentation.running.isEmpty { backgroundTaskSection }
                        ForEach(NowFeedActivityCategory.allCases, id: \.self) { category in
                            let items = feed.items.filter { $0.category == category }
                            if !items.isEmpty {
                                activitySection(category, items: items)
                            }
                        }
                        if !presentation.quiet.isEmpty {
                            quietFailureGroup(presentation.quiet)
                        }
                        if !hasActivity {
                            ContentUnavailableView(copy(.activityEmpty), systemImage: "checkmark.circle")
                        }
                    } else {
                        JarvisPageLoadingView(title: copy(.activityLoading), identifier: "notifications.loading")
                    }
                }
                .padding(JarvisDesignTokens.chatHorizontalInset)
            }
            .scrollIndicators(.visible)
            .refreshable { await model.refreshActivity() }
            .jarvisPageHeader { header }
            }
            .jarvisAmbientBackground()
            .toolbar(.hidden, for: .navigationBar)
        }
        .task {
            await model.refreshActivity()
        }
        .onReceive(NotificationCenter.default.publisher(for: .jarvisApprovalActionCompleted)) { _ in
            Task { await model.refreshActivity() }
        }
    }

    /// Title level with the shared glass buttons, inside the content so the sheet has one background and the
    /// close button sits centred in its own circle rather than in a second toolbar capsule.
    private var header: some View {
        HStack(alignment: .center, spacing: JarvisPageHeaderMetrics.spacing) {
            Text(copy(.activityTitle))
                .font(.system(size: JarvisPageHeaderMetrics.titleSize, weight: .bold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: JarvisPageHeaderMetrics.actionSize, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("page.title")
            HStack(spacing: JarvisPageHeaderMetrics.actionSpacing) {
                if let items = model.nowFeed?.items, !items.isEmpty {
                    JarvisIconButton(
                        title: copy(.clearAll),
                        systemImage: "trash",
                        identifier: "activity.clearAll",
                        isDisabled: !model.dismissingActivityIDs.isEmpty
                    ) { Task { await model.dismissActivities(items) } }
                }
                JarvisIconButton(
                    title: copy(.done),
                    systemImage: "xmark",
                    identifier: "chat.notifications.done"
                ) { dismiss() }
            }
        }
        .padding(.horizontal, JarvisPageHeaderMetrics.inset)
        .padding(.vertical, JarvisPageHeaderMetrics.actionSpacing)
    }

    /// The data headline and hero under the title; nothing shows until the feed has loaded.
    private func pageHead(_ feed: JarvisNowFeed) -> some View {
        VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
            JarvisPageHeadline(phrase: JarvisNotificationsPagePhrase.make(
                needsYou: feed.confirmations.count + model.backgroundPresentation.actionable.count,
                running: feed.running.count + model.backgroundPresentation.running.count,
                updates: feed.items.count,
                language: appLanguage
            ))
            JarvisPageHeroCard(title: copy(.activityOverview)) {
                JarvisPageStatGrid(
                    stats: [
                        JarvisPageStat(id: "needs", value: feed.confirmations.count + model.backgroundPresentation.actionable.count, label: copy(.activityNeedsYou), systemImage: "bell", tint: JarvisDesignTokens.primaryAccent),
                        JarvisPageStat(id: "running", value: feed.running.count + model.backgroundPresentation.running.count, label: copy(.activityRunning), systemImage: "bolt", tint: JarvisDesignTokens.primaryAccent),
                        JarvisPageStat(id: "updates", value: feed.items.count, label: copy(.activityUpdates), systemImage: "tray"),
                    ],
                    language: appLanguage
                )
            }
            .accessibilityIdentifier("notifications.hero")
        }
    }

    private var backgroundTaskSection: some View {
        let language = appLanguage
        let tasks = model.backgroundPresentation.running
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            JarvisSectionHeadline(JarvisFactoryLocalization.string(.backgroundTask, language: language))
            JarvisRowGroup {
                ForEach(tasks) { task in
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        Text(task.title).font(.body)
                        if let detail = task.detail { Text(detail).font(.footnote).foregroundStyle(.secondary) }
                    }
                    .jarvisListRow(separator: task.id != tasks.last?.id)
                }
            }
        }
    }

    private func failedTaskSection(_ tasks: [BackgroundTaskRecord]) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            JarvisSectionHeadline(copy(.needsFailedTitle))
            JarvisRowGroup {
                ForEach(tasks) { task in failedTaskRow(task).jarvisListRow(separator: task.id != tasks.last?.id) }
            }
        }
    }

    private func quietFailureGroup(_ tasks: [BackgroundTaskRecord]) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                ForEach(tasks) { task in
                    failedTaskRow(task)
                }
            }
            .padding(.top, JarvisDesignTokens.chatMessageSpacing)
        } label: {
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                Text(copy(.failedChecksTitle)).font(.headline)
                Text(String(format: copy(.failedChecksSummary), tasks.count))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(JarvisDesignTokens.chatGlassInset)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.chatBubbleRadius)
    }

    private func failedTaskRow(_ task: BackgroundTaskRecord) -> some View {
        HStack(alignment: .center, spacing: JarvisDesignTokens.chatComposerSpacing) {
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                Text(task.title).font(.body)
                if let detail = task.detail {
                    Text(detail).font(.callout).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            JarvisLabelledButton(
                title: model.dismissingBackgroundTaskIDs.contains(task.id) ? copy(.dismissing) : copy(.dismiss),
                isDisabled: model.fixtureMode || model.dismissingBackgroundTaskIDs.contains(task.id),
                accessibilityTitle: String(format: copy(.dismissLabel), task.title)
            ) {
                Task { await model.dismissBackgroundTask(task) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisSwipeToDismiss(
            label: String(format: copy(.dismissLabel), task.title),
            isEnabled: !model.fixtureMode && !model.dismissingBackgroundTaskIDs.contains(task.id)
        ) { Task { await model.dismissBackgroundTask(task) } }
    }

    private func confirmationSection(_ confirmations: [PendingConfirmation]) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            JarvisSectionHeadline(copy(.activityPending))
                .accessibilityIdentifier("confirmation-section-heading")
            ForEach(confirmations, id: \.id) { confirmation in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(confirmation.actionKind == .calendarChange
                         ? copy(.activityCalendarChange)
                         : confirmation.actionKind.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("confirmation-kind-\(confirmation.id)")
                    Text(confirmation.summary)
                        .font(.body)
                        .accessibilityIdentifier("confirmation-review-\(confirmation.id)")
                    Text(String(format: JarvisApprovalLocalization.string(.expires, language: appLanguage),
                                timeString(confirmation.expiresAt)))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("confirmation-expiry-\(confirmation.id)")
                    HStack {
                        JarvisLabelledButton(
                            title: model.isResolving(confirmation, decision: .reject)
                                ? JarvisApprovalLocalization.string(.sending, language: appLanguage)
                                : JarvisApprovalLocalization.string(.decline, language: appLanguage),
                            identifier: "confirmation-decline-\(confirmation.id)",
                            isDisabled: model.fixtureMode || model.isResolving(confirmation),
                            hint: model.fixtureMode
                                ? copy(.activityFixtureApproval)
                                : ""
                        ) {
                            Task { await model.resolve(confirmation, decision: .reject) }
                        }
                        Spacer()
                        JarvisLabelledButton(
                            title: model.isResolving(confirmation, decision: .approve)
                                ? JarvisApprovalLocalization.string(.sending, language: appLanguage)
                                : JarvisApprovalLocalization.string(.approve, language: appLanguage),
                            identifier: "confirmation-approve-\(confirmation.id)",
                            isDisabled: model.fixtureMode || model.isResolving(confirmation),
                            hint: model.fixtureMode
                                ? copy(.activityFixtureApproval)
                                : ""
                        ) {
                            Task { await model.resolve(confirmation, decision: .approve) }
                        }
                    }
                    if model.fixtureMode && confirmation.actionKind == .calendarChange {
                        Text(copy(.activityFixtureApproval))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("confirmation-fixture-reason")
                    }
                }
                .padding(JarvisDesignTokens.chatGlassInset)
                .frame(maxWidth: .infinity, alignment: .leading)
                .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.chatBubbleRadius)
            }
        }
    }

    private func runningSection(_ tasks: [NowFeedRunningTask]) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            JarvisSectionHeadline(copy(.activityRunning))
            JarvisRowGroup {
                ForEach(tasks, id: \.id) { task in
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        Text(task.title).font(.body.weight(.medium))
                        Text(task.activity).font(.subheadline).foregroundStyle(.secondary)
                        Text("\(task.project) · \(task.agent.capitalized)").font(.caption).foregroundStyle(.secondary)
                    }
                    .jarvisListRow(separator: task.id != tasks.last?.id)
                }
            }
        }
    }

    /// One row per category: the latest update, a count of older ones, and a disclosure for the rest. The older
    /// items load lazily so a list of 100 stays cheap, and the group can be cleared with one control.
    private func activitySection(
        _ category: NowFeedActivityCategory,
        items: [NowFeedActivityItem]
    ) -> some View {
        let group = NowFeedActivityGrouping.groups(items).first
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            JarvisSectionHeadline(title(for: category))
            if let group { JarvisRowGroup { groupRow(group) } }
        }
    }

    private func groupRow(_ group: NowFeedActivityGroup) -> some View {
        let busy = group.items.contains { model.dismissingActivityIDs.contains($0.id) }
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            HStack(alignment: .center, spacing: JarvisDesignTokens.chatComposerSpacing) {
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    Text(group.latest.title).font(.body)
                    HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                        Text(timeString(group.latest.at))
                        if group.olderCount > 0 {
                            Text(String(format: copy(.groupMore), group.olderCount))
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if busy {
                    JarvisLoadingView()
                } else if group.olderCount > 0 {
                    JarvisIconButton(
                        title: String(format: copy(.clearGroupLabel), title(for: group.category)),
                        systemImage: "trash",
                        identifier: "activity.clear.\(group.id)"
                    ) { Task { await model.dismissActivities(group.items) } }
                } else {
                    JarvisIconButton(
                        title: String(format: copy(.dismissLabel), group.latest.title),
                        systemImage: "xmark",
                        identifier: "activity.dismiss.\(group.latest.id)"
                    ) { Task { await model.dismissActivity(group.latest) } }
                }
            }
            if group.olderCount > 0 {
                DisclosureGroup {
                    LazyVStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                        ForEach(group.items.dropFirst(), id: \.id) { item in
                            HStack(alignment: .center) {
                                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                                    Text(item.title).font(.callout)
                                    Text(timeString(item.at)).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                JarvisIconButton(
                                    title: String(format: copy(.dismissLabel), item.title),
                                    systemImage: "xmark",
                                    identifier: "activity.dismiss.\(item.id)",
                                    isDisabled: model.fixtureMode || model.dismissingActivityIDs.contains(item.id)
                                ) { Task { await model.dismissActivity(item) } }
                            }
                        }
                    }
                    .padding(.top, JarvisDesignTokens.chatMessageSpacing)
                } label: {
                    Text(String(format: copy(.groupMore), group.olderCount))
                }
            }
        }
        .jarvisListRow(separator: false)
        .jarvisSwipeToDismiss(
            label: String(format: copy(group.olderCount > 0 ? .clearGroupLabel : .dismissLabel),
                          group.olderCount > 0 ? title(for: group.category) : group.latest.title),
            isEnabled: !model.fixtureMode && !busy
        ) {
            if group.olderCount > 0 {
                Task { await model.dismissActivities(group.items) }
            } else {
                Task { await model.dismissActivity(group.latest) }
            }
        }
    }

    private func title(for category: NowFeedActivityCategory) -> String {
        switch category {
        case .attention: copy(.activityAttention)
        case .release: copy(.activityRelease)
        case .credential: copy(.activityCredential)
        case .alert: copy(.activityAlert)
        }
    }

    private func timeString(_ value: String) -> String {
        var parser = ISO8601DateFormatter()
        let date = parser.date(from: value) ?? {
            parser.formatOptions.insert(.withFractionalSeconds)
            return parser.date(from: value)
        }()
        guard let date else { return value }
        return DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .short)
    }
}

/// Swipe a row to the left to dismiss it. VoiceOver gets the same action by name, and the row snaps back when the
/// drag is short or mostly vertical, so it never fights the page scroll. HIG: Gestures, Lists (swipe actions).
private struct JarvisSwipeToDismiss: ViewModifier {
    let label: String
    let isEnabled: Bool
    let action: () -> Void
    @State private var offset: CGFloat = 0
    private let threshold: CGFloat = 96

    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .opacity(1 - min(abs(offset) / (threshold * 3), 0.4))
            .simultaneousGesture(
                DragGesture(minimumDistance: 24)
                    .onChanged { value in
                        guard isEnabled, abs(value.translation.width) > abs(value.translation.height) else { return }
                        offset = min(0, value.translation.width)
                    }
                    .onEnded { value in
                        let commit = isEnabled && value.translation.width < -threshold
                            && abs(value.translation.width) > abs(value.translation.height)
                        withAnimation(.snappy) { offset = 0 }
                        if commit { action() }
                    }
            )
            .accessibilityAction(named: label) { if isEnabled { action() } }
    }
}

private extension View {
    func jarvisSwipeToDismiss(label: String, isEnabled: Bool, perform action: @escaping () -> Void) -> some View {
        modifier(JarvisSwipeToDismiss(label: label, isEnabled: isEnabled, action: action))
    }
}
