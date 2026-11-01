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

    private var hasCalendarConfirmation: Bool {
        model.nowFeed?.confirmations.contains(where: { $0.actionKind == .calendarChange }) == true
    }

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: appLanguage)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatSheetRowSpacing) {
                    if let error = model.activityError, model.nowFeed == nil {
                        ContentUnavailableView {
                            Label("Activity unavailable", systemImage: "wifi.slash")
                        } description: {
                            Text(error)
                        } actions: {
                            Button("Retry") { Task { await model.refreshActivity() } }
                                .buttonStyle(.glass)
                                .disabled(model.fixtureMode)
                                .accessibilityHint(model.fixtureMode ? "Retry is unavailable with fixture data." : "")
                        }
                    } else if let feed = model.nowFeed {
                        let presentation = model.backgroundPresentation
                        let showsRoutineJobs = kind == .background
                        let hasActivity = !feed.confirmations.isEmpty || !feed.running.isEmpty ||
                            !feed.items.isEmpty || (showsRoutineJobs && !model.backgroundTasks.isEmpty) ||
                            !presentation.actionable.isEmpty || !presentation.quiet.isEmpty
                        if let error = model.activityError {
                            HStack {
                                Text(error)
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                                Spacer()
                                Button("Retry") { Task { await model.refreshActivity() } }
                                    .buttonStyle(.glass)
                                    .disabled(model.fixtureMode)
                                    .accessibilityHint(model.fixtureMode ? "Retry is unavailable with fixture data." : "")
                            }
                        }
                        if let message = model.activityMessage {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .accessibilityAddTraits(.updatesFrequently)
                        }
                        if hasActivity || feed.awayMode {
                            awayModeSection(feed.awayMode)
                        }
                        if !feed.confirmations.isEmpty {
                            confirmationSection(feed.confirmations)
                        }
                        if !feed.running.isEmpty {
                            runningSection(feed.running)
                        }
                        if showsRoutineJobs {
                            if !model.backgroundTasks.isEmpty { backgroundTaskSection }
                        } else if !presentation.actionable.isEmpty {
                            failedTaskSection(presentation.actionable)
                        }
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
                            ContentUnavailableView("No activity", systemImage: "checkmark.circle")
                        }
                    } else {
                        ProgressView("Loading")
                            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                    }
                }
                .padding(JarvisDesignTokens.chatHorizontalInset)
            }
            .scrollIndicators(.visible)
            .refreshable { await model.refreshActivity() }
            .jarvisAmbientBackground()
            .navigationTitle(hasCalendarConfirmation && kind == .needsYou && appLanguage == .da
                             ? "Afventer dig" : kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                            .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                    }
                        .jarvisToolbarButtonStyle()
                        .accessibilityLabel(copy(.done))
                }
            }
        }
        .task {
            await model.refreshActivity()
        }
        .onReceive(NotificationCenter.default.publisher(for: .jarvisApprovalActionCompleted)) { _ in
            Task { await model.refreshActivity() }
        }
    }

    private var backgroundTaskSection: some View {
        let language = appLanguage
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text(JarvisFactoryLocalization.string(.backgroundTask, language: language))
                .font(.headline)
            ForEach(model.backgroundTasks) { task in
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title).font(.body)
                    Text(JarvisFactoryLocalization.string(task.status.localizationKey, language: language))
                        .font(.body)
                        .foregroundStyle(.secondary)
                    if let detail = task.detail {
                        Text(detail).font(.callout).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Divider()
            }
        }
    }

    private func failedTaskSection(_ tasks: [BackgroundTaskRecord]) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text(copy(.needsFailedTitle))
                .font(.headline)
            ForEach(tasks) { task in
                failedTaskRow(task)
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
            VStack(alignment: .leading, spacing: 4) {
                Text(copy(.failedChecksTitle)).font(.headline)
                Text(String(format: copy(.failedChecksSummary), tasks.count))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(JarvisDesignTokens.chatGlassInset)
        .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatBubbleRadius))
    }

    private func failedTaskRow(_ task: BackgroundTaskRecord) -> some View {
        HStack(alignment: .top, spacing: JarvisDesignTokens.chatComposerSpacing) {
            VStack(alignment: .leading, spacing: 4) {
                Text(task.title).font(.body)
                if let detail = task.detail {
                    Text(detail).font(.callout).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            Button(model.dismissingBackgroundTaskIDs.contains(task.id) ? copy(.dismissing) : copy(.dismiss)) {
                Task { await model.dismissBackgroundTask(task) }
            }
            .buttonStyle(.glass)
            .disabled(model.fixtureMode || model.dismissingBackgroundTaskIDs.contains(task.id))
            .accessibilityLabel(String(format: copy(.dismissLabel), task.title))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func confirmationSection(_ confirmations: [PendingConfirmation]) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text(hasCalendarConfirmation && appLanguage == .da ? "Afventer godkendelse" : "Pending confirmations")
                .font(.headline)
                .accessibilityIdentifier("confirmation-section-heading")
            ForEach(confirmations, id: \.id) { confirmation in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(confirmation.actionKind == .calendarChange
                         ? (appLanguage == .da ? "Kalenderændring" : "Calendar change")
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
                        Button {
                            Task { await model.resolve(confirmation, decision: .reject) }
                        } label: {
                            Text(model.resolvingConfirmationIDs.contains(confirmation.id)
                                 ? (appLanguage == .da ? "Sender…" : "Sending…")
                                 : JarvisApprovalLocalization.string(.decline, language: appLanguage))
                                .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget,
                                       minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        }
                        .buttonStyle(.glass)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityIdentifier("confirmation-decline-\(confirmation.id)")
                        .accessibilityHint(model.fixtureMode
                            ? (appLanguage == .da ? "Godkendelse er deaktiveret med eksempeldata." : "Approval actions are disabled with fixture data.")
                            : "")
                        Spacer()
                        Button {
                            Task { await model.resolve(confirmation, decision: .approve) }
                        } label: {
                            Text(model.resolvingConfirmationIDs.contains(confirmation.id)
                                 ? (appLanguage == .da ? "Sender…" : "Sending…")
                                 : JarvisApprovalLocalization.string(.approve, language: appLanguage))
                                .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget,
                                       minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityIdentifier("confirmation-approve-\(confirmation.id)")
                        .accessibilityHint(model.fixtureMode
                            ? (appLanguage == .da ? "Godkendelse er deaktiveret med eksempeldata." : "Approval actions are disabled with fixture data.")
                            : "")
                    }
                    if model.fixtureMode && confirmation.actionKind == .calendarChange {
                        Text(appLanguage == .da
                             ? "Godkendelse er deaktiveret med eksempeldata."
                             : "Approval actions are disabled with fixture data.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("confirmation-fixture-reason")
                    }
                }
                .padding(JarvisDesignTokens.chatGlassInset)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatBubbleRadius))
            }
        }
    }

    private func runningSection(_ tasks: [NowFeedRunningTask]) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text("Running")
                .font(.headline)
            ForEach(tasks, id: \.id) { task in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(task.title)
                        .font(.body.weight(.medium))
                    Text(task.activity)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("\(task.project) · \(task.agent.capitalized)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(JarvisDesignTokens.chatGlassInset)
                .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatBubbleRadius))
            }
        }
    }

    private func awayModeSection(_ isAway: Bool) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text("Away mode")
                .font(.headline)
            Label(isAway ? "On" : "Off", systemImage: isAway ? "moon.fill" : "sun.max")
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(JarvisDesignTokens.chatGlassInset)
                .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatBubbleRadius))
        }
    }

    private func activitySection(
        _ category: NowFeedActivityCategory,
        items: [NowFeedActivityItem]
    ) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text(category.title)
                .font(.headline)
            ForEach(items, id: \.id) { item in
                HStack(alignment: .top, spacing: JarvisDesignTokens.chatComposerSpacing) {
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                        Text(item.title)
                            .font(.body)
                        Text(timeString(item.at))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Button(model.dismissingActivityIDs.contains(item.id) ? "Dismissing…" : "Dismiss") {
                        Task { await model.dismissActivity(item) }
                    }
                    .buttonStyle(.glass)
                    .disabled(model.fixtureMode || model.dismissingActivityIDs.contains(item.id))
                    .accessibilityLabel("Dismiss \(item.title)")
                    .accessibilityHint(model.fixtureMode ? "Dismissal is disabled with fixture data." : "")
                }
                .padding(JarvisDesignTokens.chatGlassInset)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatBubbleRadius))
            }
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

private extension NowFeedActivityCategory {
    var title: String {
        switch self {
        case .attention: "Needs attention"
        case .release: "Releases and deployments"
        case .credential: "Credential warnings"
        case .alert: "Alerts"
        }
    }
}
