import JarvisCore
import SwiftUI

/// TEST-ONLY settings section for the chat engine switch. Delete this file and its single use in
/// `JarvisSettingsArea` at cutover. The choice is stored on this device and affects Chat only.
struct JarvisChatEngineTestSection: View {
    /// Nil when no live backend is available (fixture previews); the status then explains it instead of inventing data.
    let client: JarvisChatClient?

    @AppStorage(ChatEngineSelection.key) private var engine: ChatEngine = .current
    @State private var status: PiStatus?
    @State private var isLoading = false
    @State private var failed = false

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: .default)
    }

    private var items: [JarvisTabItem<ChatEngine>] {
        [
            JarvisTabItem(tag: .current, title: copy(.engineCurrent), identifier: "settings.chatEngine.current"),
            JarvisTabItem(tag: .pi, title: copy(.enginePi), identifier: "settings.chatEngine.pi"),
        ]
    }

    var body: some View {
        Section {
            JarvisSegmentedBar(
                title: copy(.engineChoiceLabel),
                identifierPrefix: "settings.chatEngine",
                items: items,
                selection: $engine
            )
            .listRowBackground(Color.clear)
            .task(id: engine) {
                if engine == .pi { await load() }
            }
            if engine == .pi { statusRows }
        } header: {
            JarvisSectionHeadline(copy(.engineTitle))
        } footer: {
            Text(copy(.engineExplanation))
        }
        .textCase(nil)
    }

    @ViewBuilder
    private var statusRows: some View {
        if let status {
            LabeledContent(copy(.engineStatusLabel)) { Text(statusText(status)) }
            LabeledContent(copy(.engineAgentLabel)) {
                Text([status.agent.name, status.agent.model, status.agent.effort]
                    .compactMap { $0 }
                    .joined(separator: ", "))
            }
            LabeledContent(copy(.engineMonthLabel)) { Text(monthText(status.month)) }
            LabeledContent(copy(.engineWarmLabel)) {
                Text(copy(status.warm.isWarm ? .engineWarm : .engineCold))
            }
            if let turn = status.lastTurn {
                LabeledContent(copy(.engineFirstTextLabel)) {
                    Text(turn.firstTextMs.map { "\($0) ms" } ?? "-")
                }
                LabeledContent(copy(.engineTokensLabel)) { Text(tokensText(turn)) }
                LabeledContent(copy(.engineCostLabel)) { Text(dkk(turn.costDkk)) }
            } else {
                LabeledContent(copy(.engineLastTurnLabel)) { Text(copy(.engineNoTurn)) }
            }
        }
        if isLoading {
            JarvisLoadingView(title: copy(.engineStatusLoading), size: .inline)
        } else if failed {
            Text(copy(.engineStatusFailed))
                .foregroundStyle(.red)
        } else if client == nil {
            Text(copy(.engineStatusUnavailable))
                .foregroundStyle(.secondary)
        }
        JarvisLabelledButton(
            title: copy(.engineStatusRefresh),
            systemImage: "arrow.clockwise",
            identifier: "settings.chatEngine.refresh",
            isBusy: isLoading,
            isDisabled: client == nil
        ) { Task { await load() } }
    }

    private func load() async {
        guard let client else { return }
        isLoading = true
        failed = false
        do {
            status = try await client.piStatus()
        } catch {
            if !Task.isCancelled { failed = true }
        }
        isLoading = false
    }

    private func statusText(_ status: PiStatus) -> String {
        if status.enabled { return copy(.engineStatusReady) }
        switch status.reason {
        case "not_configured": return copy(.engineStatusNotConfigured)
        case "budget_exhausted": return copy(.engineStatusBudgetExhausted)
        default: return copy(.engineStatusDisabled)
        }
    }

    private func monthText(_ month: PiStatus.Month) -> String {
        String(format: copy(.engineMonthFormat), amount(month.spentDkk), amount(month.capDkk), String(month.turns))
    }

    private func tokensText(_ turn: PiStatus.LastTurn) -> String {
        String(
            format: copy(.engineTokensFormat),
            String(turn.inputTokens), String(turn.cachedTokens), String(turn.outputTokens)
        )
    }

    private func amount(_ value: Double) -> String {
        String(format: "%.2f", value)
    }

    private func dkk(_ value: Double) -> String {
        amount(value) + " DKK"
    }
}
