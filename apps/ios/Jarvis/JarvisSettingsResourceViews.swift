import JarvisCore
import SwiftUI

struct JarvisProactiveSettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @State private var settings: JarvisProactiveSettings?
    @State private var draftPaused = false
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    private var isDirty: Bool {
        settings.map { $0.paused != draftPaused } ?? false
    }

    var body: some View {
        JarvisForm {
            if let error {
                Text(error)
                    .foregroundStyle(.red)
            }
            if loading && settings == nil {
                ProgressView(copy(.loading))
            } else if let settings {
                Toggle(copy(.proactiveSuggestions), isOn: Binding(
                    get: { !draftPaused },
                    set: { draftPaused = !$0; error = nil }
                ))
                Text(copy(draftPaused ? .paused : .running))
                    .foregroundStyle(.secondary)
            } else {
                Button(copy(.retry)) { Task { await load() } }
            }
        }
        .navigationTitle(copy(.proactiveRow))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? copy(.saving) : copy(.save)) {
                    Task { await save() }
                }
                .disabled(readOnly || loading || saving || !isDirty)
            }
        }
        .task {
            if settings == nil { await load() }
        }
        .onChange(of: readOnly) { _, value in
            if value { error = copy(.readOnly) }
        }
    }

    private func load() async {
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        do {
            let fresh = try await client.loadProactiveSettings()
            settings = fresh
            draftPaused = fresh.paused
            error = nil
        } catch {
            self.error = copy(.loadFailed)
            onFailure(error)
        }
        loading = false
    }

    private func save() async {
        guard let client, let settings, isDirty, !readOnly else { return }
        saving = true
        error = nil
        do {
            let saved = try await client.saveProactivePaused(draftPaused, expectedRevision: settings.revision)
            self.settings = saved
            draftPaused = saved.paused
            error = copy(.saved)
        } catch {
            self.error = copy(.savePending)
            onFailure(error)
        }
        saving = false
    }
}

struct JarvisRoutinesSettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @State private var routines: [JarvisRoutine] = []
    @State private var loading = true
    @State private var error: String?
    @State private var pendingDeletion: JarvisRoutine?
    @State private var deleting = false

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if loading && routines.isEmpty {
                ProgressView(copy(.loading))
            } else if routines.isEmpty {
                Text(copy(.noRoutines)).foregroundStyle(.secondary)
            }
            ForEach(routines) { routine in
                HStack {
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.settingsSectionSpacing / 2) {
                        Text(routine.title)
                            .font(.body.weight(.medium))
                        Text(routine.goal)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(role: .destructive) {
                        pendingDeletion = routine
                    } label: {
                        Image(systemName: "trash")
                            .frame(
                                width: JarvisDesignTokens.settingsControlHeight,
                                height: JarvisDesignTokens.settingsControlHeight
                            )
                    }
                    .disabled(readOnly || deleting)
                    .accessibilityLabel(copy(.delete))
                }
                .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
            }
            if let error, !routines.isEmpty {
                Button(copy(.retry)) { Task { await load() } }
                    .disabled(loading)
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(copy(.routinesRow))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading || deleting)
                .accessibilityLabel(copy(.refresh))
            }
        }
        .task {
            if routines.isEmpty { await load() }
        }
        .confirmationDialog(
            copy(.routineDeleteConfirm),
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(copy(.delete), role: .destructive) {
                guard let pendingDeletion else { return }
                Task { await delete(pendingDeletion) }
            }
            Button(copy(.cancel), role: .cancel) { pendingDeletion = nil }
        }
    }

    private func load() async {
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        do {
            routines = try await client.loadRoutines()
            error = nil
        } catch {
            self.error = copy(.loadFailed)
            onFailure(error)
        }
        loading = false
    }

    private func delete(_ routine: JarvisRoutine) async {
        guard let client, !readOnly, !deleting else { return }
        deleting = true
        error = nil
        do {
            try await client.deleteRoutine(id: routine.id)
            routines.removeAll { $0.id == routine.id }
        } catch {
            self.error = copy(.deleteFailed)
            onFailure(error)
        }
        pendingDeletion = nil
        deleting = false
    }
}

