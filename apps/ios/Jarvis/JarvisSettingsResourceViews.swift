import CryptoKit
import JarvisCore
import SwiftUI

private func settingsCacheDigest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

struct JarvisProactiveSettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @State private var settings: JarvisProactiveSettings?
    @State private var draftPaused = false
    @State private var loadGeneration = 0
    @State private var loadFailed = false
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
            Toggle(copy(.proactiveSuggestions), isOn: Binding(
                    get: { !draftPaused },
                    set: { draftPaused = !$0; error = nil }
            ))
            .disabled(settings == nil || readOnly || saving)
            .accessibilityHint(settings == nil ? copy(loading ? .loading : .unavailable) : (readOnly ? copy(.readOnly) : ""))
            .accessibilityValue(settings == nil ? copy(loading ? .loading : .statusUnknown) : copy(draftPaused ? .paused : .running))
            if settings != nil {
                Text(copy(draftPaused ? .paused : .running))
                    .foregroundStyle(.secondary)
            } else if loading {
                JarvisLoadingView(title: copy(.loading))
            }
            if loadFailed {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading || saving) { Task { await load(force: true) } }
            }
        }
        .navigationTitle(copy(.proactiveRow))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSheetConfirmButton(title: copy(.save), isWorking: saving, isDisabled: readOnly || settings == nil || saving || !isDirty) { Task { await save() } }
                    .accessibilityHint(settings == nil ? copy(loading ? .loading : .unavailable) : (readOnly ? copy(.readOnly) : ""))
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .task {
            if settings == nil { await load() }
        }
        .onDisappear { loadGeneration += 1; loading = false }
        .onChange(of: readOnly) { _, value in
            if value { error = copy(.readOnly) }
        }
    }

    private func load(force: Bool = true) async {
        loadGeneration += 1
        let generation = loadGeneration
        defer { if loadGeneration == generation { loading = false } }
        guard let client else {
            loadFailed = true
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        let repository: JarvisRepository<JarvisProactiveSettings> = await JarvisAppCache.repository(.settings, scope: "proactive") { _ in
            .modified(try await client.loadProactiveSettings(), validator: nil)
        }
        guard !Task.isCancelled, loadGeneration == generation else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            switch update {
            case .cached(let fresh, _), .fresh(let fresh):
                if !isDirty {
                    settings = fresh
                    draftPaused = fresh.paused
                }
                error = nil
                loadFailed = false
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.loadFailed)
                loadFailed = true
                onFailure(failure)
            }
        }
        loading = false
    }

    private func save() async {
        guard let client, let settings, isDirty, !readOnly, !saving else { return }
        loadGeneration += 1
        loading = false
        saving = true
        error = nil
        do {
            let saved = try await client.saveProactivePaused(draftPaused, expectedRevision: settings.revision)
            self.settings = saved
            draftPaused = saved.paused
            await JarvisAppCache.invalidate(.settings, scope: "proactive")
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
    @State private var hasLoaded = false
    @State private var loadGeneration = 0
    @State private var loading = true
    @State private var error: String?
    @State private var deleting = false

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if loading && !hasLoaded {
                JarvisLoadingView(title: copy(.loading))
            } else if hasLoaded && routines.isEmpty {
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
                    JarvisIconButton(
                        title: copy(.delete),
                        systemImage: "trash",
                        identifier: "settings.routine.delete",
                        isDisabled: readOnly || deleting,
                        tint: .red
                    ) { Task { await delete(routine) } }
                    .accessibilityHint(readOnly ? copy(.readOnly) : "")
                }
                .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
            }
            if error != nil {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading) { Task { await load(force: true) } }
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(copy(.routinesRow))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(force: true) }
        .task {
            if !hasLoaded { await load() }
        }
        .onDisappear { loadGeneration += 1; loading = false }

    }

    private func load(force: Bool = true) async {
        guard !deleting else { return }
        loadGeneration += 1
        let generation = loadGeneration
        defer { if loadGeneration == generation { loading = false } }
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        let repository: JarvisRepository<[JarvisRoutine]> = await JarvisAppCache.repository(.settings, scope: "routines") { _ in
            .modified(try await client.loadRoutines(), validator: nil)
        }
        guard !Task.isCancelled, loadGeneration == generation else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            switch update {
            case .cached(let fresh, _), .fresh(let fresh):
                routines = fresh
                hasLoaded = true
                error = nil
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.loadFailed)
                onFailure(failure)
            }
        }
        loading = false
    }

    private func delete(_ routine: JarvisRoutine) async {
        guard let client, !readOnly, !deleting else { return }
        loadGeneration += 1
        loading = false
        deleting = true
        error = nil
        do {
            try await client.deleteRoutine(id: routine.id)
            routines.removeAll { $0.id == routine.id }
            await JarvisAppCache.invalidate(.settings, scope: "routines")
        } catch {
            self.error = copy(.deleteFailed)
            onFailure(error)
        }
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
    @State private var loadedQuery: String?

    private var currentQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var showsCurrentResults: Bool { loadedQuery == currentQuery }

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if loading && !showsCurrentResults {
                JarvisLoadingView(title: copy(.loading))
            } else if showsCurrentResults && memories.isEmpty {
                Text(copy(.noMemories)).foregroundStyle(.secondary)
            }
            ForEach(showsCurrentResults ? memories : []) { memory in
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
            if showsCurrentResults && hasMore {
                JarvisLabelledButton(
                    title: loadingMore ? copy(.loading) : copy(.loadMore),
                    isDisabled: loadingMore || loading
                ) { Task { await loadMore() } }
            }
            if error != nil {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading || loadingMore) {
                    Task { await load(reset: true, force: true) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(copy(.memoryRow))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: copy(.memorySearch))
        .onSubmit(of: .search) { Task { await load(reset: true, force: true) } }
        .onChange(of: query) { _, _ in
            loading = true
            loadingMore = false
            error = nil
            selectedMemory = nil
        }
        .refreshable { await load(reset: true, force: true) }
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
        .onDisappear { loadGeneration += 1; loading = false; loadingMore = false }
        .sheet(item: $selectedMemory) { memory in
            NavigationStack {
                JarvisMemoryEditorView(
                    client: client,
                    memory: memory,
                    language: language,
                    readOnly: readOnly,
                    onFailure: onFailure,
                    onDeleted: { id in
                        loadGeneration += 1
                        loading = false
                        memories.removeAll { $0.id == id }
                    },
                    onSaved: { fresh in
                        loadGeneration += 1
                        loading = false
                        if let index = memories.firstIndex(where: { $0.id == fresh.id }) {
                            memories[index] = fresh
                        }
                    }
                )
                .id(memory.id)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    private func loadMore() async {
        guard showsCurrentResults, hasMore, !loadingMore, !loading else { return }
        loadingMore = true
        await load(reset: false)
    }

    private func load(reset: Bool, force: Bool = true) async {
        loadGeneration += 1
        let generation = loadGeneration
        let requestedQuery = currentQuery
        let requestedOffset = reset ? 0 : offset + JarvisSettingsLogic.memoryPageSize
        let previousItems = reset ? [] : memories
        defer {
            if loadGeneration == generation {
                loading = false
                loadingMore = false
            }
        }
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        if reset {
            loading = true
        }
        let repository: JarvisRepository<JarvisMemoryPage> = await JarvisAppCache.repository(
            .settings, scope: "memory:\(settingsCacheDigest(requestedQuery)):\(requestedOffset)"
        ) { _ in
            .modified(try await client.loadMemory(query: requestedQuery, offset: requestedOffset), validator: nil)
        }
        guard !Task.isCancelled, loadGeneration == generation, currentQuery == requestedQuery else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation, currentQuery == requestedQuery else { return }
            if case .cached = update, reset, showsCurrentResults && hasLoaded { continue }
            switch update {
            case .cached(let page, _), .fresh(let page):
                memories = previousItems + page.items
                offset = page.offset
                loadedQuery = requestedQuery
                hasMore = page.hasMore
                hasLoaded = true
                error = nil
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.loadFailed)
                onFailure(failure)
            }
        }
        if loadGeneration == generation {
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
    @State private var loadGeneration = 0
    @State private var draft: String
    @State private var loading = true
    @State private var loaded = false
    @State private var saving = false
    @State private var deleting = false
    @State private var error: String?
    @State private var notice: String?

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
            VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                Text(copy(.memoryText)).foregroundStyle(.primary)
                TextEditor(text: $draft)
                    .frame(minHeight: 180)
                    .accessibilityLabel(copy(.memoryText))
                    .disabled(!loaded || readOnly || saving || deleting)
                    .accessibilityHint(!loaded ? copy(loading ? .loading : .unavailable) : (readOnly ? copy(.readOnly) : ""))
            }
            if loading && !loaded {
                JarvisLoadingView(title: copy(.loading))
            }
            if error != nil {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading || saving || deleting) { Task { await load(force: true) } }
            }
            JarvisLabelledButton(
                title: copy(.delete),
                isDisabled: readOnly || !loaded || saving || deleting,
                isDestructive: true
            ) { Task { await delete() } }
            .accessibilityHint(!loaded ? copy(loading ? .loading : .unavailable) : (readOnly ? copy(.readOnly) : ""))
        }
        .navigationTitle(memory.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSheetConfirmButton(title: copy(.save), isWorking: saving, isDisabled: readOnly || !loaded || saving || deleting || !hasChanges || !validText) { Task { await save() } }
                    .accessibilityHint(!loaded ? copy(loading ? .loading : .unavailable) : (readOnly ? copy(.readOnly) : ""))
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .task { if !loaded { await load() } }
        .onDisappear { loadGeneration += 1; loading = false }

    }

    private var validText: Bool {
        JarvisSettingsLogic.validMemoryText(draft)
    }

    private func load(force: Bool = true) async {
        loadGeneration += 1
        let generation = loadGeneration
        let memoryID = memory.id
        defer { if loadGeneration == generation { loading = false } }
        loading = true
        error = nil
        guard let client else {
            loading = false
            error = copy(.unavailable)
            return
        }
        let repository: JarvisRepository<JarvisMemoryItem> = await JarvisAppCache.repository(.settings, scope: "memoryItem:\(settingsCacheDigest(memoryID))") { _ in
            .modified(try await client.readMemory(id: memoryID), validator: nil)
        }
        guard !Task.isCancelled, loadGeneration == generation else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation, memory.id == memoryID else { return }
            switch update {
            case .cached(let fresh, _), .fresh(let fresh):
                if !hasChanges { draft = fresh.text }
                memory = fresh
                loaded = true
                error = nil
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.loadFailed)
                onFailure(failure)
            }
        }
        loading = false
    }

    private func save() async {
        guard let client, loaded, hasChanges, validText, !readOnly, !saving, !deleting else { return }
        loadGeneration += 1
        loading = false
        saving = true
        error = nil
        notice = nil
        do {
            try await client.updateMemory(id: memory.id, text: draft.trimmingCharacters(in: .whitespacesAndNewlines))
            await JarvisAppCache.invalidateAll(.settings)
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
        guard let client, loaded, !readOnly, !deleting, !saving else { return }
        loadGeneration += 1
        loading = false
        deleting = true
        error = nil
        notice = nil
        do {
            let approvalPending = try await client.deleteMemory(id: memory.id)
            if approvalPending {
                notice = copy(.deletePending)
            } else {
                await JarvisAppCache.invalidateAll(.settings)
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

enum JarvisTargetSettingsKind: Equatable, Sendable {
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
    @State private var loadGeneration = 0
    @State private var loadFailed = false
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
            ForEach(kind.keys, id: \.self) { key in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.settingsSectionSpacing / 2) {
                    JarvisSettingsTextField(title: copy(kind.title(for: key)), text: Binding(
                        get: { drafts[key] ?? "" },
                        set: { drafts[key] = $0; error = nil }
                    ), identifier: "settings.target.\(key)", keyboard: .numberPad)
                        .disabled(targets?.bounds[key] == nil || readOnly || saving)
                        .accessibilityHint(targets?.bounds[key] == nil ? copy(loading ? .loading : .unavailable) : (readOnly ? copy(.readOnly) : ""))
                    if let bound = targets?.bounds[key] {
                            Text("\(bound.min)–\(bound.max) \(localizedUnit(bound.unit))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                    } else if loading {
                        JarvisLoadingView(title: copy(.loading))
                    }
                }
            }
            if loadFailed {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading || saving) { Task { await load(force: true) } }
            }
        }
        .navigationTitle(copy(kind.screenTitle))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSheetConfirmButton(title: copy(.save), isWorking: saving, isDisabled: readOnly || targets == nil || saving || !dirty || !valid) { Task { await save() } }
                    .accessibilityHint(targets == nil ? copy(loading ? .loading : .unavailable) : (readOnly ? copy(.readOnly) : ""))
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .task {
            if targets == nil { await load() }
        }
        .onDisappear { loadGeneration += 1; loading = false }
        .onChange(of: readOnly) { _, value in
            if value { error = copy(.readOnly) }
        }
    }

    private func draftText(_ key: String, targets: JarvisTargetValues) -> String {
        guard let value = targets.targets[key] else { return "" }
        return value.integerValue.map(String.init) ?? ""
    }

    private func load(force: Bool = true) async {
        loadGeneration += 1
        let generation = loadGeneration
        defer { if loadGeneration == generation { loading = false } }
        guard let client else {
            loadFailed = true
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        let kind = kind
        let repository: JarvisRepository<JarvisTargetValues> = await JarvisAppCache.repository(
            .settings, scope: kind == .training ? "trainingTargets" : "nutritionTargets"
        ) { _ in
            switch kind {
            case .training: .modified(try await client.loadTrainingTargets(), validator: nil)
            case .nutrition: .modified(try await client.loadNutritionTargets(), validator: nil)
            }
        }
        guard !Task.isCancelled, loadGeneration == generation else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            switch update {
            case .cached(let fresh, _), .fresh(let fresh):
                if !dirty {
                    targets = fresh
                    drafts = Dictionary(uniqueKeysWithValues: kind.keys.map { ($0, draftText($0, targets: fresh)) })
                }
                error = nil
                loadFailed = false
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.loadFailed)
                loadFailed = true
                onFailure(failure)
            }
        }
        loading = false
    }

    private func save() async {
        guard let client, let targets, !readOnly, !saving, dirty, valid else { return }
        loadGeneration += 1
        loading = false
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
            await JarvisAppCache.invalidate(.settings, scope: kind == .training ? "trainingTargets" : "nutritionTargets")
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
    @State private var loadGeneration = 0
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
            LabeledContent(copy(.credentialState)) {
                if let credential {
                    Text(statusTitle(credential.state))
                } else if loading {
                    JarvisLoadingView(title: copy(.loading))
                } else {
                    Text(copy(.statusUnknown)).foregroundStyle(.secondary)
                }
            }
            LabeledContent(copy(.credentialExpiry)) {
                if let expiresAt = credential?.expiresAt {
                    Text(formattedDate(expiresAt))
                } else if credential != nil {
                    Text(copy(.none)).foregroundStyle(.secondary)
                } else if loading {
                    JarvisLoadingView(title: copy(.loading))
                } else {
                    Text(copy(.statusUnknown)).foregroundStyle(.secondary)
                }
            }
            if error != nil {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading) { Task { await load(force: true) } }
            }
        }
        .navigationTitle(copy(.uploadCredentialRow))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(force: true) }
        .task {
            if credential == nil { await load() }
        }
        .onDisappear { loadGeneration += 1; loading = false }
    }

    private func load(force: Bool = true) async {
        loadGeneration += 1
        let generation = loadGeneration
        defer { if loadGeneration == generation { loading = false } }
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        let repository: JarvisRepository<JarvisHealthUploadCredential> = await JarvisAppCache.repository(.settings, scope: "healthCredential") { _ in
            .modified(try await client.loadHealthUploadCredential(), validator: nil)
        }
        guard !Task.isCancelled, loadGeneration == generation else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            switch update {
            case .cached(let fresh, _), .fresh(let fresh):
                credential = fresh
                error = nil
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.loadFailed)
                onFailure(failure)
            }
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
    @State private var loadGeneration = 0
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
            LabeledContent(copy(.ownerRow)) {
                if let name {
                    Text(name)
                } else if loading {
                    JarvisLoadingView(title: copy(.loading))
                } else {
                    Text(copy(.statusUnknown)).foregroundStyle(.secondary)
                }
            }
            if error != nil {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading) { Task { await load(force: true) } }
            }
        }
        .navigationTitle(copy(.ownerRow))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if name == nil { await load() }
        }
        .onDisappear { loadGeneration += 1; loading = false }
    }

    private func load(force: Bool = true) async {
        loadGeneration += 1
        let generation = loadGeneration
        defer { if loadGeneration == generation { loading = false } }
        guard let client else {
            error = copy(.ownerUnavailable)
            loading = false
            return
        }
        loading = true
        let repository: JarvisRepository<JarvisOwnerProfile> = await JarvisAppCache.repository(.settings, scope: "owner") { _ in
            .modified(try await client.loadOwnerProfile(), validator: nil)
        }
        guard !Task.isCancelled, loadGeneration == generation else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            switch update {
            case .cached(let fresh, _), .fresh(let fresh):
                name = fresh.name
                error = nil
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.ownerUnavailable)
                onFailure(failure)
            }
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
                        JarvisLabelledButton(
                            title: renewing == credential.name ? copy(.saving) : copy(.renew),
                            isDisabled: readOnly || renewing != nil
                        ) {
                            Task { await renew(credential.name) }
                        }
                        .accessibilityHint(readOnly ? copy(.readOnly) : "")
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
