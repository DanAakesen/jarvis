import JarvisCore
import SwiftUI

/// The Proactive settings editor. Check mark saves, X discards. Edits stay in the draft: a failed save keeps
/// them and offers a retry. Quiet hours, snooze and check interval are not editable, like the web app.
/// HIG: Sheets, Forms, Toggles, Text fields, Pickers. API: Form, Toggle, TextEditor, ScrollViewReader.
struct JarvisProactiveSettingsSheet: View {
    enum Focus: String {
        case top
        case sources
        case budget
    }

    let client: JarvisProactiveClient?
    let language: JarvisAppLanguage
    let focus: Focus
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var load: JarvisInsightsLoad<Void> = .loading
    @State private var editor: JarvisProactiveSettingsEditor?
    @State private var loadToken = 0
    @State private var saveToken = 0
    @State private var pendingPatch: JarvisProactiveSettingsPatch?

    private func text(_ key: JarvisInsightsLocalizationKey) -> String {
        jarvisInsightsText(key, language)
    }

    private var isSaving: Bool { editor?.state == .saving }

    var body: some View {
        NavigationStack {
            Group {
                if editor != nil {
                    form
                } else {
                    stateView
                }
            }
            .navigationTitle(text(.editorTitle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: text(.confirmSheet),
                    closeTitle: text(.closeSheet),
                    isWorking: isSaving,
                    isConfirmDisabled: !(editor?.canConfirm ?? false),
                    onConfirm: save,
                    onClose: { dismiss() }
                )
            }
        }
        .environment(\.locale, language.locale)
        .tint(JarvisDesignTokens.primaryAccent)
        .interactiveDismissDisabled(isSaving)
        .accessibilityIdentifier("proactive.edit.sheet")
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
            let settings = try await client.settings()
            if Task.isCancelled { return }
            editor = JarvisProactiveSettingsEditor(settings: settings)
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
            try? await Task.sleep(for: .milliseconds(700))
            dismiss()
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

    private var form: some View {
        ScrollViewReader { proxy in
            JarvisForm {
                stateBanner
                Section {
                    Toggle(text(.editorPause), isOn: draft(\.paused, fallback: false))
                        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        .accessibilityIdentifier("proactive.edit.pause")
                }
                Section {
                    ForEach(JarvisProactiveSourceID.allCases) { id in
                        Toggle(text(id.localizationKey), isOn: sourceBinding(id))
                            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                            .accessibilityIdentifier("proactive.edit.source.\(id.rawValue)")
                    }
                } header: {
                    Text(text(.editorSources))
                }
                .id(Focus.sources.rawValue)
                Section {
                    ForEach(JarvisProactiveCategory.allCases) { id in
                        Toggle(text(id.localizationKey), isOn: categoryBinding(id))
                            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                            .accessibilityIdentifier("proactive.edit.category.\(id.rawValue)")
                    }
                } header: {
                    Text(text(.editorCategories))
                }
                Section {
                    Picker(text(.editorScope), selection: draft(\.scope, fallback: .all)) {
                        ForEach(JarvisProactiveScope.allCases) { scope in
                            Text(text(scope.localizationKey)).tag(scope)
                        }
                    }
                    .pickerStyle(.segmented)
                    .controlSize(.large)
                    .accessibilityIdentifier("proactive.edit.scope")
                } header: {
                    Text(text(.editorScope))
                }
                Section {
                    TextField(text(.editorBudget), text: draft(\.budgetText, fallback: ""))
                        .keyboardType(.numberPad)
                        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        .accessibilityIdentifier("proactive.edit.budget")
                    if editor?.draft.budget == nil {
                        issue(.budgetOutOfRange)
                    }
                } header: {
                    Text(text(.editorBudget))
                }
                .id(Focus.budget.rawValue)
                Section {
                    TextEditor(text: draft(\.feedsText, fallback: ""))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .frame(minHeight: 88)
                        .accessibilityLabel(text(.editorFeeds))
                        .accessibilityHint(text(.editorFeedsPlaceholder))
                        .accessibilityIdentifier("proactive.edit.feeds")
                    ForEach(feedIssues, id: \.self) { issue($0) }
                } header: {
                    Text(text(.editorFeeds))
                }
                Section {
                    TextEditor(text: draft(\.guidance, fallback: ""))
                        .frame(minHeight: 120)
                        .accessibilityLabel(text(.editorGuidance))
                        .accessibilityIdentifier("proactive.edit.guidance")
                    guidanceCounter
                    if (editor?.draft.guidance.count ?? 0) > JarvisProactiveLimits.guidanceLength {
                        issue(.guidanceTooLong)
                    }
                } header: {
                    Text(text(.editorGuidance))
                }
                Section {
                    let preferences = editor?.draft.preferences ?? []
                    if preferences.isEmpty {
                        Text(text(.editorNoPreferences)).foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(preferences.enumerated()), id: \.offset) { _, preference in
                            Text(preference)
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } header: {
                    Text(text(.editorPreferences))
                }
            }
            .disabled(isSaving)
            .onAppear {
                if focus != .top { proxy.scrollTo(focus.rawValue, anchor: .top) }
            }
        }
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
                        ProgressView().accessibilityHidden(true)
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
