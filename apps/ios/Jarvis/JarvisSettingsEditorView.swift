import JarvisCore
import SwiftUI

private enum JarvisSettingsFieldKind {
    case choice
    case text
    case multiline
    case number
    case toggle
}

private struct JarvisSettingsField: Identifiable {
    let id: String
    let title: JarvisSettingsLocalizationKey
    let kind: JarvisSettingsFieldKind
    let options: [String]
    let maximumLength: Int?
}

struct JarvisSettingsEditorView: View {
    let detail: JarvisSettingsDetail
    let response: JarvisSettingsResponse?
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onSaved: (JarvisSettingsResponse) -> Void
    let onFailure: (Error) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: [String: String] = [:]
    @State private var editState: JarvisSettingsEditState?
    @State private var saving = false
    @State private var error: String?

    private var fields: [JarvisSettingsField] {
        guard let response else { return [] }
        switch detail {
        case .appearance:
            return [
                choice("appearance.theme", .theme, response.options["themes"]?.arrayValues ?? []),
            ]
        case .personality:
            return [
                choice("personality.tone", .tone, response.options["personalityTones"]?.arrayValues ?? []),
                choice("personality.responseStyle", .responseStyle, response.options["personalityResponseStyles"]?.arrayValues ?? []),
                multiline("personality.customInstructions", .instructions, maximumLength: 2_000),
                toggle("presentation.showWork", .showWork),
            ]
        case .identity:
            return [multiline("identity.description", .identityDescription, maximumLength: 2_000)]
        case .voice:
            return [
                choice("voice.defaultLanguage", .defaultLanguage, response.options["languages"]?.arrayValues ?? []),
                choice("voice.speechToTextModel", .speechToText, response.options["speechToTextModels"]?.arrayValues ?? []),
                choice("voice.englishModel", .englishModel, response.options["englishModels"]?.arrayValues ?? []),
                choice("voice.englishVoice", .englishVoice, response.options["englishVoices"]?.arrayValues ?? []),
                choice("voice.danishVoice", .danishVoice, response.options["danishVoices"]?.arrayValues ?? []),
            ]
        case .research:
            return [
                choice("research.depth", .researchDepth, response.options["researchDepths"]?.arrayValues ?? []),
                number("research.maxSources", .maximumSources, integer: true),
            ]
        case .jarvisModel:
            return [
                choice("jarvis.model", .model, response.options["jarvisModels"]?.arrayValues ?? []),
                choice("jarvis.reasoning", .reasoning, response.options["reasoningEfforts"]?.arrayValues ?? []),
            ]
        case .decisions:
            return [choice("decisions.provider", .provider, response.options["decisionProviders"]?.arrayValues ?? [])]
        case .roleModels:
            return roleFields(response)
        case .codingAgents:
            return [
                choice("codex.model", .codex, response.options["codexModels"]?.arrayValues ?? []),
                choice("codex.reasoning", .reasoning, response.options["codexReasoningEfforts"]?.arrayValues ?? []),
                choice("copilot.model", .copilot, response.options["copilotModels"]?.arrayValues ?? []),
            ]
        case .limits:
            return [
                number("global.maxParallelTasks", .maxParallelTasks, integer: true),
                number("global.maxCheckAttempts", .maxCheckAttempts, integer: true),
                number("global.screenShareDailyFrameCap", .screenShareDailyFrameCap, integer: true),
                number("global.visionDailyBudgetUsd", .visionDailyBudget, integer: false),
                number("global.conversationSummaryDailyLimit", .summariesDailyLimit, integer: true),
            ]
        case .projectDefaults:
            return [
                text("newProjects.owner", .projectOwner, maximumLength: 39),
                choice("newProjects.visibility", .visibility, response.options["projectVisibilities"]?.arrayValues ?? []),
                text("newProjects.templatesRepository", .templatesRepository, maximumLength: 140),
                choice("newProjects.defaultAgent", .defaultAgent, response.options["projectAgents"]?.arrayValues ?? []),
                choice("newProjects.policy", .projectPolicy, response.options["projectPolicies"]?.arrayValues ?? []),
                number("newProjects.maxParallelTasks", .maxProjectTasks, integer: true),
                text("newProjects.defaultBranch", .defaultBranch, maximumLength: 255),
            ]
        default:
            return []
        }
    }