struct JarvisMemorySettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @State private var memories: [JarvisMemoryItem] = []
    @State private var query = ""
    @State private var offset = 0
    @State private var hasMore = false
    @State private var hasLoaded = false
    @State private var loading = true
    @State private var loadingMore = false
    @State private var error: String?
    @State private var selectedMemory: JarvisMemoryItem?
    @State private var loadGeneration = 0

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if loading && memories.isEmpty {
                ProgressView(copy(.loading))
            } else if memories.isEmpty {
                Text(copy(.noMemories)).foregroundStyle(.secondary)
            }
            ForEach(memories) { memory in
                Button {
                    selectedMemory = memory
                } label: {
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.settingsSectionSpacing / 2) {
                        Text(memory.title)
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text(memory.text)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
            }
            if hasMore {
                Button(loadingMore ? copy(.loading) : copy(.loadMore)) {
                    Task { await loadMore() }
                }
                .disabled(loadingMore)
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(copy(.memoryRow))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: copy(.memorySearch))
        .onSubmit(of: .search) { Task { await load(reset: true) } }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load(reset: true) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading || loadingMore)
                .accessibilityLabel(copy(.refresh))
            }
        }
        .task(id: query) {
            if hasLoaded {
                do {
                    try await Task.sleep(for: .milliseconds(250))
                    try Task.checkCancellation()
                } catch {
                    return
                }
            }
            await load(reset: true)
        }
        .sheet(item: $selectedMemory) { memory in
            NavigationStack {
                JarvisMemoryEditorView(
                    client: client,
                    memory: memory,
                    language: language,
                    readOnly: readOnly,
                    onFailure: onFailure,
                    onDeleted: { id in memories.removeAll { $0.id == id } },
                    onSaved: { fresh in
                        if let index = memories.firstIndex(where: { $0.id == fresh.id }) {
                            memories[index] = fresh
                        }
                    }
                )
            }
        }
    }

    private func loadMore() async {
        guard hasMore else { return }
        loadingMore = true
        await load(reset: false)
        loadingMore = false
    }

    private func load(reset: Bool) async {
        loadGeneration += 1
        let generation = loadGeneration
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        if reset {
            loading = true
            offset = 0
        }
        do {
            let page = try await client.loadMemory(
                query: query.trimmingCharacters(in: .whitespacesAndNewlines),
                offset: reset ? 0 : offset + JarvisSettingsLogic.memoryPageSize
            )
            try Task.checkCancellation()
            guard loadGeneration == generation else { return }
            if reset {
                memories = page.items
            } else {
                memories.append(contentsOf: page.items)
            }
            offset = page.offset
            hasMore = page.hasMore
            hasLoaded = true
            error = nil
        } catch is CancellationError {
            if loadGeneration == generation { loading = false }
            return
        } catch {
            guard loadGeneration == generation else { return }
            self.error = copy(.loadFailed)
            onFailure(error)
        }
        if loadGeneration == generation {
            hasLoaded = true
            loading = false
        }
    }
}

