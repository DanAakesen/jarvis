import JarvisCore
import SwiftUI

struct JarvisActivitySheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: JarvisChatModel
    let kind: ActivitySheetKind

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
                        let hasActivity = !feed.confirmations.isEmpty || !feed.running.isEmpty || !feed.items.isEmpty
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
                        ForEach(NowFeedActivityCategory.allCases, id: \.self) { category in
                            let items = feed.items.filter { $0.category == category }
                            if !items.isEmpty {
                                activitySection(category, items: items)
                            }
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
            .navigationTitle(kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .jarvisToolbarButtonStyle()
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

    private func confirmationSection(_ confirmations: [PendingConfirmation]) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text("Pending confirmations")
                .font(.headline)
            ForEach(confirmations, id: \.id) { confirmation in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(confirmation.actionKind.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.subheadline.weight(.semibold))
                    Text(confirmation.summary)
                        .font(.body)
                    Text("Expires \(timeString(confirmation.expiresAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button(model.resolvingConfirmationIDs.contains(confirmation.id) ? "Sending…" : "Decline") {
                            Task { await model.resolve(confirmation, decision: .reject) }
                        }
                        .buttonStyle(.glass)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityHint(model.fixtureMode ? "Approval actions are disabled with fixture data." : "")
                        Spacer()
                        Button(model.resolvingConfirmationIDs.contains(confirmation.id) ? "Sending…" : "Approve") {
                            Task { await model.resolve(confirmation, decision: .approve) }
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityHint(model.fixtureMode ? "Approval actions are disabled with fixture data." : "")
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
