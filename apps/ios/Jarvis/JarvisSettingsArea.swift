import JarvisCore
import SwiftUI

private enum JarvisSettingsSection: String, CaseIterable, Identifiable {
    case general
    case models
    case health
    case account

    var id: String { rawValue }

    func title(language: JarvisAppLanguage) -> String {
        let key: JarvisSettingsLocalizationKey = switch self {
        case .general: .general
        case .models: .models
        case .health: .health
        case .account: .account
        }
        return JarvisSettingsLocalization.string(key, language: language)
    }
}

enum JarvisSettingsDetail: String, Hashable {
    case appLanguage
    case appearance
    case personality
    case identity
    case voice
    case research
    case proactive
    case routines
    case memory
    case jarvisModel
    case decisions
    case roleModels
    case codingAgents
    case limits
    case projectDefaults
    case deployments
    case newDeployment
    case trainingTargets
    case nutritionTargets
    case healthCredential
    case owner
    case credentials
}

private struct JarvisSettingsRow: Identifiable {
    let id: String
    let title: JarvisSettingsLocalizationKey
    let detail: JarvisSettingsDetail?
    var value: String? = nil
    var disabledHint: JarvisSettingsLocalizationKey? = nil
}

struct JarvisSettingsArea: View {
    @Binding var storedLanguage: String
    @Binding var storedTheme: String

    let client: JarvisSettingsClient?
    let onSignedOut: () -> Void

