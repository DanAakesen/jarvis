import JarvisCore
import SwiftUI

struct WorkspacesView: View {
    @ObservedObject var runtime: WorkspaceRuntime
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @State private var loadState: LoadState = .loading
    @State private var signInRequired = false
    @State private var items: [SavedWorkspaceItem] = []
    @State private var query = ""
    @State private var selectedKind: SavedWorkspaceKind?
    @State private var reloadID = 0
    @State private var loadedFilterKey = ""
    @State private var busyItems: Set<String> = []
    @State private var loadingOlder = false
    @State private var hasMore = false
    @State private var notice: String?
    @State private var openedItemID: String?
    @State private var openedFeedbackTask: Task<Void, Never>?
    @State private var renameTarget: SavedWorkspaceItem?
    @State private var renameTitle = ""
    @State private var removeTarget: SavedWorkspaceItem?

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    var body: some View {
        VStack(spacing: 0) {
            connectionStatus
            kindFilters
            if let notice {
                Text(notice)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, JarvisDesignTokens.contentInset)
                    .padding(.vertical, JarvisDesignTokens.contentSpacing / 2)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            results
        }
        .background(JarvisScreenBackground())
        .navigationTitle(text(.title))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: refresh) {
                    if loadState == .loading {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .disabled(loadState == .loading)
                .accessibilityLabel(text(.refreshAccessibility))
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            searchField
                .padding(.top, JarvisDesignTokens.contentSpacing / 2)
                .padding(.bottom, JarvisDesignTokens.contentSpacing / 2)
                .background(.regularMaterial)
        }
        .task(id: "\(query)|\(selectedKind?.rawValue ?? "")|\(reloadID)") {
            do {
                let filterKey = "\(query)|\(selectedKind?.rawValue ?? "")"
                if loadedFilterKey != filterKey {
                    items = []
                    hasMore = false
                    loadState = .loading
                }
                try await Task.sleep(for: .milliseconds(JarvisDesignTokens.searchDebounceMilliseconds))
                await load()
            } catch {
                return
            }
        }
        .alert(
            text(.rename),
            isPresented: Binding(
                get: { renameTarget != nil },
                set: { if !$0 { renameTarget = nil } }
            )
        ) {
            TextField(text(.titleField), text: $renameTitle)
                .textInputAutocapitalization(.sentences)
            Button(text(.save)) { Task { await rename() } }
                .disabled(renameTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button(text(.cancel), role: .cancel) { renameTarget = nil }
        }
        .confirmationDialog(
            removeTarget.map { formatted(.removeQuestion, $0.title) } ?? text(.removeFallbackQuestion),
            isPresented: Binding(
                get: { removeTarget != nil },
                set: { if !$0 { removeTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(text(.remove), role: .destructive) { Task { await remove() } }
            Button(text(.cancel), role: .cancel) { removeTarget = nil }
        } message: {
            Text(text(.removeMessage))
        }
        .environment(\.locale, language.locale)
    }

    private var connectionStatus: some View {
        Label(runtime.connectionStatus.title(language: language), systemImage: runtime.connectionStatus.symbolName)
            .font(.footnote)
            .foregroundStyle(runtime.connectionStatus == .connected ? Color.secondary : Color.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, JarvisDesignTokens.contentInset)
            .padding(.top, JarvisDesignTokens.contentSpacing)
            .accessibilityLabel(formatted(.connectionLabel, runtime.connectionStatus.title(language: language)))
    }

    private var kindFilters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: JarvisDesignTokens.rowSpacing) {
                kindFilterButton(title: text(.allKinds), kind: nil)
                ForEach(SavedWorkspaceKind.allCases, id: \.self) { kind in
                    kindFilterButton(title: kindLabel(kind), kind: kind)
                }
            }
            .padding(.horizontal, JarvisDesignTokens.contentInset)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel(text(.filterByKind))
    }

    private func kindFilterButton(title: String, kind: SavedWorkspaceKind?) -> some View {
        let selected = selectedKind == kind
        return Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: JarvisDesignTokens.filterAnimationDuration)) {
                selectedKind = selected ? nil : kind
            }
        } label: {
            HStack(spacing: JarvisDesignTokens.iconLabelSpacing) {
                if selected { Image(systemName: "checkmark") }
                Text(title)
            }
            .font(.subheadline.weight(selected ? .semibold : .regular))
            .foregroundStyle(selected ? Color.accentColor : Color.primary)
            .frame(minHeight: JarvisDesignTokens.controlMinimumHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var searchField: some View {
        HStack(spacing: JarvisDesignTokens.rowSpacing) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(text(.search), text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityLabel(text(.search))
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .frame(minWidth: JarvisDesignTokens.controlMinimumHeight, minHeight: JarvisDesignTokens.controlMinimumHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(text(.clearSearch))
            }
        }
        .padding(.leading, JarvisDesignTokens.contentInset)
        .padding(.trailing, query.isEmpty ? JarvisDesignTokens.contentInset : 4)
        .frame(minHeight: JarvisDesignTokens.controlMinimumHeight)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.horizontal, JarvisDesignTokens.contentInset)
        .padding(.bottom, JarvisDesignTokens.contentSpacing / 2)
    }

    private var results: some View {
        List {
            if loadState == .loading && items.isEmpty {
                Section {
                    ProgressView(text(.loading))
                        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
                        .listRowSeparator(.hidden)
                }
            } else if items.isEmpty {
                Section {
                    statePanel
                        .listRowSeparator(.hidden)
                }
            } else {
                if loadState == .stale {
                    Section {
                        Label(text(.offlineSaved), systemImage: "wifi.slash")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, JarvisDesignTokens.listRowVerticalInset)
                            .listRowSeparator(.hidden)
                    }
                }
                ForEach(SavedWorkspaceGrouping.groups(items, now: Date()), id: \.title) { group in
                    Section {
                        ForEach(group.items) { item in
                            workspaceRow(item)
                        }
                    } header: {
                        Text(groupTitle(group.title))
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .textCase(nil)
                    }
                }
                if hasMore {
                    Section {
                        Button {
                            Task { await loadOlder() }
                        } label: {
                            HStack {
                                Spacer()
                                Text(text(.showOlder))
                                Spacer()
                            }
                            .frame(minHeight: JarvisDesignTokens.controlMinimumHeight)
                        }
                        .disabled(loadState == .loading || loadingOlder)
                        .listRowSeparator(.hidden)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
    }

    @ViewBuilder
    private var statePanel: some View {
        switch loadState {
        case .loading:
            ProgressView(text(.loading))
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
        case .ready where !normalizedQuery(query).isEmpty || selectedKind != nil:
            VStack(spacing: JarvisDesignTokens.contentSpacing) {
                Label(text(.noMatching), systemImage: "magnifyingglass")
                    .font(.headline)
                Button(text(.clearFilters)) {
                    query = ""
                    selectedKind = nil
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
        case .ready:
            Label(text(.noSavedItems), systemImage: "square.stack.3d.up")
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
        case .error, .stale:
            VStack(spacing: JarvisDesignTokens.contentSpacing) {
                Label(errorTitle, systemImage: "exclamationmark.triangle")
                    .font(.headline)
                if runtime.workspacesClient != nil && !signInRequired {
                    Button(text(.retry), action: refresh)
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.accentColor)
                }
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.emptyStateHeight)
        }
    }

    private func workspaceRow(_ item: SavedWorkspaceItem) -> some View {
        HStack(alignment: .top, spacing: JarvisDesignTokens.rowSpacing) {
            Button {
                Task { await open(item) }
            } label: {
                HStack(alignment: .top, spacing: JarvisDesignTokens.rowSpacing) {
                    Image(systemName: symbol(for: item.kind))
                        .font(.system(size: JarvisDesignTokens.iconSize))
                        .foregroundStyle(.secondary)
                        .frame(width: JarvisDesignTokens.iconSize, height: JarvisDesignTokens.iconSize)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(item.title)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                                .lineLimit(2)
                            Spacer(minLength: 4)
                            if openedItemID == item.id {
                                Label(text(.opened), systemImage: "checkmark")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Text(formatWhen(item.createdAt))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Text(kindLabel(item.kind))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if !item.promptSummary.isEmpty {
                            Text(item.promptSummary)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.controlMinimumHeight, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busyItems.contains(item.id))
            .accessibilityLabel(formatted(.openItem, item.title, kindLabel(item.kind), formatWhen(item.createdAt)))
            .accessibilityHint(item.promptSummary.isEmpty ? "" : item.promptSummary)

            Menu {
                Button(text(item.pinned ? .unpin : .pin), systemImage: item.pinned ? "pin.slash" : "pin") {
                    Task { await setPinned(item, pinned: !item.pinned) }
                }
                Button(text(.rename), systemImage: "pencil") {
                    renameTarget = item
                    renameTitle = item.title
                }
                Button(text(.remove), systemImage: "trash", role: .destructive) {
                    removeTarget = item
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: JarvisDesignTokens.iconSize, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(minWidth: JarvisDesignTokens.controlMinimumHeight, minHeight: JarvisDesignTokens.controlMinimumHeight)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(formatted(.actionsFor, item.title))
            .disabled(busyItems.contains(item.id))
        }
        .padding(.vertical, JarvisDesignTokens.listRowVerticalInset)
        .listRowInsets(EdgeInsets(
            top: 0,
            leading: JarvisDesignTokens.contentInset,
            bottom: 0,
            trailing: JarvisDesignTokens.contentInset / 2
        ))
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            Button(text(item.pinned ? .unpin : .pin), systemImage: item.pinned ? "pin.slash" : "pin") {
                Task { await setPinned(item, pinned: !item.pinned) }
            }
            .tint(.accentColor)
            .disabled(busyItems.contains(item.id))
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(text(.remove), systemImage: "trash", role: .destructive) {
                removeTarget = item
            }
            .disabled(busyItems.contains(item.id))
        }
    }

    private var errorTitle: String {
        if signInRequired { return text(.signInRequired) }
        guard runtime.workspacesClient != nil else { return text(.configurationRequired) }
        if case .stale = loadState { return text(.unavailable) }
        return text(.loadFailed)
    }

    private func refresh() {
        loadState = .loading
        reloadID += 1
    }

    private func load() async {
        guard let client = runtime.workspacesClient else {
            loadState = .error
            return
        }
        loadState = .loading
        signInRequired = false
        notice = nil
        do {
            let page = try await client.search(query: normalizedQuery(query), kind: selectedKind)
            guard !Task.isCancelled else { return }
            items = page
            hasMore = page.count >= JarvisWorkspacesClient.pageSize
            loadedFilterKey = "\(query)|\(selectedKind?.rawValue ?? "")"
            loadState = .ready
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            signInRequired = (error as? JarvisClientError) == .signInRequired
            loadState = items.isEmpty ? .error : .stale
            notice = items.isEmpty ? nil : text(.offlineNotice)
        }
    }

    private func loadOlder() async {
        guard !loadingOlder,
              let client = runtime.workspacesClient,
              let oldest = items.min(by: { date(from: $0.createdAt) < date(from: $1.createdAt) }) else {
            return
        }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await client.search(query: normalizedQuery(query), kind: selectedKind, before: oldest.createdAt)
            let knownIDs = Set(items.map(\.id))
            items.append(contentsOf: page.filter { !knownIDs.contains($0.id) })
            hasMore = page.count >= JarvisWorkspacesClient.pageSize
            notice = nil
        } catch {
            notice = text(.olderLoadFailed)
        }
    }

    private func open(_ item: SavedWorkspaceItem) async {
        guard let client = runtime.workspacesClient else { return }
        setBusy(item.id, true)
        defer { setBusy(item.id, false) }
        do {
            _ = try await client.open(item)
            showOpenedFeedback(for: item.id)
            notice = nil
        } catch {
            if let workspaceError = error as? WorkspacesClientError,
               workspaceError == .itemNotFound {
                items.removeAll { $0.id == item.id }
                notice = text(.itemUnavailable)
            } else {
                notice = text(.openFailed)
            }
        }
    }

    private func setPinned(_ item: SavedWorkspaceItem, pinned: Bool) async {
        guard let client = runtime.workspacesClient else { return }
        setBusy(item.id, true)
        defer { setBusy(item.id, false) }
        do {
            let updated = try await client.setPinned(item, pinned: pinned)
            replace(updated)
            notice = nil
        } catch {
            if let workspaceError = error as? WorkspacesClientError,
               workspaceError == .itemNotFound {
                items.removeAll { $0.id == item.id }
                notice = text(.itemUnavailable)
            } else {
                notice = text(.pinFailed)
            }
        }
    }

    private func rename() async {
        guard let item = renameTarget, let client = runtime.workspacesClient else { return }
        setBusy(item.id, true)
        defer {
            setBusy(item.id, false)
            renameTarget = nil
        }
        do {
            let updated = try await client.rename(item, title: renameTitle)
            replace(updated)
            notice = nil
        } catch {
            if let workspaceError = error as? WorkspacesClientError,
               workspaceError == .itemNotFound {
                items.removeAll { $0.id == item.id }
                notice = text(.itemUnavailable)
            } else {
                notice = text(.titleSaveFailed)
            }
        }
    }

    private func remove() async {
        guard let item = removeTarget, let client = runtime.workspacesClient else { return }
        setBusy(item.id, true)
        defer {
            setBusy(item.id, false)
            removeTarget = nil
        }
        do {
            try await client.remove(item)
            items.removeAll { $0.id == item.id }
            if openedItemID == item.id {
                openedFeedbackTask?.cancel()
                openedItemID = nil
            }
            notice = text(.removed)
        } catch {
            if let workspaceError = error as? WorkspacesClientError,
               workspaceError == .itemNotFound {
                items.removeAll { $0.id == item.id }
                notice = text(.itemUnavailable)
            } else {
                notice = text(.removeFailed)
            }
        }
    }

    private func replace(_ updated: SavedWorkspaceItem) {
        items = items.map { $0.id == updated.id ? updated : $0 }
    }

    private func setBusy(_ id: String, _ busy: Bool) {
        if busy { busyItems.insert(id) } else { busyItems.remove(id) }
    }

    private func showOpenedFeedback(for id: String) {
        openedFeedbackTask?.cancel()
        openedItemID = id
        openedFeedbackTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .milliseconds(JarvisDesignTokens.openedFeedbackMilliseconds))
                guard !Task.isCancelled, openedItemID == id else { return }
                openedItemID = nil
            } catch {}
        }
    }

    private func normalizedQuery(_ value: String) -> String {
        var result = ""
        for character in value.trimmingCharacters(in: .whitespacesAndNewlines) {
            guard (result + String(character)).utf16.count <= 120 else { break }
            result.append(character)
        }
        return result
    }

    private func date(from value: String) -> Date {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value) ?? .distantPast
    }

    private func formatWhen(_ value: String) -> String {
        let date = date(from: value)
        return Calendar.current.isDateInToday(date)
            ? date.formatted(.dateTime.hour().minute().locale(language.locale))
            : date.formatted(.dateTime.month(.abbreviated).day().locale(language.locale))
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }

    private func formatted(_ key: JarvisWorkspaceLocalizationKey, _ arguments: CVarArg...) -> String {
        JarvisWorkspaceLocalization.formatted(key, language: language, arguments: arguments)
    }

    private func groupTitle(_ title: String) -> String {
        let key: JarvisWorkspaceLocalizationKey
        switch title {
        case "Pinned": key = .groupPinned
        case "Today": key = .groupToday
        case "This week": key = .groupWeek
        default: key = .groupEarlier
        }
        return text(key)
    }

    private func kindLabel(_ kind: SavedWorkspaceKind) -> String {
        let key: JarvisWorkspaceLocalizationKey
        switch kind {
        case .research: key = .kindReports
        case .htmlApp: key = .kindApps
        case .image: key = .kindImages
        case .knowledgeGraph: key = .kindGraphs
        }
        return text(key)
    }

    private func symbol(for kind: SavedWorkspaceKind) -> String {
        switch kind {
        case .research: "doc.text"
        case .htmlApp: "square.grid.2x2"
        case .image: "photo"
        case .knowledgeGraph: "point.3.connected.trianglepath.dotted"
        }
    }
}

private enum LoadState: Equatable {
    case loading
    case ready
    case error
    case stale
}

#Preview {
    NavigationStack {
        WorkspacesView(runtime: WorkspaceRuntime(client: nil, webAppURL: nil))
    }
}