private struct JarvisMemoryEditorView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void
    let onDeleted: (String) -> Void
    let onSaved: (JarvisMemoryItem) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var memory: JarvisMemoryItem
    @State private var draft: String
    @State private var loading = true
    @State private var loaded = false
    @State private var saving = false
    @State private var deleting = false
    @State private var error: String?
    @State private var notice: String?
    @State private var confirmDelete = false

    init(
        client: JarvisSettingsClient?,
        memory: JarvisMemoryItem,
        language: JarvisAppLanguage,
        readOnly: Bool,
        onFailure: @escaping (Error) -> Void,
        onDeleted: @escaping (String) -> Void,
        onSaved: @escaping (JarvisMemoryItem) -> Void
    ) {
        self.client = client
        self.language = language
        self.readOnly = readOnly
        self.onFailure = onFailure
        self.onDeleted = onDeleted
        self.onSaved = onSaved
        _memory = State(initialValue: memory)
        _draft = State(initialValue: memory.text)
    }

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    private var hasChanges: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines) != memory.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        JarvisForm {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).foregroundStyle(.secondary)
            }
            if loading {
                ProgressView(copy(.loading))
            } else if !loaded {
                Button(copy(.retry)) { Task { await load() } }
            } else {
                TextEditor(text: $draft)
                    .frame(minHeight: 180)
                    .accessibilityLabel(copy(.memoryText))
                    .disabled(readOnly || saving || deleting)
            }
            Button(copy(.delete), role: .destructive) {
                confirmDelete = true
            }
            .disabled(readOnly || loading || !loaded || saving || deleting)
        }
        .navigationTitle(memory.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? copy(.saving) : copy(.save)) { Task { await save() } }
                    .disabled(readOnly || loading || !loaded || saving || deleting || !hasChanges || !validText)
            }
        }
        .task { await load() }
        .confirmationDialog(copy(.memoryDeleteConfirm), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(copy(.delete), role: .destructive) { Task { await delete() } }
            Button(copy(.cancel), role: .cancel) {}
        }
    }

    private var validText: Bool {
        JarvisSettingsLogic.validMemoryText(draft)
    }

    private func load() async {
        loading = true
        error = nil
        guard let client else {
            loading = false
            error = copy(.unavailable)
            return
        }
        do {
            memory = try await client.readMemory(id: memory.id)
            draft = memory.text
            loaded = true
        } catch {
            self.error = copy(.loadFailed)
            onFailure(error)
        }
        loading = false
    }

    private func save() async {
        guard let client, loaded, hasChanges, validText, !readOnly else { return }
        saving = true
        error = nil
        notice = nil
        do {
            try await client.updateMemory(id: memory.id, text: draft.trimmingCharacters(in: .whitespacesAndNewlines))
            let updated = JarvisMemoryItem(
                id: memory.id,
                kind: memory.kind,
                title: memory.title,
                folder: memory.folder,
                text: draft.trimmingCharacters(in: .whitespacesAndNewlines),
                updatedAt: nil
            )
            memory = updated
            draft = updated.text
            onSaved(updated)
            notice = copy(.saved)
        } catch {
            self.error = copy(.saveFailed)
            onFailure(error)
        }
        saving = false
    }

    private func delete() async {
        guard let client, !readOnly, !deleting else { return }
        deleting = true
        error = nil
        notice = nil
        do {
            let approvalPending = try await client.deleteMemory(id: memory.id)
            if approvalPending {
                notice = copy(.deletePending)
            } else {
                onDeleted(memory.id)
                dismiss()
            }
        } catch {
            self.error = copy(.deleteFailed)
            onFailure(error)
        }
        deleting = false
    }
}

enum JarvisTargetSettingsKind: Equatable {
    case training
    case nutrition

    var keys: [String] {
        switch self {
        case .training: ["gymSessionsPerWeek", "runSessionsPerWeek", "dailySteps"]
        case .nutrition: ["restingKcal", "deficitKcal", "proteinGrams"]
        }
    }

    func title(for key: String) -> JarvisSettingsLocalizationKey {
        switch (self, key) {
        case (.training, "gymSessionsPerWeek"): .trainingGym
        case (.training, "runSessionsPerWeek"): .trainingRun
        case (.training, "dailySteps"): .trainingSteps
        case (.nutrition, "restingKcal"): .nutritionResting
        case (.nutrition, "deficitKcal"): .nutritionDeficit
        case (.nutrition, "proteinGrams"): .nutritionProtein
        default: .newValue
        }
    }

    var screenTitle: JarvisSettingsLocalizationKey {
        self == .training ? .trainingTargetsRow : .nutritionTargetsRow
    }
}

