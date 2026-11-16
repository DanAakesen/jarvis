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
    @State private var brain: PiBrainStatus?
    @State private var isBrainLoading = false
    @State private var brainFailed = false

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
        Group {
            engineSection
            brainSection
        }
    }

    private var engineSection: some View {
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

    private var brainSection: some View {
        Section {
            Toggle(copy(.brainToggle), isOn: Binding(
                get: { brain?.enabled ?? false },
                set: { newValue in Task { await setBrain(newValue) } }
            ))
            .disabled(client == nil || isBrainLoading || brain?.available != true)
            .accessibilityIdentifier("settings.piBrain.toggle")
            brainRows
            JarvisLabelledButton(
                title: copy(.brainRefresh),
                systemImage: "arrow.clockwise",
                identifier: "settings.piBrain.refresh",
                isBusy: isBrainLoading,
                isDisabled: client == nil
            ) { Task { await loadBrain() } }
        } header: {
            JarvisSectionHeadline(copy(.brainTitle))
        } footer: {
            Text(copy(.brainExplanation))
        }
        .textCase(nil)
        .task { await loadBrain() }
    }

    @ViewBuilder
    private var brainRows: some View {
        if let brain {
            LabeledContent(copy(.brainStatusLabel)) { Text(brainStatusText(brain)) }
            LabeledContent(copy(.brainBudgetLabel)) {
                Text(String(format: copy(.brainBudgetFormat), amount(brain.budget.spentDkk), amount(brain.budget.limitDkk)))
                    .fontWeight(.semibold)
                    .foregroundStyle(brain.budget.state == "exhausted" ? Color.red : Color.primary)
            }
            if brain.budget.state == "warn" { Text(copy(.brainBudgetWarn)).foregroundStyle(.secondary) }
            if brain.budget.state == "exhausted" { Text(copy(.brainBudgetExhausted)).foregroundStyle(.red) }
            LabeledContent(copy(.brainMonthLabel)) {
                Text(String(format: copy(.brainMonthFormat), String(brain.month.wakes), amount(brain.month.costDkk)))
            }
            LabeledContent(copy(.brainTodayLabel)) { Text(String(brain.today.messages)) }
            if let wake = brain.lastWake {
                LabeledContent(copy(.brainLastWakeLabel)) {
                    Text("\(wake.outcome), \(wake.totalMs) ms, \(dkk(wake.costDkk))")
                }
            } else {
                LabeledContent(copy(.brainLastWakeLabel)) { Text(copy(.brainNoWake)) }
            }
            if brain.logPending > 0 {
                LabeledContent(copy(.brainLogPending)) { Text(String(brain.logPending)) }
            }
        }
        if isBrainLoading {
            JarvisLoadingView(title: copy(.engineStatusLoading), size: .inline)
        } else if brainFailed {
            Text(copy(.brainFailed)).foregroundStyle(.red)
        } else if client == nil {
            Text(copy(.engineStatusUnavailable)).foregroundStyle(.secondary)
        }
    }

    private func brainStatusText(_ brain: PiBrainStatus) -> String {
        if !brain.available { return copy(.brainUnavailable) }
        if brain.paused { return copy(.brainPaused) }
        return copy(brain.enabled ? .brainOn : .brainOff)
    }

    private func loadBrain() async {
        guard let client else { return }
        isBrainLoading = true
        brainFailed = false
        do {
            brain = try await client.piBrainStatus()
        } catch {
            if !Task.isCancelled { brainFailed = true }
        }
        isBrainLoading = false
    }

    private func setBrain(_ enabled: Bool) async {
        guard let client else { return }
        isBrainLoading = true
        brainFailed = false
        do {
            brain = try await client.setPiBrain(enabled: enabled)
        } catch {
            if !Task.isCancelled { brainFailed = true }
        }
        isBrainLoading = false
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
            LabeledContent(copy(.engineCapLabel)) { Text(dkk(status.month.capDkk)) }
            LabeledContent(copy(.engineRemainingLabel)) {
                Text(dkk(status.month.remaining))
                    .fontWeight(.semibold)
                    .foregroundStyle(status.month.remaining <= 0 ? Color.red : Color.primary)
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
        String(format: copy(.engineMonthFormat), amount(month.spentDkk), String(month.turns))
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
        String(format: copy(.engineDkkFormat), amount(value))
    }
}
