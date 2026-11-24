import JarvisCore
import SwiftUI
import UIKit

private enum JarvisSettingsFieldKind {
    case choice
    case text
    case multiline
    case number
    case toggle
    case colour
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
    @State private var selectedCard = "next"
    @State private var error: String?

    private var fields: [JarvisSettingsField] {
        switch detail {
        case .appearance:
            return [
                choice("appearance.theme", .theme, response?.options["themes"]?.arrayValues ?? []),
                colour("appearance.accent", .primaryColour),
                colour("appearance.accent-secondary", .secondaryColour),
            ] + JarvisSurfaceSettings.keys.map { colour("appearance." + $0, .primaryColour) }
        case .instructions, .personality, .identity:
            return [
                multiline("identity.description", .identityDescription, maximumLength: 2_000),
                choice("personality.tone", .tone, response?.options["personalityTones"]?.arrayValues ?? []),
                choice("personality.responseStyle", .responseStyle, response?.options["personalityResponseStyles"]?.arrayValues ?? []),
                multiline("personality.customInstructions", .generalInstructions, maximumLength: 2_000),
                multiline("personality.modeInstructions.present", .presentInstructions, maximumLength: 2_000),
                multiline("personality.modeInstructions.away", .awayInstructions, maximumLength: 2_000),
                multiline("personality.modeInstructions.on_the_move", .onTheMoveInstructions, maximumLength: 2_000),
                multiline("homeBrief.instruction", .homeBriefInstruction, maximumLength: 2_000),
                number("homeBrief.maxVisibleLines", .homeBriefLines, integer: true),
                toggle("presentation.showWork", .showWork),
            ]
        case .voice:
            return [
                toggle("voice.minimizeWindowsOnVoiceStart", .voiceMinimizeWindows),
            ]
        case .research:
            return [
                choice("research.depth", .researchDepth, response?.options["researchDepths"]?.arrayValues ?? []),
                number("research.maxSources", .maximumSources, integer: true),
            ]
        case .jarvisModel:
            return [
                choice("jarvis.model", .model, response?.options["jarvisModels"]?.arrayValues ?? []),
                choice("jarvis.reasoning", .reasoning, response?.options["reasoningEfforts"]?.arrayValues ?? []),
            ]
        case .decisions:
            return [choice("decisions.provider", .provider, response?.options["decisionProviders"]?.arrayValues ?? [])]
        case .roleModels:
            return response.map(roleFields) ?? []
        case .codingAgents:
            return [
                choice("codex.model", .codex, response?.options["codexModels"]?.arrayValues ?? []),
                choice("codex.reasoning", .reasoning, response?.options["codexReasoningEfforts"]?.arrayValues ?? []),
                choice("copilot.model", .copilot, response?.options["copilotModels"]?.arrayValues ?? []),
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
                choice("newProjects.visibility", .visibility, response?.options["projectVisibilities"]?.arrayValues ?? []),
                text("newProjects.templatesRepository", .templatesRepository, maximumLength: 140),
                choice("newProjects.defaultAgent", .defaultAgent, response?.options["projectAgents"]?.arrayValues ?? []),
                choice("newProjects.policy", .projectPolicy, response?.options["projectPolicies"]?.arrayValues ?? []),
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
        case .instructions, .personality, .identity: .instructionsRow
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

    private var previewPalette: JarvisPaletteSelection {
        func hex(_ field: String, fallback: String) -> String {
            let value = draft[field] ?? initialValue(for: field)
            return value.isEmpty ? fallback : value
        }
        return JarvisPaletteSelection(
            primaryHex: hex("appearance.accent", fallback: JarvisPalette.defaultPrimaryHex),
            secondaryHex: hex("appearance.accent-secondary", fallback: JarvisPalette.defaultSecondaryHex)
        ) ?? .standard
    }

    private var validDraft: Bool {
        fields.allSatisfy { field in
            guard let value = typedValue(for: field, rawValue: draft[field.id] ?? "") else { return false }
            if field.kind == .colour { return value == .null || value.stringValue != nil }
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
            ForEach(fields.filter { !$0.id.contains(".surface-") }) { field in
                fieldRow(field)
                    .disabled(response == nil || readOnly || saving)
                    .accessibilityHint(response == nil ? copy(.unavailable) : (readOnly ? copy(.readOnly) : ""))
            }
            if detail == .appearance {
                Section("Background colors") {
                    ForEach(fields.filter { field in JarvisSurfaceSettings.roles.contains(surfaceRole(field)) }) { field in
                        fieldRow(field)
                    }
                    DisclosureGroup("Individual cards") {
                        Picker("Card", selection: $selectedCard) {
                            ForEach(JarvisSurfaceSettings.cards, id: \.self) { role in
                                Text(JarvisSurfacePalette.label(role)).tag(role)
                            }
                        }
                        if let field = fields.first(where: { surfaceRole($0) == selectedCard }) {
                            fieldRow(field)
                            Button("Use shared card color") { setDraft("", for: field) }
                        }
                    }
                }.disabled(response == nil || readOnly || saving)
                Button(copy(.restoreColours)) {
                    for field in fields where field.kind == .colour {
                        setDraft("", for: field)
                    }
                }
                .disabled(response == nil || readOnly || saving || !fields.contains {
                    $0.kind == .colour && !(draft[$0.id] ?? "").isEmpty
                })
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.locale, language.locale)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSheetConfirmButton(
                    title: copy(.save),
                    isWorking: saving,
                    isDisabled: client == nil || response == nil || readOnly || !hasChanges || !validDraft
                ) { Task { await save() } }
                .accessibilityHint(client == nil || response == nil ? copy(.unavailable) : (readOnly ? copy(.readOnly) : ""))
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .task { initializeDraft() }
        .onChange(of: response) { _, _ in initializeDraft() }
        .onChange(of: readOnly) { _, isReadOnly in
            if isReadOnly { error = copy(.readOnly) }
        }
    }

    private func initializeDraft() {
        guard let response, editState == nil else { return }
        draft = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, initialValue(for: $0.id)) })
        editState = JarvisSettingsEditState(response.settings)
    }

    private func surfaceRole(_ field: JarvisSettingsField) -> String {
        field.id.replacingOccurrences(of: "appearance.surface-", with: "")
    }

    @ViewBuilder
    private func fieldRow(_ field: JarvisSettingsField) -> some View {
        switch field.kind {
        case .colour:
            ColorPicker(field.id.contains(".surface-") ? JarvisSurfacePalette.label(surfaceRole(field)) : copy(field.title), selection: Binding(
                get: {
                    let fallback: String
                    if JarvisSurfaceSettings.cards.contains(surfaceRole(field)) {
                        fallback = draft["appearance.surface-card"] ?? ""
                    } else if field.id == "appearance.accent" {
                        fallback = JarvisPalette.defaultPrimaryHex
                    } else if field.id == "appearance.accent-secondary" {
                        fallback = JarvisPalette.defaultSecondaryHex
                    } else {
                        fallback = ""
                    }
                    let raw = (draft[field.id] ?? "").drop(while: { $0 == "#" })
                    let rgb = UInt32(raw, radix: 16)
                        ?? UInt32(fallback.drop(while: { $0 == "#" }), radix: 16) ?? 0x25303D
                    return Color(.sRGB, red: Double(rgb >> 16) / 255,
                                 green: Double(rgb >> 8 & 255) / 255, blue: Double(rgb & 255) / 255)
                },
                set: { selected in
                    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
                          let rgb = UIColor(selected).cgColor.converted(to: space, intent: .defaultIntent, options: nil),
                          let components = rgb.components, components.count >= 3 else { return }
                    let bytes = components.prefix(3).map { Int((min(1, max(0, $0)) * 255).rounded()) }
                    setDraft(String(format: "#%02X%02X%02X", bytes[0], bytes[1], bytes[2]), for: field)
                }
            ), supportsOpacity: false)
            .accessibilityIdentifier("settings.field.\(field.id)")
        case .choice:
            let available = options(for: field)
            if available.isEmpty {
                LabeledContent(copy(field.title), value: draft[field.id] ?? initialValue(for: field.id))
            } else {
                Picker(selection: binding(for: field)) {
                    ForEach(available, id: \.self) { value in
                        Text(jarvisSettingsOptionTitle(value, language: language))
                            .tag(value)
                    }
                } label: {
                    if field.id == "appearance.theme" {
                        HStack(spacing: JarvisDesignTokens.rowSpacing) {
                            JarvisLatticeOrbView(activity: .calm, isStatic: true, palette: previewPalette)
                                .frame(width: JarvisDesignTokens.controlMinimumHeight,
                                       height: JarvisDesignTokens.controlMinimumHeight)
                                .accessibilityHidden(true)
                            Text(copy(field.title))
                        }
                    } else {
                        Text(copy(field.title))
                    }
                }
                .pickerStyle(.menu)
            }
        case .text:
            JarvisSettingsTextField(title: copy(field.title), text: binding(for: field),
                                    identifier: "settings.field.\(field.id)")
        case .multiline:
            JarvisSettingsTextField(title: copy(field.title), text: binding(for: field),
                                    identifier: "settings.field.\(field.id)", multiline: true)
        case .number:
            JarvisSettingsTextField(title: copy(field.title), text: binding(for: field),
                                    identifier: "settings.field.\(field.id)",
                                    keyboard: field.title == .visionDailyBudget ? .decimalPad : .numberPad)
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
        case .colour:
            return rawValue.isEmpty ? .null : .string(rawValue)
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
        if parts.count == 3 {
            value = response.settings[parts[0]]?[parts[1]]?[parts[2]]
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
        case "embedding": .roleEmbedding
        case "codex": .roleCodex
        case "copilot": .roleCopilot
        default: .model
        }
    }

    private func save() async {
        guard let client, !readOnly, !saving, hasChanges, validDraft, let patch = editState?.changes else { return }
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

    private func colour(_ id: String, _ title: JarvisSettingsLocalizationKey) -> JarvisSettingsField {
        JarvisSettingsField(id: id, title: title, kind: .colour, options: [], maximumLength: nil)
    }
}

func jarvisSettingsOptionTitle(_ value: String, language: JarvisAppLanguage) -> String {
    let key: JarvisSettingsLocalizationKey? = switch value {
    case "light": .light
    case "dark": .dark
    case "system": .system
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
