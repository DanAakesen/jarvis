import JarvisCore
import SwiftUI

/// One draft and one revision for all editable sections. A failed write keeps the draft.
struct JarvisProactiveInlineSettings<Review: View>: View {
    let client: JarvisProactiveClient?
    let language: JarvisAppLanguage
    let status: JarvisProactiveStatus?
    let sourceLine: (JarvisProactiveSourceStatus) -> String
    let onSaved: () -> Void

    @ViewBuilder let review: () -> Review
    @State private var load: JarvisInsightsLoad<Void> = .loading
    @State private var editor: JarvisProactiveSettingsEditor?
    @State private var loadToken = 0
    @State private var saveToken = 0
    @State private var pendingPatch: JarvisProactiveSettingsPatch?
    @State private var savingSection: JarvisInsightsLocalizationKey?
    @State private var newFeed = ""

    private func text(_ key: JarvisInsightsLocalizationKey) -> String {
        jarvisInsightsText(key, language)
    }

    private var isSaving: Bool { editor?.state == .saving }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthSectionSpacing) {
            JarvisInsightsCard(title: text(.reviewsTitle)) {
                JarvisProactiveSettingsRow(client: client, language: language, readOnly: false, onFailure: { _ in })
                review()
                if editor != nil { scopeControl } else { stateView }
            }
            if editor != nil { sections }
        }
        .environment(\.locale, language.locale)
        .tint(JarvisDesignTokens.primaryAccent)
        .task(id: loadToken) { await loadSettings() }
        .task(id: saveToken) { await performSave() }
    }

    // MARK: Loading and saving

    private func loadSettings() async {
        guard let client else {
            load = .failed(.notConfigured)
            return
        }
        load = .loading
        do {
            let loadedSettings = try await client.settings()
            if Task.isCancelled { return }
            editor = JarvisProactiveSettingsEditor(settings: loadedSettings)
            load = .loaded(())
        } catch {
            if Task.isCancelled { return }
            load = .failed(JarvisInsightsFailure(error))
        }
    }

    private func save() {
        guard var current = editor, let patch = current.beginSave() else { return }
        editor = current
        pendingPatch = patch
        saveToken += 1
    }

    private func performSave() async {
        guard let patch = pendingPatch, let client else { return }
        pendingPatch = nil
        do {
            let settings = try await client.updateSettings(patch)
            editor?.saveSucceeded(settings)
            onSaved()
        } catch {
            if Task.isCancelled { return }
            if JarvisInsightsFailure(error) == .conflict, let latest = try? await client.settings() {
                editor?.rebase(onto: latest)
            }
            editor?.saveFailed(error)
        }
    }

    @ViewBuilder private var stateView: some View {
        switch load {
        case .failed(let failure):
            JarvisInsightsStateView(kind: .failure(failure), language: language, identifier: "proactive.edit.error") {
                loadToken += 1
            }
        default:
            JarvisInsightsStateView(kind: .loading, language: language, identifier: "proactive.edit.loading")
        }
    }

    // MARK: Form

    private var scopeControl: some View {
        VStack(alignment: .leading) {
            JarvisTabStrip(
                title: text(.editorScope),
                identifierPrefix: "proactive.edit.scope",
                items: JarvisProactiveScope.allCases.map { JarvisTabItem(tag: Optional($0), title: text($0.localizationKey)) },
                selection: Binding(
                    get: { editor?.draft.scope },
                    set: { if let value = $0 { editor?.draft.scope = value } }
                )
            )
            .disabled(editor == nil)
            .accessibilityHint(editor == nil ? pendingText : "")

            saveControl(.editorScope)
        }.disabled(isSaving)
    }

    @ViewBuilder private var sections: some View {
        JarvisInsightsDisclosure(title: text(.editorSources)) {
            ForEach(JarvisProactiveSourceID.allCases) { id in
                if editor != nil {
                    Toggle(isOn: sourceBinding(id)) {
                        VStack(alignment: .leading) {
                            Text(text(id.localizationKey))
                            if let source = status?.sources.first(where: { $0.id == id }) {
                                Text(sourceLine(source)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        .accessibilityIdentifier("proactive.edit.source.\(id.rawValue)")
                } else { pendingValue(text(id.localizationKey)) }
            }

            saveControl(.editorSources)
        }.disabled(isSaving)
        JarvisInsightsDisclosure(title: text(.budgetLimits)) {
            if editor != nil {
                HStack {
                    Text(text(.editorBudget))
                    Spacer(minLength: 0)
                    Text("\(budgetValue)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Slider(value: budgetSlider, in: Double(JarvisProactiveLimits.budgetRange.lowerBound)...Double(JarvisProactiveLimits.budgetRange.upperBound), step: 10)
                    .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                    .accessibilityLabel(text(.editorBudget))
                    .accessibilityValue("\(budgetValue)")
                    .accessibilityIdentifier("proactive.edit.budget")
                if editor?.draft.budget == nil {
                    issue(.budgetOutOfRange)
                }
            } else { pendingValue(text(.editorBudget)) }
            if editor != nil {
                HStack {
                    Text(text(.editorBackgroundTurns))
                    Spacer(minLength: 0)
                    Text("\(backgroundTurns)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Slider(
                    value: Binding(
                        get: { Double(backgroundTurns) },
                        set: { editor?.draft.backgroundTurnsPerDay = Int($0.rounded()) }
                    ),
                    in: Double(JarvisProactiveLimits.backgroundTurnsRange.lowerBound)...Double(JarvisProactiveLimits.backgroundTurnsRange.upperBound),
                    step: 1
                )
                    .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                    .accessibilityLabel(text(.editorBackgroundTurns))
                    .accessibilityIdentifier("proactive.edit.backgroundTurns")
            } else { pendingValue(text(.editorBackgroundTurns)) }
            if let budget = status?.budget {
                Text(JarvisInsightsLocalization.format(.proactiveBudgetSpend, language: language,
                    budget.estimatedSpendDkk.formatted() + " DKK", budget.monthlyLimitDkk.formatted() + " DKK"))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let today = status?.background?.today {
                Text(JarvisInsightsLocalization.format(.proactiveTurnsToday, language: language,
                    today.usedTurns, today.allowedTurns)).font(.footnote).foregroundStyle(.secondary)
            }

            saveControl(.budgetLimits)
        }.disabled(isSaving)
        JarvisInsightsDisclosure(title: text(.editorFeeds)) {
            if editor == nil { pendingValue(text(.editorFeeds)) }
            ForEach(Array(feedRows.enumerated()), id: \.offset) { index, feed in
                HStack(spacing: 8) {
                    Image(systemName: "dot.radiowaves.up.forward")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(feed)
                        .font(.subheadline)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                    JarvisIconButton(title: text(.editorRemoveFeed), systemImage: "minus.circle",
                        identifier: "proactive.edit.removeFeed.\(index)") { removeFeed(at: index) }
                }
                .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                .accessibilityElement(children: .combine)
                .accessibilityAction(named: text(.editorRemoveFeed)) { removeFeed(at: index) }
                .accessibilityIdentifier("proactive.edit.feed.\(index)")
            }
            HStack(spacing: 8) {
                TextField(text(.editorFeedsPlaceholder), text: $newFeed)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .onSubmit(addFeed)
                    .accessibilityLabel(text(.editorAddFeed))
                    .accessibilityIdentifier("proactive.edit.feeds")
                JarvisIconButton(
                    title: text(.editorAddFeed),
                    systemImage: "plus",
                    identifier: "proactive.edit.feeds.add",
                    isDisabled: editor == nil || newFeed.trimmingCharacters(in: .whitespaces).isEmpty,
                    action: addFeed
                )
            }
            .disabled(editor == nil)
            .accessibilityHint(editor == nil ? pendingText : "")
            ForEach(feedIssues, id: \.self) { issue($0) }

            saveControl(.editorFeeds)
        }.disabled(isSaving)
        JarvisInsightsDisclosure(title: text(.editorGuidance)) {
            if editor != nil {
                TextEditor(text: draft(\.guidance, fallback: ""))
                    .frame(minHeight: 120)
                    .accessibilityLabel(text(.editorGuidance))
                    .accessibilityIdentifier("proactive.edit.guidance")
                guidanceCounter
                if (editor?.draft.guidance.count ?? 0) > JarvisProactiveLimits.guidanceLength {
                    issue(.guidanceTooLong)
                }
            } else { pendingValue(text(.editorGuidance)) }

            saveControl(.editorGuidance)
        }.disabled(isSaving)
        JarvisInsightsDisclosure(title: text(.editorCategories)) {
            ForEach(JarvisProactiveCategory.allCases) { id in
                if editor != nil {
                    Toggle(text(id.localizationKey), isOn: categoryBinding(id))
                        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        .accessibilityIdentifier("proactive.edit.category.\(id.rawValue)")
                } else { pendingValue(text(id.localizationKey)) }
            }

            saveControl(.editorCategories)
        }.disabled(isSaving)
    }

    @ViewBuilder private func saveControl(_ section: JarvisInsightsLocalizationKey) -> some View {
        if editor?.isDirty == true {
            JarvisLabelledButton(title: text(.confirmSheet), systemImage: "checkmark",
                identifier: "proactive.edit.save.\(section.rawValue)", isDisabled: editor?.canConfirm != true) {
                savingSection = section
                save()
            }
        }
        if savingSection == section { stateBanner }
    }

    private var pendingText: String {
        if case .failed(let failure) = load { return text(failure.localizationKey) }
        return text(.loading)
    }

    private func pendingValue(_ label: String) -> some View {
        HStack {
            Text(label)
            Spacer(minLength: 0)
            if case .loading = load { JarvisLoadingView().accessibilityHidden(true) }
            else { Text("—").foregroundStyle(.secondary) }
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
        .accessibilityElement(children: .combine)
        .accessibilityValue(pendingText)
    }

    private var budgetValue: Int { editor?.draft.budget ?? 0 }
    private var backgroundTurns: Int { editor?.draft.backgroundTurnsPerDay ?? 12 }

    private var budgetSlider: Binding<Double> {
        Binding(
            get: { Double(budgetValue) },
            set: { editor?.draft.budgetText = String(Int($0.rounded())) }
        )
    }

    private var feedRows: [String] { editor?.draft.feeds ?? [] }

    private func addFeed() {
        let value = newFeed.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, var current = editor else { return }
        current.draft.feedsText = (current.draft.feeds + [value]).joined(separator: "\n")
        editor = current
        newFeed = ""
    }

    private func removeFeed(at index: Int) {
        guard var current = editor else { return }
        var feeds = current.draft.feeds
        guard feeds.indices.contains(index) else { return }
        feeds.remove(at: index)
        current.draft.feedsText = feeds.joined(separator: "\n")
        editor = current
    }

    private var feedIssues: [JarvisProactiveIssue] {
        (editor?.draft.issues ?? []).filter { $0 == .invalidFeed || $0 == .tooManyFeeds }
    }

    private var guidanceCounter: some View {
        let count = editor?.draft.guidance.count ?? 0
        return Text(
            JarvisInsightsLocalization.format(
                .editorGuidanceCount, language: language, count, JarvisProactiveLimits.guidanceLength
            )
        )
        .font(.caption)
        .monospacedDigit()
        .foregroundStyle(count > JarvisProactiveLimits.guidanceLength ? Color.red : Color.secondary)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func issue(_ value: JarvisProactiveIssue) -> some View {
        Text(text(value.localizationKey))
            .font(.caption)
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var stateBanner: some View {
        if let state = editor?.state, state != .idle {
            Section {
                HStack(spacing: 10) {
                    switch state {
                    case .saving:
                        JarvisLoadingView().accessibilityHidden(true)
                        Text(text(.editorSaving))
                    case .saved:
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                            .accessibilityHidden(true)
                        Text(text(.editorSaved))
                    case .failed(let failure):
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .accessibilityHidden(true)
                        Text(failureText(failure))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        if editor?.canRetry == true {
                            JarvisIconButton(
                                title: text(.editorRetrySave),
                                systemImage: "arrow.clockwise",
                                identifier: "proactive.edit.retry",
                                action: save
                            )
                        }
                    case .idle:
                        EmptyView()
                    }
                }
                .font(.subheadline)
                .accessibilityElement(children: .contain)
                .accessibilityAddTraits(.updatesFrequently)
                .accessibilityIdentifier("proactive.edit.state")
            }
        }
    }

    private func failureText(_ failure: JarvisInsightsFailure) -> String {
        switch failure {
        case .conflict: text(.editorSaveConflict)
        case .signInRequired: text(.editorSaveSignIn)
        case .offline, .timedOut: text(.editorSaveOffline)
        default: text(.editorSaveFailed)
        }
    }

    // MARK: Bindings

    private func draft<Value>(
        _ keyPath: WritableKeyPath<JarvisProactiveSettingsDraft, Value>,
        fallback: Value
    ) -> Binding<Value> {
        Binding(
            get: { editor?.draft[keyPath: keyPath] ?? fallback },
            set: { editor?.draft[keyPath: keyPath] = $0 }
        )
    }

    private func sourceBinding(_ id: JarvisProactiveSourceID) -> Binding<Bool> {
        Binding(
            get: { editor?.draft.sources.first { $0.id == id }?.enabled ?? false },
            set: { value in
                guard let index = editor?.draft.sources.firstIndex(where: { $0.id == id }) else { return }
                editor?.draft.sources[index].enabled = value
            }
        )
    }

    private func categoryBinding(_ id: JarvisProactiveCategory) -> Binding<Bool> {
        Binding(
            get: { editor?.draft.categories.first { $0.id == id }?.enabled ?? false },
            set: { value in
                guard let index = editor?.draft.categories.firstIndex(where: { $0.id == id }) else { return }
                editor?.draft.categories[index].enabled = value
            }
        )
    }
}
