import JarvisCore
import SwiftUI

struct JarvisFactoryCopy {
    let language: JarvisAppLanguage

    func text(_ key: JarvisFactoryLocalizationKey) -> String {
        JarvisFactoryLocalization.string(key, language: language)
    }

    func column(_ id: FactoryBoardColumnID) -> String {
        switch id {
        case .inProgress: text(.inProgress)
        case .inReview: text(.inReview)
        case .ready: text(.ready)
        case .backlog: text(.backlog)
        case .needsDan: text(.needsDan)
        case .done: text(.done)
        }
    }

    func state(_ state: FactoryTaskState) -> String {
        switch state {
        case .ready: text(.ready)
        case .running: text(.running)
        case .pauseRequested: text(.pauseRequested)
        case .paused: text(.paused)
        case .needsAttention: text(.needsAttention)
        case .done: text(.done)
        case .cancelled: text(.cancelled)
        }
    }

    func agent(_ agent: FactoryAgent) -> String {
        agent == .codex ? text(.codex) : text(.copilot)
    }

    func releaseStatus(_ status: FactoryReleaseStatus) -> String {
        switch status {
        case .building: text(.building)
        case .deploying: text(.deploying)
        case .released: text(.released)
        case .failed: text(.failed)
        }
    }
}

enum JarvisFactoryPreviewState: String {
    case board
    case needs
    case releases
    case empty
    case loading
    case error
    case offline
    case stale
    case reconnecting
    case search
    case detail
    case release
    case steer
    case newtask

    var segment: FactorySegment {
        target.segment
    }

    var target: FactoryNavigationTarget {
        FactoryNavigationTarget(legacySegment: self == .release ? "releases" : rawValue)
    }
}

struct JarvisFactoryArea: View {
    let client: JarvisFactoryClient?
    let language: JarvisAppLanguage
    let onRetryConfiguration: () -> Void
    let previewState: JarvisFactoryPreviewState?
    let liveUpdatesEnabled: Bool

    @State private var segment: FactorySegment
    @State private var projects: [FactoryProject] = []
    @State private var selectedProjectID = ""
    @State private var board: FactoryBoard?
    @State private var releaseView: FactoryReleaseView?
    @State private var projectLoading = true
    @State private var contentLoading = false
    @State private var refreshing = false
    @State private var projectsError = false
    @State private var contentError = false
    @State private var connection: FactoryConnectionState = .connected
    @State private var boardEventFailures = 0
    @State private var boardRetrySeconds = 1
    @State private var refreshVersion = 0
    @State private var searchText = ""
    @State private var selectedAgent = ""
    @State private var selectedState = ""
    @State private var collapsedColumns = JarvisFactoryPresentation.defaultCollapsedColumns()
    @State private var createPresented = false
    @State private var taskPresented = false
    @State private var selectedTaskID: String?
    @State private var releasePresented = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var copy: JarvisFactoryCopy { JarvisFactoryCopy(language: language) }
    private var project: FactoryProject? { projects.first { $0.id == selectedProjectID } }
    private var filteredCards: [(column: FactoryBoardColumnID, card: FactoryBoardCard)] {
        guard let board else { return [] }
        return JarvisFactoryPresentation.cards(
            from: board,
            segment: segment,
            search: searchText,
            agent: FactoryAgent(rawValue: selectedAgent),
            state: FactoryTaskState(rawValue: selectedState)
        )
    }
    private var boardTaskID: String {
        "\(selectedProjectID)-\(segment.rawValue)-\(refreshVersion)"
    }