struct JarvisTargetsSettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let kind: JarvisTargetSettingsKind
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @State private var targets: JarvisTargetValues?
    @State private var drafts: [String: String] = [:]
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    private var dirty: Bool {
        guard let targets else { return false }
        return kind.keys.contains { key in draftText(key, targets: targets) != (drafts[key] ?? "") }
    }

    private var valid: Bool {
        guard let targets else { return false }
        return kind.keys.allSatisfy { key in
            guard let bound = targets.bounds[key] else { return false }
            let text = (drafts[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { return true }
            guard text.range(of: #"^\d{1,9}$"#, options: .regularExpression) != nil,
                  let number = Int(text) else { return false }
            return JarvisSettingsLogic.validTarget(number, bound: bound)
        }
    }

    var body: some View {
        JarvisForm {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if loading && targets == nil {
                ProgressView(copy(.loading))
            } else if let targets {
                ForEach(kind.keys, id: \.self) { key in
                    if let bound = targets.bounds[key] {
                        VStack(alignment: .leading, spacing: JarvisDesignTokens.settingsSectionSpacing / 2) {
                            TextField(copy(kind.title(for: key)), text: Binding(
                                get: { drafts[key] ?? "" },
                                set: { drafts[key] = $0; error = nil }
                            ))
                            .keyboardType(.numberPad)
                            .accessibilityLabel(copy(kind.title(for: key)))
                            Text("\(bound.min)–\(bound.max) \(localizedUnit(bound.unit))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .disabled(readOnly || saving)
                    }
                }
            } else {
                Button(copy(.retry)) { Task { await load() } }
            }
        }
        .navigationTitle(copy(kind.screenTitle))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? copy(.saving) : copy(.save)) { Task { await save() } }
                    .disabled(readOnly || loading || saving || !dirty || !valid)
            }
        }
        .task {
            if targets == nil { await load() }
        }
        .onChange(of: readOnly) { _, value in
            if value { error = copy(.readOnly) }
        }
    }

    private func draftText(_ key: String, targets: JarvisTargetValues) -> String {
        guard let value = targets.targets[key] else { return "" }
        return value.integerValue.map(String.init) ?? ""
    }

    private func load() async {
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        do {
            let fresh: JarvisTargetValues
            switch kind {
            case .training: fresh = try await client.loadTrainingTargets()
            case .nutrition: fresh = try await client.loadNutritionTargets()
            }
            targets = fresh
            drafts = Dictionary(uniqueKeysWithValues: kind.keys.map { ($0, draftText($0, targets: fresh)) })
            error = nil
        } catch {
            self.error = copy(.loadFailed)
            onFailure(error)
        }
        loading = false
    }

    private func save() async {
        guard let client, let targets, !readOnly, dirty, valid else { return }
        var changes: [String: Int?] = [:]
        for key in kind.keys where draftText(key, targets: targets) != (drafts[key] ?? "") {
            let raw = (drafts[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            changes.updateValue(raw.isEmpty ? nil : Int(raw), forKey: key)
        }
        guard !changes.isEmpty else { return }
        saving = true
        error = nil
        do {
            let fresh: JarvisTargetValues
            switch kind {
            case .training: fresh = try await client.saveTrainingTargets(changes, bounds: targets.bounds)
            case .nutrition: fresh = try await client.saveNutritionTargets(changes, bounds: targets.bounds)
            }
            self.targets = fresh
            drafts = Dictionary(uniqueKeysWithValues: kind.keys.map { ($0, draftText($0, targets: fresh)) })
            error = copy(.saved)
        } catch {
            self.error = copy(.saveFailed)
            onFailure(error)
        }
        saving = false
    }

    private func localizedUnit(_ value: String) -> String {
        switch value {
        case "sessions": language == .da ? "pas" : "sessions"
        case "steps": language == .da ? "skridt" : "steps"
        case "kcal": "kcal"
        case "g": language == .da ? "g" : "g"
        default: value
        }
    }
}

struct JarvisHealthCredentialView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let onFailure: (Error) -> Void

    @State private var credential: JarvisHealthUploadCredential?
    @State private var loading = true
    @State private var error: String?

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisForm {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if loading && credential == nil {
                ProgressView(copy(.loading))
            } else if let credential {
                LabeledContent(copy(.credentialState), value: statusTitle(credential.state))
                if let expiresAt = credential.expiresAt {
                    LabeledContent(copy(.credentialExpiry), value: formattedDate(expiresAt))
                }
            } else {
                Button(copy(.retry)) { Task { await load() } }
            }
        }
        .navigationTitle(copy(.uploadCredentialRow))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading)
                .accessibilityLabel(copy(.refresh))
            }
        }
        .task {
            if credential == nil { await load() }
        }
    }

    private func load() async {
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        do {
            credential = try await client.loadHealthUploadCredential()
            error = nil
        } catch {
            self.error = copy(.loadFailed)
            onFailure(error)
        }
        loading = false
    }

    private func statusTitle(_ value: String) -> String {
        let key: JarvisSettingsLocalizationKey = switch value {
        case "active": .healthActive
        case "revoked": .healthRevoked
        case "expired": .healthExpired
        case "empty": .healthEmpty
        default: .statusUnknown
        }
        return copy(key)
    }

    private func formattedDate(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(.dateTime.year().month(.abbreviated).day().locale(language.locale))
    }
}