    private var title: String {
        let key: JarvisSettingsLocalizationKey = switch detail {
        case .appearance: .appearanceRow
        case .personality: .personalityRow
        case .identity: .identityRow
        case .voice: .voiceRow
        case .research: .researchRow
        case .jarvisModel: .jarvisModelRow
        case .decisions: .decisionsRow
        case .roleModels: .rolesRow
        case .codingAgents: .codingAgentsRow
        case .limits: .limitsRow
        case .projectDefaults: .projectDefaultsRow
        default: .title
        }
        return JarvisSettingsLocalization.string(key, language: language)
    }

    private var hasChanges: Bool {
        editState?.isDirty ?? false
    }

    private var validDraft: Bool {
        fields.allSatisfy { field in
            guard let value = typedValue(for: field, rawValue: draft[field.id] ?? "") else { return false }
            let parts = field.id.split(separator: ".", maxSplits: 1).map(String.init)
            let bounds = field.kind == .number && parts.count == 2
                ? JarvisSettingsLogic.numericBounds(area: parts[0], key: parts[1])
                : nil
            return JarvisSettingsLogic.validSettingsFieldValue(
                value,
                options: field.kind == .choice ? options(for: field) : nil,
                maximumLength: field.maximumLength,
                numericBounds: bounds,
                integerOnly: field.kind == .number && field.title != .visionDailyBudget
            )
        }
    }

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisForm {
            if let error {
                Text(error)
                    .foregroundStyle(.red)
            }
            ForEach(fields) { field in
                fieldRow(field)
                    .disabled(readOnly || saving)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.locale, language.locale)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? copy(.saving) : copy(.save)) {
                    Task { await save() }
                }
                .disabled(readOnly || saving || !hasChanges || !validDraft)
                .accessibilityLabel(saving ? copy(.saving) : copy(.save))
            }
        }
        .task {
            if draft.isEmpty {
                draft = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, initialValue(for: $0.id)) })
                editState = JarvisSettingsEditState(response?.settings ?? .object([:]))
            }
        }
        .onChange(of: readOnly) { _, isReadOnly in
            if isReadOnly { error = copy(.readOnly) }
        }
    }

    @ViewBuilder
    private func fieldRow(_ field: JarvisSettingsField) -> some View {
        switch field.kind {
        case .choice:
            let available = options(for: field)
            if available.isEmpty {
                LabeledContent(copy(field.title), value: draft[field.id] ?? initialValue(for: field.id))
            } else {
                Picker(copy(field.title), selection: binding(for: field)) {
                    ForEach(available, id: \.self) { value in
                        Text(jarvisSettingsOptionTitle(value, language: language))
                            .tag(value)
                    }
                }
                .pickerStyle(.menu)
            }
        case .text:
            TextField(copy(field.title), text: binding(for: field))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        case .multiline:
            TextField(copy(field.title), text: binding(for: field), axis: .vertical)
                .lineLimit(4...8)
                .accessibilityLabel(copy(field.title))
        case .number:
            TextField(copy(field.title), text: binding(for: field))
                .keyboardType(field.title == .visionDailyBudget ? .decimalPad : .numberPad)
                .accessibilityLabel(copy(field.title))
        case .toggle:
            Toggle(copy(field.title), isOn: Binding(
                get: { draft[field.id] == "true" },
                set: { setDraft(String($0), for: field) }
            ))
        }
    }

    private func binding(for field: JarvisSettingsField) -> Binding<String> {
        Binding(
            get: { draft[field.id] ?? initialValue(for: field.id) },
            set: { setDraft($0, for: field) }
        )
    }

    private func typedValue(for field: JarvisSettingsField, rawValue: String) -> JarvisSettingsValue? {
        switch field.kind {
        case .choice, .text, .multiline:
            return JarvisSettingsValue.string(rawValue)
        case .toggle:
            return JarvisSettingsValue.boolean(rawValue == "true")
        case .number:
            guard let number = Double(rawValue), number.isFinite else { return nil }
            if number.rounded() == number, let integer = Int(exactly: number) {
                return JarvisSettingsValue.integer(integer)
            }
            return JarvisSettingsValue.number(number)
        }
    }

    private func setDraft(_ rawValue: String, for field: JarvisSettingsField) {
        draft[field.id] = rawValue
        error = nil
        updateEditState(rawValue, for: field)
        guard let reasoningField = reasoningField(dependingOn: field),
              let replacement = options(for: reasoningField).first,
              !options(for: reasoningField).contains(draft[reasoningField.id] ?? initialValue(for: reasoningField.id))
        else { return }
        draft[reasoningField.id] = replacement
        updateEditState(replacement, for: reasoningField)
    }

    private func updateEditState(_ rawValue: String, for field: JarvisSettingsField) {
        guard let value = typedValue(for: field, rawValue: rawValue), var editState else { return }
        editState.set(value, path: field.id.split(separator: ".", maxSplits: 2).map(String.init))
        self.editState = editState
    }

    private func reasoningField(dependingOn field: JarvisSettingsField) -> JarvisSettingsField? {
        let id: String
        if field.id == "jarvis.model" {
            id = "jarvis.reasoning"
        } else if field.id.hasPrefix("roles."), field.id.hasSuffix(".model") {
            let parts = field.id.split(separator: ".").map(String.init)
            guard parts.count == 3 else { return nil }
            id = "roles.\(parts[1]).reasoningEffort"
        } else {
            return nil
        }
        return fields.first { $0.id == id }
    }

    private func initialValue(for id: String) -> String {
        guard let response else { return "" }
        let parts = id.split(separator: ".", maxSplits: 2).map(String.init)
        let value: JarvisSettingsValue?
        if parts.first == "roles", parts.count == 3 {
            value = response.settings["roles"]?[parts[1]]?[parts[2]]
        } else if parts.count == 2 {
            value = response.value(area: parts[0], key: parts[1])
        } else {
            value = nil
        }
        switch value {
        case .string(let value): return value
        case .integer(let value): return String(value)
        case .number(let value): return String(value)
        case .boolean(let value): return String(value)
        default: return ""
        }
    }

    private func options(for field: JarvisSettingsField) -> [String] {
        guard let response else { return field.options }
        let values: [String]
        if field.id.hasPrefix("roles."), field.id.hasSuffix(".reasoningEffort") {
            let parts = field.id.split(separator: ".").map(String.init)
            let role = parts[1]
            let model = draft["roles.\(role).model"] ?? initialValue(for: "roles.\(role).model")
            values = response.options["roles"]?[role]?["reasoningEffortsByModel"]?[model]?.arrayValues ?? []
        } else if field.id == "jarvis.reasoning" {
            let model = draft["jarvis.model"] ?? initialValue(for: "jarvis.model")
            values = response.options["roles"]?["chat"]?["reasoningEffortsByModel"]?[model]?.arrayValues ?? []
        } else {
            values = field.options
        }
        return values
    }

    private func roleFields(_ response: JarvisSettingsResponse) -> [JarvisSettingsField] {
        guard case .object(let roles)? = response.settings["roles"] else { return [] }
        return roles.keys.sorted().flatMap { role in
            let title = roleTitle(role)
            let modelValues = response.options["roles"]?[role]?["models"]?.arrayValues ?? []
            return [
                choice("roles.\(role).model", title, modelValues),
                choice("roles.\(role).reasoningEffort", .reasoning, []),
            ]
        }
    }

    private func roleTitle(_ role: String) -> JarvisSettingsLocalizationKey {
        switch role {
        case "chat": .roleChat
        case "vision": .roleVision
        case "research": .roleResearch
        case "voice": .roleVoice
        case "transcription": .roleTranscription
        case "embedding": .roleEmbedding
        case "codex": .roleCodex
        case "copilot": .roleCopilot
        default: .model
        }
    }

    private func save() async {
        guard let client, validDraft, let patch = editState?.changes else { return }
        saving = true
        error = nil
        do {
            let saved = try await client.saveSettings(patch)
            editState = JarvisSettingsEditState(saved.settings)
            onSaved(saved)
            dismiss()
        } catch {
            self.error = copy(.saveFailed)
            onFailure(error)
        }
        saving = false
    }

    private func choice(
        _ id: String,
        _ title: JarvisSettingsLocalizationKey,
        _ options: [String]
    ) -> JarvisSettingsField {
        JarvisSettingsField(id: id, title: title, kind: .choice, options: options, maximumLength: nil)
    }

    private func text(
        _ id: String,
        _ title: JarvisSettingsLocalizationKey,
        maximumLength: Int
    ) -> JarvisSettingsField {
        JarvisSettingsField(id: id, title: title, kind: .text, options: [], maximumLength: maximumLength)
    }

    private func multiline(
        _ id: String,
        _ title: JarvisSettingsLocalizationKey,
        maximumLength: Int
    ) -> JarvisSettingsField {
        JarvisSettingsField(id: id, title: title, kind: .multiline, options: [], maximumLength: maximumLength)
    }

    private func number(
        _ id: String,
        _ title: JarvisSettingsLocalizationKey,
        integer: Bool
    ) -> JarvisSettingsField {
        JarvisSettingsField(
            id: id,
            title: title,
            kind: .number,
            options: [],
            maximumLength: integer ? 9 : 12
        )
    }

    private func toggle(_ id: String, _ title: JarvisSettingsLocalizationKey) -> JarvisSettingsField {
        JarvisSettingsField(id: id, title: title, kind: .toggle, options: [], maximumLength: nil)
    }
}