    @State private var search = ""
    @State private var path: [JarvisSettingsDetail] = []
    @State private var response: JarvisSettingsResponse?
    @State private var loading = true
    @State private var loadError: JarvisSettingsClientError?
    @State private var readOnly = false
    @State private var signOutError: String?
    @State private var signingOut = false
    @State private var confirmCurrentSignOut = false
    @State private var confirmAllSignOut = false
    private let loadingSkeletonKeys: [JarvisSettingsLocalizationKey] = [
        .appearanceRow, .personalityRow, .identityRow, .voiceRow,
    ]

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                header
                if loading && response == nil {
                    loadingSkeleton
                } else if response == nil {
                    errorState
                } else {
                    settingsList
                }
            }
            .background(JarvisScreenBackground())
            .environment(\.locale, language.locale)
            .tint(JarvisDesignTokens.settingsAccent)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                bottomBar
            }
            .task {
                if response == nil { await reload() }
            }
            .navigationDestination(for: JarvisSettingsDetail.self) { detail in
                detailView(for: detail)
                    .toolbar(.visible, for: .navigationBar)
            }
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog(
                copy(.signOutConfirm),
                isPresented: $confirmCurrentSignOut,
                titleVisibility: .visible
            ) {
                Button(copy(.signOut), role: .destructive) {
                    Task { await signOut(allDevices: false) }
                }
                Button(copy(.cancel), role: .cancel) {}
            }
            .confirmationDialog(
                copy(.signOutAllConfirm),
                isPresented: $confirmAllSignOut,
                titleVisibility: .visible
            ) {
                Button(copy(.signOutAll), role: .destructive) {
                    Task { await signOut(allDevices: true) }
                }
                Button(copy(.cancel), role: .cancel) {}
            }
        }
        .accessibilityLabel(copy(.title))
    }

    private var header: some View {
        HStack {
            Text(copy(.title))
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(.primary)
            Spacer()
            Button {
                Task { await reload() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: JarvisDesignTokens.settingsIconSize, weight: .medium))
                    .frame(
                        width: JarvisDesignTokens.settingsControlHeight,
                        height: JarvisDesignTokens.settingsControlHeight
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.glass)
            .disabled(loading)
            .accessibilityLabel(copy(.refresh))
        }
        .padding(.horizontal, JarvisDesignTokens.settingsHorizontalInset)
        .padding(.top, JarvisDesignTokens.settingsSectionSpacing)
    }

    private var settingsList: some View {
        List {
            if let error = loadError, response != nil {
                Text(message(for: error))
                    .foregroundStyle(error == .offline ? Color.secondary : Color.red)
                    .listRowBackground(Color.clear)
            }
            ForEach(JarvisSettingsSection.allCases) { section in
                let rows = visibleRows(in: section)
                if !rows.isEmpty || (section == .account && !visibleAccountActions.isEmpty) {
                    Section {
                        ForEach(rows) { row in
                            if let detail = row.detail {
                                NavigationLink(value: detail) {
                                    rowContent(row)
                                }
                                .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
                            } else {
                                Button {} label: {
                                    rowContent(row)
                                }
                                .buttonStyle(.plain)
                                .disabled(true)
                                .accessibilityHint(row.disabledHint.map(copy) ?? "")
                                .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
                            }
                        }
                        if section == .account {
                            accountActions
                        }
                    } header: {
                        Text(section.title(language: language))
                    }
                    .textCase(nil)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .overlay {
            if !hasVisibleContent {
                Text(copy(search.isEmpty ? .noItems : .noResults))
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .refreshable { await reload() }
    }

    @ViewBuilder
    private var accountActions: some View {
        if let signOutError {
            Text(signOutError)
                .foregroundStyle(.red)
        }
        if visibleAccountActions.contains("signOut") {
            Button {
                confirmCurrentSignOut = true
            } label: {
                rowContent(JarvisSettingsRow(id: "signOut", title: .signOut, detail: nil))
            }
            .disabled(signingOut)
            .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
        }
        if visibleAccountActions.contains("signOutAll") {
            Button {
                confirmAllSignOut = true
            } label: {
                rowContent(JarvisSettingsRow(id: "signOutAll", title: .signOutAll, detail: nil))
            }
            .disabled(signingOut)
            .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
        }
    }

    private var bottomBar: some View {
        HStack(spacing: JarvisDesignTokens.settingsSectionSpacing) {
            HStack(spacing: JarvisDesignTokens.settingsSectionSpacing) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(copy(.search), text: $search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(copy(.search))
                if !search.isEmpty {
                    Button {
                        search = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(copy(.cancel))
                }
            }
            .padding(.horizontal, JarvisDesignTokens.settingsSectionSpacing)
            .frame(height: JarvisDesignTokens.settingsControlHeight)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.settingsSearchRadius))

            Button {
                path.append(.newDeployment)
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: JarvisDesignTokens.settingsIconSize, weight: .semibold))
                    .frame(
                        width: JarvisDesignTokens.settingsControlHeight,
                        height: JarvisDesignTokens.settingsControlHeight
                    )
                    .contentShape(Circle())
            }
            .buttonStyle(.glass)
            .accessibilityLabel(copy(.addDeployment))
        }
        .padding(.horizontal, JarvisDesignTokens.settingsHorizontalInset)
        .padding(.top, JarvisDesignTokens.settingsSectionSpacing)
        .padding(.bottom, JarvisDesignTokens.settingsSectionSpacing)
        .background(.bar)
    }

    private var errorState: some View {
        VStack(spacing: JarvisDesignTokens.settingsSectionSpacing) {
            Text(message(for: loadError ?? .offline))
                .foregroundStyle(.secondary)
            Button(copy(.retry)) { Task { await reload() } }
                .buttonStyle(.glass)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingSkeleton: some View {
        List {
            ForEach(loadingSkeletonKeys, id: \.self) { key in
                HStack {
                    Text(copy(key))
                        .redacted(reason: .placeholder)
                    Spacer()
                    Capsule()
                        .fill(.tertiary)
                        .frame(width: JarvisDesignTokens.settingsSkeletonValueWidth, height: JarvisDesignTokens.settingsSkeletonValueHeight)
                }
                .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .accessibilityHidden(true)
    }

    private var hasVisibleContent: Bool {
        JarvisSettingsSection.allCases.contains { !visibleRows(in: $0).isEmpty } ||
            !visibleAccountActions.isEmpty
    }

    private func visibleRows(in section: JarvisSettingsSection) -> [JarvisSettingsRow] {
        let rows = rows(for: section)
        return JarvisSettingsLogic.filter(
            rows.map(\.id),
            labels: Dictionary(uniqueKeysWithValues: rows.map { ($0.id, copy($0.title)) }),
            query: search,
            language: language
        ).compactMap { id in rows.first(where: { $0.id == id }) }
    }

    private var visibleAccountActions: Set<String> {
        Set(JarvisSettingsLogic.filter(
            ["signOut", "signOutAll"],
            labels: ["signOut": copy(.signOut), "signOutAll": copy(.signOutAll)],
            query: search,
            language: language
        ))
    }

    private func rows(for section: JarvisSettingsSection) -> [JarvisSettingsRow] {
        switch section {
        case .general:
            return [
                row("language", .language, .appLanguage, value: copy(language == .da ? .danish : .english)),
                row("appearance", .appearanceRow, .appearance, setting: "appearance", key: "theme"),
                row("personality", .personalityRow, .personality, setting: "personality", key: "tone"),
                row("identity", .identityRow, .identity, setting: "identity", key: "description"),
                row("voice", .voiceRow, .voice, setting: "voice", key: "defaultLanguage"),
                row("research", .researchRow, .research, setting: "research", key: "depth"),
                row("proactive", .proactiveRow, .proactive),
                row(
                    "notifications", .notificationsRow, nil,
                    value: copy(.unavailable), disabledHint: .notificationsUnavailable
                ),
                row("routines", .routinesRow, .routines),
                row("memory", .memoryRow, .memory),
            ]
        case .models:
            return [
                row("jarvis", .jarvisModelRow, .jarvisModel, setting: "jarvis", key: "model"),
                row("decisions", .decisionsRow, .decisions, setting: "decisions", key: "provider"),
                row("roles", .rolesRow, .roleModels),
                row("codingAgents", .codingAgentsRow, .codingAgents),
                row("limits", .limitsRow, .limits),
                row("projectDefaults", .projectDefaultsRow, .projectDefaults),
                row("deployments", .deploymentsRow, .deployments),
            ]
        case .health:
            return [
                row("training", .trainingTargetsRow, .trainingTargets),
                row("nutrition", .nutritionTargetsRow, .nutritionTargets),
                row("healthCredential", .uploadCredentialRow, .healthCredential),
            ]
        case .account:
            return [
                row("owner", .ownerRow, .owner),
                row("credentials", .credentialsRow, .credentials, value: credentialCount),
            ]
        }
    }

    private var credentialCount: String? {
        guard let count = response?.credentials.count else { return nil }
        return String(count)
    }

    private func row(
        _ id: String,
        _ title: JarvisSettingsLocalizationKey,
        _ detail: JarvisSettingsDetail?,
        setting area: String? = nil,
        key: String? = nil,
        value: String? = nil,
        disabledHint: JarvisSettingsLocalizationKey? = nil
    ) -> JarvisSettingsRow {
        let settingValue: String?
        if let area, let key {
            settingValue = response?.value(area: area, key: key).flatMap(displayValue)
        } else {
            settingValue = value
        }
        return JarvisSettingsRow(
            id: id,
            title: title,
            detail: detail,
            value: settingValue,
            disabledHint: disabledHint
        )
    }

    @ViewBuilder
    private func rowContent(_ row: JarvisSettingsRow) -> some View {
        HStack(spacing: JarvisDesignTokens.settingsSectionSpacing) {
            Text(copy(row.title))
                .foregroundStyle(row.disabledHint == nil ? .primary : .secondary)
            Spacer(minLength: JarvisDesignTokens.settingsSectionSpacing)
            if let value = row.value, !value.isEmpty {
                Text(value)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func detailView(for detail: JarvisSettingsDetail) -> some View {
        switch detail {
        case .appLanguage:
            JarvisSettingsLanguageView(language: $storedLanguage, selectedLanguage: language)
        case .proactive:
            JarvisProactiveSettingsView(client: client, language: language, readOnly: readOnly, onFailure: noteFailure)
        case .routines:
            JarvisRoutinesSettingsView(client: client, language: language, readOnly: readOnly, onFailure: noteFailure)
        case .memory:
            JarvisMemorySettingsView(client: client, language: language, readOnly: readOnly, onFailure: noteFailure)
        case .trainingTargets:
            JarvisTargetsSettingsView(
                client: client, language: language, kind: .training, readOnly: readOnly, onFailure: noteFailure
            )
        case .nutritionTargets:
            JarvisTargetsSettingsView(
                client: client, language: language, kind: .nutrition, readOnly: readOnly, onFailure: noteFailure
            )
        case .healthCredential:
            JarvisHealthCredentialView(client: client, language: language, onFailure: noteFailure)
        case .owner:
            JarvisOwnerSettingsView(client: client, language: language, onFailure: noteFailure)
        case .credentials:
            JarvisCredentialsSettingsView(
                client: client,
                credentials: response?.credentials ?? [],
                language: language,
                readOnly: readOnly,
                onCredentialChanged: { credential in
                    guard let current = response,
                          let index = current.credentials.firstIndex(where: { $0.name == credential.name }) else { return }
                    var credentials = current.credentials
                    credentials[index] = credential
                    response = JarvisSettingsResponse(
                        settings: current.settings,
                        options: current.options,
                        credentials: credentials
                    )
                },
                onFailure: noteFailure
            )
        case .deployments:
            JarvisDeploymentsSettingsView(client: client, language: language, readOnly: readOnly, onFailure: noteFailure)
        case .newDeployment:
            JarvisNewDeploymentView(client: client, language: language, readOnly: readOnly, onFailure: noteFailure)
        default:
            JarvisSettingsEditorView(
                detail: detail,
                response: response,
                client: client,
                language: language,
                readOnly: readOnly,
                onSaved: { fresh in
                    response = fresh
                    if let theme = fresh.string(area: "appearance", key: "theme") {
                        storedTheme = theme
                    }
                },
                onFailure: noteFailure
            )
        }
    }

    private func reload() async {
        guard let client else {
            loadError = .unavailable
            loading = false
            return
        }
        loading = true
        do {
            let fresh = try await client.loadSettings()
            response = fresh
            loadError = nil
            readOnly = false
            if let theme = fresh.string(area: "appearance", key: "theme") {
                storedTheme = theme
            }
        } catch {
            noteFailure(error)
        }
        loading = false
    }

    private func noteFailure(_ error: Error) {
        let mapped = error as? JarvisSettingsClientError ?? .offline
        loadError = mapped
        readOnly = mapped == .offline || mapped == .unavailable || mapped == .notOwner || mapped == .signInRequired
    }

    private func signOut(allDevices: Bool) async {
        guard let client else { return }
        signingOut = true
        signOutError = nil
        do {
            if allDevices {
                try await client.signOutAllDevices()
            } else {
                try await client.signOut()
            }
            onSignedOut()
        } catch {
            signOutError = copy(.signOutFailed)
            noteFailure(error)
        }
        signingOut = false
    }

    private func message(for error: JarvisSettingsClientError) -> String {
        let key: JarvisSettingsLocalizationKey = switch error {
        case .notOwner, .signInRequired: .notOwner
        case .unavailable: .unavailable
        case .offline: .offline
        case .httpStatus(403): .forbidden
        default: .loadFailed
        }
        return copy(key)
    }

    private func displayValue(_ value: JarvisSettingsValue) -> String? {
        switch value {
        case .string(let value): return localizedValue(value)
        case .integer(let value): return String(value)
        case .number(let value): return String(value)
        case .boolean(let value): return copy(value ? .running : .paused)
        case .null: return nil
        case .object, .array: return nil
        }
    }

    private func localizedValue(_ value: String) -> String {
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
        return key.map(copy) ?? value
    }
}

private extension JarvisSettingsValue {
    var arrayValues: [String] {
        guard case .array(let values) = self else { return [] }
        return values.compactMap(\.stringValue)
    }

    var objectValues: [String: JarvisSettingsValue] {
        guard case .object(let values) = self else { return [:] }
        return values
    }
}