struct JarvisOwnerSettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let onFailure: (Error) -> Void

    @State private var name: String?
    @State private var loading = true
    @State private var error: String?

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisForm {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if loading && name == nil {
                ProgressView(copy(.loading))
            } else if let name {
                LabeledContent(copy(.ownerRow), value: name)
            } else {
                Button(copy(.retry)) { Task { await load() } }
            }
        }
        .navigationTitle(copy(.ownerRow))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if name == nil { await load() }
        }
    }

    private func load() async {
        guard let client else {
            error = copy(.ownerUnavailable)
            loading = false
            return
        }
        loading = true
        do {
            name = try await client.loadOwnerProfile().name
            error = nil
        } catch {
            self.error = copy(.ownerUnavailable)
            onFailure(error)
        }
        loading = false
    }
}

struct JarvisCredentialsSettingsView: View {
    let client: JarvisSettingsClient?
    let credentials: [JarvisCredential]
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onCredentialChanged: (JarvisCredential) -> Void
    let onFailure: (Error) -> Void

    @State private var renewing: String?
    @State private var error: String?

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if credentials.isEmpty {
                Text(copy(.noCredentials)).foregroundStyle(.secondary)
            }
            ForEach(credentials) { credential in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.settingsSectionSpacing) {
                    HStack {
                        Text(credentialTitle(credential.name))
                            .font(.body.weight(.medium))
                        Spacer()
                        Text(statusTitle(credential.status))
                            .foregroundStyle(.secondary)
                    }
                    if let expiry = credential.expiresAt {
                        LabeledContent(copy(.credentialExpiry), value: formattedDate(expiry))
                    }
                    if let renewed = credential.lastRenewedAt {
                        LabeledContent(copy(.lastRenewed), value: formattedDate(renewed))
                    }
                    if credential.name == "codex-login" {
                        Button(renewing == credential.name ? copy(.saving) : copy(.renew)) {
                            Task { await renew(credential.name) }
                        }
                        .buttonStyle(.glass)
                        .disabled(readOnly || renewing != nil)
                    }
                }

                .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(copy(.credentialsRow))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func renew(_ name: String) async {
        guard let client, !readOnly, renewing == nil else { return }
        renewing = name
        error = nil
        do {
            onCredentialChanged(try await client.renewCredential(named: name))
        } catch {
            self.error = copy(.renewalFailed)
            onFailure(error)
        }
        renewing = nil
    }

    private func credentialTitle(_ name: String) -> String {
        switch name {
        case "codex-login": copy(.codex)
        case "copilot-token": copy(.copilot)
        case "github-app": copy(.githubApp)
        default: name
        }
    }

    private func statusTitle(_ status: String) -> String {
        let key: JarvisSettingsLocalizationKey = switch status {
        case "ok": .statusOK
        case "renew_soon": .statusRenewSoon
        case "failed": .statusFailed
        default: .statusUnknown
        }
        return copy(key)
    }

    private func formattedDate(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(.dateTime.year().month(.abbreviated).day().locale(language.locale))
    }
}
