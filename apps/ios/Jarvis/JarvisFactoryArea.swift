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
        switch self {
        case .needs: .needsDan
        case .releases, .release: .releases
        default: .board
        }
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
        _searchText = State(initialValue: previewState == .search ? "Synthetic" : "")
        if previewState == .offline {
            _connection = State(initialValue: .offline)
        } else if previewState == .reconnecting {
            _connection = State(initialValue: .reconnecting)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            segmentSwitcher
            if project != nil {
                projectControls
            }
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
                    action: { Task { await loadProjects() } }
                )
            } else if projects.isEmpty {
                FactoryStateMessage(title: copy.text(.emptyProjects))
            } else if segment == .releases {
                releaseContent
            } else {
                boardContent
            }
        }
        .background(JarvisScreenBackground())
        .environment(\.locale, language.locale)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomDock
        }
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
        HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
            Text(copy.text(.title))
                .font(.title2.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: JarvisDesignTokens.factoryRowSpacing)
            Button {
                Task { await refresh() }
            } label: {
                if refreshing {
                    ProgressView()
                        .frame(width: JarvisDesignTokens.factoryControlHeight, height: JarvisDesignTokens.factoryControlHeight)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: JarvisDesignTokens.factoryIconSize, weight: .medium))
                        .frame(width: JarvisDesignTokens.factoryControlHeight, height: JarvisDesignTokens.factoryControlHeight)
                }
            }
            .buttonStyle(.glass)
            .disabled(refreshing || client == nil)
            .accessibilityLabel(copy.text(.refresh))
        }
        .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
        .padding(.top, JarvisDesignTokens.factorySectionSpacing)
        .padding(.bottom, JarvisDesignTokens.factoryRowSpacing)
    }

    private var segmentSwitcher: some View {
        HStack(spacing: 0) {
            ForEach(FactorySegment.allCases) { item in
                Button {
                    segment = item
                } label: {
                    Text(segmentTitle(item))
                        .font(.subheadline.weight(segment == item ? .semibold : .regular))
                        .foregroundStyle(segment == item ? JarvisDesignTokens.factoryAccent : Color.secondary)
                        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.factoryControlHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(segment == item ? .isSelected : [])
            }
        }
        .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
    }

    private var projectControls: some View {
        HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
            Menu {
                Picker(copy.text(.project), selection: $selectedProjectID) {
                    ForEach(projects) { item in
                        Text(item.name).tag(item.id)
                    }
                }
            } label: {
                Label(project?.name ?? copy.text(.project), systemImage: "chevron.down")
                    .labelStyle(.titleAndIcon)
                    .font(.subheadline)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(copy.text(.project))

            if segment != .releases {
                Menu {
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
                } label: {
                    Label(copy.text(.filters), systemImage: "line.3.horizontal.decrease")
                        .labelStyle(.iconOnly)
                        .frame(width: JarvisDesignTokens.factoryControlHeight, height: JarvisDesignTokens.factoryControlHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.glass)
                .accessibilityLabel(copy.text(.filters))
            }
        }
        .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
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
            ScrollView {
                LazyVStack(alignment: .leading, spacing: JarvisDesignTokens.factorySectionSpacing) {
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
                                Button(copy.text(.retry)) { refreshVersion += 1 }
                                    .font(.subheadline)
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
                        ForEach(JarvisFactoryPresentation.boardColumnOrder.filter { id in
                            filteredCards.contains(where: { $0.column == id })
                        }, id: \.self) { column in
                            columnSection(column)
                        }
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
                .padding(.top, JarvisDesignTokens.factoryRowSpacing)
                .padding(.bottom, JarvisDesignTokens.factorySectionSpacing)
            }
            .accessibilityIdentifier("factory.board")
            .onAppear {
                if previewState == .detail || previewState == .steer {
                    selectedTaskID = "21"
                    taskPresented = true
                }
                if previewState == .newtask { createPresented = true }
            }
        } else {
            FactoryLoadingView(copy: copy, releases: false)
        }
    }

    private func columnSection(_ id: FactoryBoardColumnID) -> some View {
        let cards = filteredCards.filter { $0.column == id }.map(\.card)
        return DisclosureGroup(
            isExpanded: Binding(
                get: { !collapsedColumns.contains(id) },
                set: { expanded in
                    if expanded { collapsedColumns.remove(id) } else { collapsedColumns.insert(id) }
                }
            )
        ) {
            VStack(spacing: 0) {
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
                    .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
                    if card.id != cards.last?.id {
                        Divider()
                    }
                }
            }
        } label: {
            HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
                Text(copy.column(id))
                    .font(.headline)
                Text(cards.count.formatted(.number.locale(language.locale)))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .tint(JarvisDesignTokens.factoryAccent)
        .accessibilityIdentifier("factory.column.\(id.rawValue)")
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
        } else {
            FactoryLoadingView(copy: copy, releases: true)
        }
    }

    @State private var selectedRelease: FactoryRelease?
    @State private var releaseProject: FactoryProject?
    @State private var releaseViewForDestination: FactoryReleaseView?

    private var bottomDock: some View {
        HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
            HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(
                    copy.text(segment == .releases ? .searchReleases : .search),
                    text: $searchText
                )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(copy.text(
                        segment == .releases ? .searchReleasesAccessibility : .searchAccessibility
                    ))
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(copy.text(.clearSearch))
                }
            }
            .padding(.horizontal, JarvisDesignTokens.factorySectionSpacing)
            .frame(height: JarvisDesignTokens.factoryPlusDiameter)
            .background(.regularMaterial, in: Capsule())

            Button {
                createPresented = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: JarvisDesignTokens.factoryIconSize, weight: .semibold))
                    .foregroundStyle(JarvisDesignTokens.factoryAccentForeground)
                    .frame(width: JarvisDesignTokens.factoryPlusDiameter, height: JarvisDesignTokens.factoryPlusDiameter)
                    .background(JarvisDesignTokens.factoryAccent, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(client == nil || projects.isEmpty)
            .accessibilityLabel(copy.text(.newTask))
        }
        .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
        .padding(.top, JarvisDesignTokens.factorySectionSpacing)
        .padding(.bottom, JarvisDesignTokens.factorySectionSpacing)
        .background(.bar)
    }

    private var emptyBoardTitle: String {
        segment == .needsDan ? copy.text(.emptyNeedsDan) : copy.text(.emptyBoard)
    }

    private func segmentTitle(_ value: FactorySegment) -> String {
        switch value {
        case .board: copy.text(.board)
        case .needsDan: copy.text(.needsDan)
        case .releases: copy.text(.releases)
        }
    }

    private func loadProjects() async {
        guard let client else {
            projectLoading = false
            projectsError = true
            return
        }
        projectLoading = true
        projectsError = false
        do {
            let result = try await client.projects()
            guard !Task.isCancelled else { return }
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
        do {
            if segment == .releases {
                releaseView = try await client.releases(projectId: selectedProjectID)
            } else {
                board = try await client.board(projectId: selectedProjectID)
            }
            guard !Task.isCancelled else { return }
            contentError = false
            connection = previewState == .offline ? .offline : previewState == .reconnecting ? .reconnecting : .connected
        } catch {
            guard !Task.isCancelled else { return }
            contentError = true
            connection = .offline
        }
        contentLoading = false
    }

    private func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        await loadProjects()
        if segment == .releases { releaseView = nil } else { board = nil }
        refreshVersion += 1
        refreshing = false
    }

    private func watchBoardUpdates() async {
        guard liveUpdatesEnabled, let client else { return }
        while !Task.isCancelled {
            do {
                try await client.listenForBoardUpdates { update in
                    guard update.projectId == selectedProjectID else { return }
                    await MainActor.run {
                        boardEventFailures = 0
                        boardRetrySeconds = 1
                        connection = .connected
                        refreshVersion += 1
                    }
                }
                boardEventFailures += 1
                connection = boardEventFailures >= 3 ? .offline : .reconnecting
            } catch {
                guard !Task.isCancelled else { return }
                boardEventFailures += 1
                connection = boardEventFailures >= 3 ? .offline : .reconnecting
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
                Button(actionTitle, action: action)
                    .buttonStyle(.glass)
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
        VStack(alignment: .leading, spacing: JarvisDesignTokens.factorySectionSpacing) {
            Text(copy.text(releases ? .loadingReleases : .loadingTasks))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            ForEach(0..<JarvisDesignTokens.factorySkeletonRowCount) { _ in
                VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
                    RoundedRectangle(cornerRadius: JarvisDesignTokens.factorySkeletonCornerRadius)
                        .fill(.quaternary)
                        .frame(height: JarvisDesignTokens.factorySkeletonTitleHeight)
                        .frame(maxWidth: .infinity)
                    RoundedRectangle(cornerRadius: JarvisDesignTokens.factorySkeletonCornerRadius)
                        .fill(.quaternary)
                        .frame(
                            width: JarvisDesignTokens.factorySkeletonSecondaryWidth,
                            height: JarvisDesignTokens.factorySkeletonSecondaryHeight
                        )
                }
                .padding(.vertical, JarvisDesignTokens.factorySectionSpacing)
                .redacted(reason: .placeholder)
                .accessibilityHidden(true)
            }
            Spacer(minLength: 0)
        }
        .padding(JarvisDesignTokens.factoryHorizontalInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityLabel(copy.text(.loading))
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
        rowButton
    }

    @ViewBuilder
    private var rowButton: some View {
        if task != nil {
            Button(action: openTask) {
                rowContent
            }
            .buttonStyle(.plain)
        } else if let issueURL {
            Link(destination: issueURL) {
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
                    .font(.body.weight(.medium))
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
                .font(.caption)
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
                .font(.caption)
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
}

#Preview("Software Factory · Needs Dan") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .needs),
        language: .da,
        onRetryConfiguration: {},
        previewState: .needs,
        liveUpdatesEnabled: false
    )
}

#Preview("Software Factory · Task detail") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .detail),
        language: .en,
        onRetryConfiguration: {},
        previewState: .detail,
        liveUpdatesEnabled: false
    )
}

#Preview("Software Factory · New task") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .newtask),
        language: .da,
        onRetryConfiguration: {},
        previewState: .newtask,
        liveUpdatesEnabled: false
    )
}

#Preview("Software Factory · Release detail") {
    JarvisFactoryArea(
        client: try? JarvisFactoryFixtureScenario.makeClient(state: .release),
        language: .en,
        onRetryConfiguration: {},
        previewState: .release,
        liveUpdatesEnabled: false
    )
}