    init(
        client: JarvisFactoryClient?,
        language: JarvisAppLanguage,
        onRetryConfiguration: @escaping () -> Void,
        previewState: JarvisFactoryPreviewState? = nil,
        liveUpdatesEnabled: Bool = true
    ) {
        self.client = client
        self.language = language
        self.onRetryConfiguration = onRetryConfiguration
        self.previewState = previewState
        self.liveUpdatesEnabled = liveUpdatesEnabled
        _segment = State(initialValue: previewState?.segment ?? .board)
        if let column = previewState?.target.column {
            _collapsedColumns = State(initialValue: JarvisFactoryPresentation.defaultCollapsedColumns().subtracting([column]))
        }
        _searchText = State(initialValue: previewState == .search ? "Synthetic" : "")
        if previewState == .offline {
            _connection = State(initialValue: .offline)
        } else if previewState == .reconnecting {
            _connection = State(initialValue: .reconnecting)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if previewState == .loading {
                FactoryLoadingView(copy: copy, releases: segment == .releases)
            } else if client == nil {
                FactoryStateMessage(
                    title: copy.text(.actionFailed),
                    actionTitle: copy.text(.retry),
                    action: onRetryConfiguration
                )
            } else if projectLoading && projects.isEmpty {
                FactoryLoadingView(copy: copy, releases: false)
            } else if projectsError && projects.isEmpty {
                FactoryStateMessage(
                    title: copy.text(.actionFailed),
                    actionTitle: copy.text(.retry),
                    action: { Task { await loadProjects(force: true) } }
                )
            } else if projects.isEmpty {
                FactoryStateMessage(title: copy.text(.emptyProjects))
            } else if segment == .releases {
                releaseContent
            } else {
                boardContent
            }
        }
        .jarvisPageHeader { header }
        .safeAreaInset(edge: .top, spacing: 0) {
            JarvisTaskActivityNotice(language: language)
        }
        .environment(\.locale, language.locale)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showsSegmentRow {
                VStack(spacing: 0) {
                    segmentRow
                    bottomDock
                }
            }
        }
        .jarvisAmbientBackground()
        .toolbarBackground(.hidden, for: .bottomBar)
        .scrollEdgeEffectHidden()
        .task {
            await loadProjects()
        }
        .task(id: boardTaskID) {
            await loadSelectedContent()
        }
        .task {
            await watchBoardUpdates()
        }
        .onChange(of: selectedProjectID) { _, _ in
            board = nil
            releaseView = nil
            contentError = false
        }
        .onChange(of: segment) { _, value in
            if value == .releases {
                selectedAgent = ""
                selectedState = ""
            }
        }
        .sheet(isPresented: $createPresented) {
            if let client, let project {
                JarvisFactoryNewTaskSheet(
                    client: client,
                    projects: projects,
                    selectedProject: project,
                    language: language,
                    onPolicyUpdated: { updated in
                        projects = projects.map { $0.id == updated.id ? updated : $0 }
                    },
                    onCreated: {
                        createPresented = false
                        refreshVersion += 1
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .navigationDestination(isPresented: $taskPresented) {
            if let client {
                JarvisFactoryTaskDetailView(
                    client: client,
                    taskID: selectedTaskID ?? "21",
                    language: language,
                    liveUpdatesEnabled: liveUpdatesEnabled,
                    showSteeringAtLaunch: previewState == .steer
                )
            }
        }
        .navigationDestination(isPresented: $releasePresented) {
            if let client,
               let destinationProject = releaseProject ?? project,
               let destinationView = releaseViewForDestination ?? releaseView,
               let release = selectedRelease ?? destinationView.releases.first {
                JarvisFactoryReleaseDetailView(
                    client: client,
                    project: destinationProject,
                    releaseView: destinationView,
                    release: release,
                    language: language
                )
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityLabel(copy.text(.title))
        .task(id: contentIdentity) {
            guard previewState == .detail || previewState == .steer else { return }
            if board != nil {
                selectedTaskID = "21"
                taskPresented = true
            }
        }
        .task(id: releaseIdentity) {
            guard previewState == .release else { return }
            if releaseView?.releases.isEmpty == false { releasePresented = true }
        }
        .task(id: createIdentity) {
            guard previewState == .newtask else { return }
            if board != nil { createPresented = true }
        }
    }

    private var contentIdentity: String { board == nil ? "waiting" : "task-ready" }
    private var releaseIdentity: String { releaseView == nil ? "waiting" : "release-ready" }
    private var createIdentity: String { board == nil ? "waiting" : "create-ready" }

    private var header: some View {
        JarvisPageHeader(title: copy.text(.title), language: language)
    }

    private var headline: JarvisPagePhrase? {
        guard let board, let project else { return nil }
        return JarvisFactoryPagePhrase.board(board, projectName: project.name, segment: segment, language: language)
    }

    private func pipelineHero(_ board: FactoryBoard) -> some View {
        let counts = JarvisFactoryPagePhrase.Counts(board: board)
        let tasks = "\(counts.total) \(copy.text(counts.total == 1 ? .task : .tasks))"
        return JarvisPageHeroCard(title: copy.text(.pipeline)) {
            Text(tasks)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } content: {
            JarvisPageStatGrid(
                stats: [
                    JarvisPageStat(id: "needs", value: counts.needs, label: copy.text(.needsDan), systemImage: "bell", tint: JarvisDesignTokens.factoryAccent),
                    JarvisPageStat(id: "running", value: counts.running, label: copy.text(.running), systemImage: "play.circle", tint: JarvisDesignTokens.factoryAccent),
                    JarvisPageStat(id: "review", value: counts.review, label: copy.text(.inReview), systemImage: "checkmark.circle", tint: JarvisDesignTokens.factorySecondaryAccent),
                    JarvisPageStat(id: "failed", value: counts.failed, label: copy.text(.failed), systemImage: "xmark.circle", tint: .red),
                ],
                language: language
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy.text(.stageTasks))
    }

    private var showsSegmentRow: Bool {
        previewState != .loading && client != nil &&
            (board != nil || releaseView != nil || (contentError && !projects.isEmpty))
    }

    /// The full-width toggle above the search row, below the page's scrolling content.
    private var segmentRow: some View {
        HStack(spacing: JarvisPageHeaderMetrics.spacing) {
            JarvisSegmentedBar(
                title: copy.text(.title),
                identifierPrefix: "factory.segment",
                items: FactorySegment.allCases.map {
                    JarvisTabItem(tag: $0, title: segmentTitle($0), identifier: "factory.segment.\($0.rawValue)")
                },
                selection: $segment
            )
            filterButton
        }
        .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
        .padding(.bottom, JarvisPageHeaderMetrics.actionSpacing)
        .accessibilityIdentifier("factory.segmentRow")
    }

    /// The new-task plus sits beside the search field, below the full-width toggle.
    private var plusButton: some View {
        JarvisIconButton(
            title: copy.text(.newTask),
            systemImage: "plus",
            identifier: "factory.plus",
            isDisabled: client == nil || projects.isEmpty
        ) {
            createPresented = true
        }
    }

    /// One round glass filter button right of the segmented bar. Its small menu has a checkmark on the
    /// selected project and, on the board, the agent and state filters.
    @ViewBuilder
    private var filterButton: some View {
        if project != nil {
            JarvisMenuButton(
                title: copy.text(.filters),
                systemImage: "line.3.horizontal.decrease",
                identifier: "factory.filters"
            ) {
                Picker(copy.text(.project), selection: $selectedProjectID) {
                    ForEach(projects) { item in
                        Text(item.name).tag(item.id)
                    }
                }
                if segment != .releases {
                    Picker(copy.text(.agent), selection: $selectedAgent) {
                        Text(copy.text(.all)).tag("")
                        ForEach(FactoryAgent.allCases, id: \.rawValue) { agent in
                            Text(copy.agent(agent)).tag(agent.rawValue)
                        }
                    }
                    Picker(copy.text(.state), selection: $selectedState) {
                        Text(copy.text(.all)).tag("")
                        ForEach(FactoryTaskState.allCases, id: \.rawValue) { state in
                            Text(copy.state(state)).tag(state.rawValue)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var boardContent: some View {
        if board == nil && contentLoading {
            FactoryLoadingView(copy: copy, releases: false)
        } else if board == nil && contentError {
            FactoryStateMessage(
                title: copy.text(.actionFailed),
                actionTitle: copy.text(.retry),
                action: { refreshVersion += 1 }
            )
        } else if let board {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: JarvisDesignTokens.factorySectionSpacing) {
                        if let headline {
                            JarvisPageHeadline(phrase: headline)
                            if segment == .board, board.columns.contains(where: { !$0.cards.isEmpty }) {
                                pipelineHero(board)
                            }
                        }
                        if board.stale {
                            FactoryStatusLine(symbol: "tray.full", text: copy.text(.cached))
                        }
                        if connection != .connected {
                            FactoryStatusLine(
                                symbol: connection == .offline ? "wifi.slash" : "arrow.triangle.2.circlepath",
                                text: connection == .offline ? copy.text(.offline) : copy.text(.reconnecting)
                            )
                        }
                        if contentError {
                            FactoryStatusLine(symbol: "exclamationmark.triangle", text: copy.text(.actionFailed))
                                .overlay(alignment: .trailing) {
                                    JarvisLabelledButton(title: copy.text(.retry)) { refreshVersion += 1 }
                                }
                        }
                        if filteredCards.isEmpty {
                            Text(searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                ? emptyBoardTitle
                                : copy.text(.noSearchResults))
                                .font(.body)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, JarvisDesignTokens.factorySectionSpacing * 2)
                        } else {
                            let visibleColumns = JarvisFactoryPresentation.boardColumnOrder.filter { id in
                                filteredCards.contains(where: { $0.column == id })
                            }
                            ForEach(visibleColumns, id: \.self) { column in
                                columnSection(column)
                                    .id(column)
                            }
                        }
                    }
                    .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
                    .padding(.top, JarvisDesignTokens.factoryRowSpacing)
                    .padding(.bottom, JarvisDesignTokens.factorySectionSpacing)
                }
                .refreshable { await refresh() }
                .accessibilityIdentifier("factory.board")
                .onAppear {
                    if previewState == .detail || previewState == .steer {
                        selectedTaskID = "21"
                        taskPresented = true
                    }
                    if previewState == .newtask { createPresented = true }
                }
                .task(id: boardTaskID) {
                    if let column = previewState?.target.column {
                        await Task.yield()
                        proxy.scrollTo(column, anchor: .top)
                    }
                }
            }
        } else {
            FactoryLoadingView(copy: copy, releases: false)
        }
    }

    private func columnSection(_ id: FactoryBoardColumnID) -> some View {
        let cards = filteredCards.filter { $0.column == id }.map(\.card)
        let expanded = !collapsedColumns.contains(id)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
            JarvisLabelledButton(
                title: "\(copy.column(id)) \(JarvisNumberFormat.compact(cards.count, language: language))",
                trailingSystemImage: expanded ? "chevron.down" : "chevron.right",
                identifier: "factory.column.\(id.rawValue)",
                isFullWidth: true,
                isLeading: true,
                isEmphasised: id == .inReview,
                accessibilityTitle: copy.column(id),
                accessibilityValue: copy.text(expanded ? .expanded : .collapsed)
            ) {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                    if expanded { collapsedColumns.insert(id) } else { collapsedColumns.remove(id) }
                }
            }
            }
            if expanded {
                VStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
                    ForEach(cards) { card in
                        JarvisFactoryBoardRow(card: card, copy: copy) {
                            guard let taskID = card.task?.id else { return }
                            selectedTaskID = taskID
                            taskPresented = false
                            Task { @MainActor in
                                await Task.yield()
                                taskPresented = true
                            }
                        }
                        .padding(JarvisDesignTokens.factoryRowSpacing * 1.5)
                        .background(
                            JarvisDesignTokens.glassSolid,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5)
                        )
                    }
                }
                .padding(.leading, 16)
                .padding(.top, JarvisDesignTokens.factoryRowSpacing)
            }
        }
    }

    @ViewBuilder
    private var releaseContent: some View {
        if releaseView == nil && contentLoading {
            FactoryLoadingView(copy: copy, releases: true)
        } else if releaseView == nil && contentError {
            FactoryStateMessage(
                title: copy.text(.actionFailed),
                actionTitle: copy.text(.retry),
                action: { refreshVersion += 1 }
            )
        } else if let releaseView {
            VStack(spacing: 0) {
                JarvisPageHeadline(phrase: JarvisFactoryPagePhrase.releases(
                    releaseView,
                    projectName: project?.name ?? releaseView.project.name,
                    language: language
                ))
                .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
                .padding(.top, JarvisDesignTokens.factoryRowSpacing)
                JarvisFactoryReleaseListView(
                    releaseView: releaseView,
                    language: language,
                    searchText: searchText
                ) { selected in
                    guard let project else { return }
                    self.selectedRelease = selected
                    self.releaseProject = project
                    self.releaseViewForDestination = releaseView
                    self.releasePresented = true
                }
                .refreshable { await refresh() }
            }
        } else {
            FactoryLoadingView(copy: copy, releases: true)
        }
    }

    @State private var selectedRelease: FactoryRelease?
    @State private var releaseProject: FactoryProject?
    @State private var releaseViewForDestination: FactoryReleaseView?

    private var bottomDock: some View {
        HStack(spacing: JarvisPageHeaderMetrics.spacing) {
            JarvisSearchField(
                placeholder: copy.text(segment == .releases ? .searchReleases : .search),
                text: $searchText,
                identifier: "factory.search",
                clearTitle: copy.text(.clearSearch),
                accessibilityTitle: copy.text(
                    segment == .releases ? .searchReleasesAccessibility : .searchAccessibility
                )
            )
            plusButton
        }
        .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
        .padding(.vertical, JarvisPageHeaderMetrics.spacing)
    }

    private var emptyBoardTitle: String {
        copy.text(.emptyBoard)
    }

    private func segmentTitle(_ value: FactorySegment) -> String {
        switch value {
        case .board: copy.text(.board)
        case .releases: copy.text(.releases)
        }
    }

    private func loadProjects(force: Bool = false) async {
        guard let client else {
            projectLoading = false
            projectsError = true
            return
        }
        projectLoading = true
        projectsError = false
        do {
            let repository = await JarvisAppCache.repository(.factory, scope: "projects") {
                try await client.fetchProjects(validator: $0)
            }
            let resolved = await repository.resolve(force: force)
            guard !Task.isCancelled else { return }
            guard let result = resolved.value else { throw resolved.error ?? JarvisFactoryClientError.invalidRequest }
            projects = result
            if !result.contains(where: { $0.id == selectedProjectID }) {
                selectedProjectID = result.first?.id ?? ""
            }
        } catch {
            guard !Task.isCancelled else { return }
            projectsError = true
        }
        projectLoading = false
    }

    private func loadSelectedContent() async {
        guard let client, !selectedProjectID.isEmpty, previewState != .loading else { return }
        guard segment == .releases ? (releaseView == nil || refreshVersion > 0) : (board == nil || refreshVersion > 0) else {
            return
        }
        contentLoading = true
        contentError = false
        var showingSavedBoard = false
        do {
            if segment == .releases {
                releaseView = try await client.releases(projectId: selectedProjectID)
            } else {
                let projectId = selectedProjectID
                let repository = await JarvisAppCache.repository(.factory, scope: projectId) {
                    try await client.fetchBoard(projectId: projectId, validator: $0)
                }
                let resolved = await repository.resolve(force: refreshVersion > 0)
                guard let cachedBoard = resolved.value else {
                    throw resolved.error ?? JarvisFactoryClientError.invalidRequest
                }
                board = cachedBoard
                if let refreshError = resolved.error {
                    showingSavedBoard = JarvisFactoryConnectionPolicy.isNetworkFailure(refreshError)
                }
            }
            guard !Task.isCancelled else { return }
            contentError = false
            connection = previewState == .offline || showingSavedBoard
                ? .offline : previewState == .reconnecting ? .reconnecting : .connected
        } catch {
            guard !Task.isCancelled else { return }
            contentError = true
            if JarvisFactoryConnectionPolicy.isNetworkFailure(error) { connection = .offline }
        }
        contentLoading = false
    }

    private func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        await loadProjects(force: true)
        refreshVersion += 1
        await loadSelectedContent()
        refreshing = false
    }

    private func watchBoardUpdates() async {
        guard liveUpdatesEnabled, let client else { return }
        while !Task.isCancelled {
            do {
                try await client.listenForBoardUpdates(onConnected: {
                    await MainActor.run {
                        boardEventFailures = 0
                        boardRetrySeconds = 1
                        connection = .connected
                    }
                }) { update in
                    guard update.projectId == selectedProjectID else { return }
                    await MainActor.run {
                        refreshVersion += 1
                    }
                }
            } catch {
                guard !Task.isCancelled else { return }
                boardEventFailures += 1
                let failedOffline = JarvisFactoryConnectionPolicy.isNetworkFailure(error)
                    && boardEventFailures >= JarvisFactoryConnectionPolicy.offlineAfterFailures
                connection = failedOffline ? .offline : .reconnecting
            }
            do {
                try await Task.sleep(for: .seconds(boardRetrySeconds))
            } catch {
                return
            }
            boardRetrySeconds = min(boardRetrySeconds * 2, 15)
        }
    }
}

private enum FactoryConnectionState {
    case connected
    case reconnecting
    case offline
}

private struct FactoryStatusLine: View {
    let symbol: String
    let text: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
            .accessibilityElement(children: .combine)
    }
}

struct FactoryStateMessage: View {
    let title: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: JarvisDesignTokens.factorySectionSpacing) {
            Image(systemName: action == nil ? "tray" : "exclamationmark.arrow.circlepath")
                .font(.system(size: JarvisDesignTokens.factoryStateIconSize))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(title)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                JarvisLabelledButton(title: actionTitle, action: action)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(JarvisDesignTokens.factoryHorizontalInset)
        .accessibilityElement(children: .combine)
    }
}