struct JarvisSettingsLanguageView: View {
    @Binding var language: String
    let selectedLanguage: JarvisAppLanguage

    @Environment(\.dismiss) private var dismiss
    @State private var draft: String

    init(language: Binding<String>, selectedLanguage: JarvisAppLanguage) {
        _language = language
        self.selectedLanguage = selectedLanguage
        _draft = State(initialValue: selectedLanguage.rawValue)
    }

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: selectedLanguage)
    }

    var body: some View {
        JarvisForm {
            Picker(copy(.language), selection: $draft) {
                Text(copy(.danish)).tag(JarvisAppLanguage.da.rawValue)
                Text(copy(.english)).tag(JarvisAppLanguage.en.rawValue)
            }
            .pickerStyle(.inline)
        }
        .navigationTitle(copy(.language))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(copy(.save)) {
                    language = draft
                    dismiss()
                }
                .disabled(draft == selectedLanguage.rawValue)
            }
        }
    }
}

func jarvisSettingsOptionTitle(_ value: String, language: JarvisAppLanguage) -> String {
    let key: JarvisSettingsLocalizationKey? = switch value {
    case "light": .light
    case "dark": .dark
    case "system": .system
    case "da": .danish
    case "en": .english
    case "british_butler": .personalityButler
    case "warm": .personalityWarm
    case "direct": .personalityDirect
    case "playful": .personalityPlayful
    case "concise": .concise
    case "balanced": .balanced
    case "detailed": .detailed
    case "quick": .quick
    case "standard": .standard
    case "deep": .thorough
    case "jev": .decisionJev
    case "microsoft": .decisionMicrosoft
    case "codex": .codex
    case "copilot": .copilot
    case "default": .providerDefault
    case "none": .none
    case "low": .low
    case "medium": .medium
    case "high": .high
    case "private": .privateVisibility
    case "public": .publicVisibility
    case "deliver_pr": .deliverPullRequest
    case "complete_without_deployment": .completeWithoutDeployment
    default: nil
    }
    return key.map { JarvisSettingsLocalization.string($0, language: language) } ?? value
}

private extension JarvisSettingsValue {
    var arrayValues: [String] {
        guard case .array(let values) = self else { return [] }
        return values.compactMap(\.stringValue)
    }
}