struct FactoryLoadingView: View {
    let copy: JarvisFactoryCopy
    let releases: Bool

    var body: some View {
        ScrollView {
            JarvisPageLoadingView(title: copy.text(releases ? .loadingReleases : .loadingTasks), identifier: "factory.loading")
            .padding(JarvisDesignTokens.factoryHorizontalInset)
        }
    }
}

private struct JarvisFactoryBoardRow: View {
    let card: FactoryBoardCard
    let copy: JarvisFactoryCopy
    let openTask: () -> Void

    private var task: FactoryBoardTask? { card.task }
    private var issueURL: URL? {
        guard let url = URL(string: card.issue.url),
              url.scheme == "https",
              url.host == "github.com" else { return nil }
        return url
    }
    var body: some View {
        HStack(alignment: .top, spacing: JarvisDesignTokens.factoryRowSpacing) {
            rowButton
            if let issueURL {
                Link(destination: issueURL) {
                    Image("GitHubMark")
                        .resizable()
                        .scaledToFit()
                        .frame(width: JarvisDesignTokens.factoryIconSize, height: JarvisDesignTokens.factoryIconSize)
                        .frame(width: JarvisDesignTokens.factoryControlHeight, height: JarvisDesignTokens.factoryControlHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(copy.text(.openInGitHub)) #\(card.issue.number)")
                .accessibilityIdentifier("factory.row.github.\(card.issue.number)")
            }
        }
    }

    @ViewBuilder
    private var rowButton: some View {
        if task != nil {
            Button(action: openTask) {
                rowContent
            }
            .buttonStyle(.plain)
        } else {
            rowContent
        }
    }

    private var rowContent: some View {
        HStack(alignment: .top, spacing: JarvisDesignTokens.factoryRowSpacing) {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
                Text(card.issue.title)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
                    Text("#\(card.issue.number)")
                        .foregroundStyle(.secondary)
                    if let task {
                        Label(copy.agent(task.agent), systemImage: task.agent == .codex ? "terminal" : "sparkles")
                        Label(copy.state(task.state), systemImage: symbol(for: task.state))
                    } else if let worker = card.issue.worker,
                              let agent = FactoryAgent(rawValue: worker.lowercased()) {
                        Label(copy.agent(agent), systemImage: agent == .codex ? "terminal" : "sparkles")
                        Label(issueState, systemImage: issueStateSymbol)
                    } else {
                        Label(issueState, systemImage: issueStateSymbol)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                HStack(spacing: JarvisDesignTokens.factorySectionSpacing) {
                    if let cardPR = card.pr {
                        Label(
                            "#\(cardPR.number)",
                            systemImage: cardPR.draft ? "arrow.up.right.square" : "arrow.up.right"
                        )
                        FactoryChecksStatus(value: cardPR.checks, copy: copy)
                    }
                    ForEach(card.issue.blockedBy, id: \.self) { blocker in
                        Text(String(format: copy.text(.blockedBy), blocker))
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if task != nil {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func symbol(for state: FactoryTaskState) -> String {
        switch state {
        case .ready: "circle"
        case .running: "play.circle"
        case .pauseRequested: "pause.circle"
        case .paused: "pause.circle.fill"
        case .needsAttention: "exclamationmark.circle"
        case .done: "checkmark.circle"
        case .cancelled: "xmark.circle"
        }
    }

    private var issueState: String {
        card.issue.state.lowercased() == "closed" ? copy.text(.closed) : copy.text(.open)
    }

    private var issueStateSymbol: String {
        card.issue.state.lowercased() == "closed" ? "checkmark.circle" : "circle"
    }
}

private struct FactoryChecksStatus: View {
    let value: String
    let copy: JarvisFactoryCopy

    private var key: JarvisFactoryLocalizationKey {
        switch value.lowercased() {
        case "success", "successful", "passed", "passing", "completed": .checksPassed
        case "failure", "failed", "failing", "error": .checksFailed
        case "none": .checksNone
        default: .checksPending
        }
    }

    private var symbol: String {
        switch key {
        case .checksPassed: "checkmark.circle"
        case .checksFailed: "xmark.circle"
        case .checksNone: "minus.circle"
        default: "clock"
        }
    }

    var body: some View {
        Label(copy.text(key), systemImage: symbol)
            .foregroundStyle(key == .checksPassed ? .green : key == .checksFailed ? .red : .secondary)
            .accessibilityLabel(copy.text(.checks) + ": " + copy.text(key))
    }
}

#Preview("Software Factory") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .board),
        language: .default,
        onRetryConfiguration: {},
        liveUpdatesEnabled: false
    )
    .environmentObject(JarvisNavigationModel())
}

#Preview("Software Factory · Needs Dan") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .needs),
        language: .da,
        onRetryConfiguration: {},
        previewState: .needs,
        liveUpdatesEnabled: false
    )
    .environmentObject(JarvisNavigationModel())
}

#Preview("Software Factory · Task detail") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .detail),
        language: .en,
        onRetryConfiguration: {},
        previewState: .detail,
        liveUpdatesEnabled: false
    )
    .environmentObject(JarvisNavigationModel())
}

#Preview("Software Factory · New task") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .newtask),
        language: .da,
        onRetryConfiguration: {},
        previewState: .newtask,
        liveUpdatesEnabled: false
    )
    .environmentObject(JarvisNavigationModel())
}

#Preview("Software Factory · Release detail") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .release),
        language: .en,
        onRetryConfiguration: {},
        previewState: .release,
        liveUpdatesEnabled: false
    )
    .environmentObject(JarvisNavigationModel())
}
