import CarPlay
import JarvisCore
import Observation
import SwiftUI

/// CarPlay owns the template layout. The phone and car use the same authenticated clients and call.
@available(iOS 26.4, *)
@MainActor
final class JarvisCarPlayScene: UIResponder, CPTemplateApplicationSceneDelegate {
    private weak var controller: CPInterfaceController?
    private var dashboard: CPListTemplate?
    private var voiceTemplate: CPVoiceControlTemplate?
    private let voice = VoiceScreenModel.shared
    private var client: JarvisNotesClient?
    private var load: Task<Void, Never>?
    private var voiceGeneration = UUID()
    private var notes: [VaultNoteSummary] = []
    private var tasks: VaultTaskList?
    private var events: [JarvisTodayCalendarEntry] = []
    private var calendarStatus: String?
    private var noteStatus: String?
    private var taskStatus: String?
    private var expanded: [String: String] = [:]
    private var later = false
    private var recent = false
    private var scope: VaultTaskScope?
    private var taskLimit = 3
    private var noteLimit = 3

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        controller = interfaceController
        let root = CPListTemplate(title: "Jarvis", sections: [])
        dashboard = root
        root.leadingNavigationBarButtons = [CPBarButton(title: "Talk to Jarvis") { [weak self] _ in self?.startVoice() }]
        root.trailingNavigationBarButtons = [CPBarButton(image: UIImage(systemName: "arrow.clockwise")!) { [weak self] _ in self?.refresh() }]
        NotificationCenter.default.addObserver(self, selector: #selector(revoked), name: .jarvisSessionRevoked, object: nil)
        interfaceController.setRootTemplate(root, animated: false) { [weak self] success, _ in
            if success { Task { @MainActor in self?.refresh() } }
        }
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        NotificationCenter.default.removeObserver(self)
        controller = nil
        dashboard = nil
        clearData()
        endVoice()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        if voiceTemplate == nil, controller?.rootTemplate === dashboard { refresh() }
    }

    @objc private func revoked() {
        clearData()
        endVoice()
        calendarStatus = "Sign-in required"
        noteStatus = calendarStatus
        taskStatus = calendarStatus
        if controller?.presentedTemplate != nil { controller?.dismissTemplate(animated: false) { _, _ in } }
        render()
    }

    private func clearData() {
        accountGeneration = UUID()
        load?.cancel()
        load = nil
        client = nil
        notes = []
        events = []
        tasks = nil
        expanded = [:]
    }

    private func refresh() {
        guard controller != nil else { return }
        load?.cancel()
        guard let http = try? JarvisComposition.makeClient(accessTokenProvider: JarvisUnavailableAccessTokenProvider()) else {
            revoked()
            return
        }
        let api = JarvisNotesClient(client: http)
        client = api
        calendarStatus = "Loading schedule…"
        taskStatus = "Loading tasks…"
        noteStatus = "Loading notes…"
        events = []
        tasks = nil
        notes = []
        expanded = [:]
        render()
        let calendar = Calendar.autoupdatingCurrent
        let today = calendar.startOfDay(for: Date())
        let start = later ? calendar.date(byAdding: .day, value: 1, to: today)! : today
        let end = calendar.date(byAdding: .day, value: later ? 30 : 1, to: start)!
        let showRecent = recent
        load = Task { [weak self] in
            guard let self else { return }
            async let agenda = api.calendarSource.entries(from: start, to: end)
            async let open = api.tasks()
            async let summaries = Self.noteSummaries(api, recent: showRecent)
            do {
                let value = try await open
                try Task.checkCancellation()
                tasks = value
                taskStatus = nil
            } catch { if Task.isCancelled { return }; taskStatus = Self.errorText(error, for: "tasks") }
            render()
            do {
                let value = try await agenda
                try Task.checkCancellation()
                events = value.filter { $0.start < end && $0.end > start }
                calendarStatus = nil
            } catch { if Task.isCancelled { return }; calendarStatus = Self.errorText(error, for: "calendar") }
            render()
            do {
                let value = try await summaries
                try Task.checkCancellation()
                notes = value
                noteStatus = nil
            } catch { if Task.isCancelled { return }; noteStatus = Self.errorText(error, for: "notes") }
            render()
        }
    }

    private static func noteSummaries(_ api: JarvisNotesClient, recent: Bool) async throws -> [VaultNoteSummary] {
        if recent { return try await api.notes(recentFirst: true).notes }
        let paths = await JarvisAppCache.shared.pinnedNotePaths()
        let summaries = try await api.noteSummaries(paths: Array(paths.prefix(50)))
        return paths.compactMap { path in summaries.first { $0.path == path } }
    }

    private static func errorText(_ error: Error, for source: String) -> String {
        if let error = error as? JarvisClientError {
            switch error {
            case .signInRequired, .notOwner: return "Sign-in required"
            default: break
            }
        }
        return "Couldn’t load \(source). Refresh to retry."
    }

    private func row(_ title: String, _ detail: String? = nil, action: (() -> Void)? = nil) -> CPListItem {
        let item = CPListItem(text: title, detailText: detail)
        item.isEnabled = action != nil
        if let action { item.handler = { _, done in action(); done() } }
        return item
    }

    private func render() {
        guard let dashboard else { return }
        let filters = [later ? "Later" : "Today", recent ? "Recent" : "Pinned", scope?.rawValue.capitalized ?? "All"]
        let names = ["Schedule", "Notes", "Tasks"]
        let cards = zip(names, filters).map { name, filter in
            CPListImageRowItemCardElement(image: UIImage(named: "Car" + name) ?? UIImage(),
                showsImageFullHeight: true, title: name, subtitle: filter, tintColor: UIColor(JarvisDesignTokens.primaryAccent))
        }
        let tiles = CPListImageRowItem(text: nil, cardElements: cards, allowsMultipleLines: true)
        tiles.listImageRowHandler = { [weak self] _, index, done in
            self?.filterCard(index); done()
        }
        let groups = tasks.map { JarvisNotesLogic.taskGroups($0.items, today: $0.today) }
        var schedule: [(key: String, item: CPListItem)] = []
        let dateKey = DateFormatter()
        dateKey.calendar = .init(identifier: .gregorian)
        dateKey.locale = Locale(identifier: "en_US_POSIX")
        dateKey.dateFormat = "yyyy-MM-dd HH:mm"
        for event in events {
            let time = event.allDay == true ? "All day" : event.start.formatted(date: .omitted, time: .shortened)
            let label = later ? event.start.formatted(date: .abbreviated, time: .omitted) + " · " + time : time
            schedule.append((dateKey.string(from: event.start), row(event.title, label) { [weak self] in
                self?.message(event.title, [label, event.location].compactMap { $0 }.joined(separator: " · "))
            }))
        }
        for task in (later ? groups?.upcoming : groups?.today) ?? [] {
            schedule.append(((task.dueDate ?? "") + " " + (task.dueTime ?? "24:00"), taskRow(task)))
        }
        var scheduleRows = schedule.sorted { $0.key < $1.key }.prefix(8).map(\.item)
        if let calendarStatus { scheduleRows.append(row(calendarStatus)) }
        if let taskStatus { scheduleRows.append(row(taskStatus)) }
        if scheduleRows.isEmpty { scheduleRows = [row("Nothing scheduled")] }

        var noteRows = notes.prefix(noteLimit).map { note in
            let item = row(note.title, expanded[note.path] ?? note.directory) { [weak self] in
                self?.toggleNote(note)
            }
            item.accessoryType = .disclosureIndicator
            return item
        }
        if let noteStatus { noteRows.append(row(noteStatus)) }
        if notes.count > noteLimit {
            noteRows.append(row("Show more notes") { [weak self] in self?.noteLimit += 3; self?.render() })
        }
        if noteRows.isEmpty { noteRows = [row(recent ? "No recent notes" : "No pinned notes")] }

        let open = groups.map { $0.overdue + $0.today + $0.upcoming + $0.noDate } ?? []
        let filtered = open.filter { scope == nil || scope == $0.scope }
        var taskRows = filtered.prefix(taskLimit).map(taskRow)
        if filtered.count > taskLimit {
            taskRows.append(row("Show more tasks", "\(filtered.count - taskLimit) more") { [weak self] in
                self?.taskLimit += 3; self?.render()
            })
        }
        if let taskStatus { taskRows.append(row(taskStatus)) }
        if taskRows.isEmpty { taskRows = [row("No open tasks")] }
        dashboard.updateSections([
            CPListSection(items: [tiles]),
            CPListSection(items: scheduleRows, header: "Schedule · " + filters[0], sectionIndexTitle: nil),
            CPListSection(items: noteRows, header: "Notes · " + filters[1], sectionIndexTitle: nil),
            CPListSection(items: taskRows, header: "Tasks · " + filters[2], sectionIndexTitle: nil)
        ])
    }

    private func filterCard(_ index: Int) {
        switch index {
        case 0: later.toggle(); refresh()
        case 1: recent.toggle(); noteLimit = 3; refresh()
        case 2:
            let options: [(String, VaultTaskScope?)] = [("All", nil), ("Work", .work), ("Personal", .personal)]
            actions("Tasks", nil, options.map { title, choice in
                (title, { [weak self] in self?.scope = choice; self?.taskLimit = 3; self?.render() })
            })
        default: break
        }
    }

    private var accountGeneration = UUID()
    private func toggleNote(_ note: VaultNoteSummary) {
        if expanded.removeValue(forKey: note.path) != nil { render(); return }
        guard let client else { return }
        let generation = accountGeneration
        Task {
            do {
                let data = try await client.readNote(path: note.path)
                guard generation == accountGeneration, notes.contains(where: { $0.id == note.id }) else { return }
                expanded[note.path] = String(data.content.trimmingCharacters(in: .whitespacesAndNewlines).prefix(400))
                render()
            } catch {
                if generation == accountGeneration { message(note.title, Self.errorText(error, for: "note")) }
            }
        }
    }

    private func taskRow(_ task: VaultTask) -> CPListItem {
        let detail = [task.scope.rawValue.capitalized, task.dueDate, task.dueTime].compactMap { $0 }.joined(separator: " · ")
        return row(task.text, detail) { [weak self] in
            self?.actions(task.text, detail, [
                ("Complete", { [weak self] in self?.write(task, complete: true) }),
                ("Move to tomorrow", { [weak self] in self?.write(task, complete: false) })
            ])
        }
    }

    private func write(_ task: VaultTask, complete: Bool) {
        guard let client, let today = tasks?.today else { return }
        let generation = accountGeneration
        Task {
            do {
                if complete { _ = try await client.setTaskDone(task, done: true) }
                else {
                    let format = DateFormatter()
                    format.locale = Locale(identifier: "en_US_POSIX")
                    format.calendar = Calendar(identifier: .gregorian)
                    format.dateFormat = "yyyy-MM-dd"
                    guard let date = format.date(from: today), let next = format.calendar.date(byAdding: .day, value: 1, to: date) else { return }
                    _ = try await client.editTask(task, text: task.text, due: format.string(from: next), time: task.dueTime, priority: task.priority)
                }
                if generation == accountGeneration { refresh() }
            } catch {
                if generation == accountGeneration { refresh(); message("Check task status", "The update could not be confirmed.") }
            }
        }
    }

    private func actions(_ title: String, _ detail: String?, _ choices: [(String, () -> Void)]) {
        var actions = choices.map { label, handler in CPAlertAction(title: label, style: .default) { _ in handler() } }
        actions.append(CPAlertAction(title: "Cancel", style: .cancel) { _ in })
        guard controller?.presentedTemplate == nil else { return }
        controller?.presentTemplate(CPActionSheetTemplate(title: title, message: detail, actions: actions), animated: true) { _, _ in }
    }

    private func message(_ title: String, _ detail: String) {
        let close = CPAlertAction(title: "Close", style: .cancel) { _ in }
        guard controller?.presentedTemplate == nil else { return }
        controller?.presentTemplate(CPActionSheetTemplate(title: title, message: detail, actions: [close]), animated: true) { _, _ in }
    }

    private func startVoice() {
        guard let controller, voiceTemplate == nil else { return }
        let generation = UUID()
        voiceGeneration = generation
        let end = CPButton(image: UIImage(systemName: "phone.down.fill")!) { [weak self] _ in self?.endVoice() }
        end.title = "End"
        let mute = CPButton(image: UIImage(systemName: "mic.slash.fill")!) { [weak self] _ in
            guard let self, voice.canUseControls else { return }
            Task { await self.voice.toggleMute() }
        }
        mute.title = "Mute"
        let unmute = CPButton(image: UIImage(systemName: "mic.fill")!) { [weak self] _ in
            guard let self, voice.canUseControls else { return }
            Task { await self.voice.toggleMute() }
        }
        unmute.title = "Unmute"
        let retry = CPButton(image: UIImage(systemName: "arrow.clockwise")!) { [weak self] _ in
            guard let self, self.voiceGeneration == generation else { return }
            Task { await self.voice.retryIfNeeded() }
        }
        retry.title = "Retry"
        let phases: [(String, JarvisOrbActivity)] = [
            ("Connecting", .calm), ("Listening", .listening), ("Thinking", .thinking), ("Speaking", .speaking),
            ("Muted", .muted), ("Reconnecting", .reconnecting), ("Voice unavailable", .offline),
            ("Sign-in required", .offline), ("Microphone unavailable", .offline)
        ]
        let states = phases.map { label, activity in
            let renderer = ImageRenderer(content: JarvisOrb(activity: activity, size: 112, isStatic: true))
            renderer.scale = 2
            let state = CPVoiceControlState(identifier: label, titleVariants: [label],
                image: Self.voiceImage(renderer.uiImage, activity: activity), repeats: true)
            switch activity {
            case .muted: state.actionButtons = [unmute, end]
            case .offline: state.actionButtons = [retry, end]
            case .listening, .thinking, .speaking: state.actionButtons = [mute, end]
            default: state.actionButtons = [end]
            }
            return state
        }
        let template = CPVoiceControlTemplate(voiceControlStates: states)
        voiceTemplate = template
        template.activateVoiceControlState(withIdentifier: "Connecting")
        controller.presentTemplate(template, animated: true) { [weak self] success, _ in
            Task { @MainActor in
                guard let self, voiceGeneration == generation else { return }
                guard success else {
                    voiceTemplate = nil
                    message("Voice unavailable", "Try opening Voice again.")
                    return
                }
                if !voice.isSessionActive {
                    _ = voice.consumeReturnToChatRequest()
                    trackVoice(generation, starting: true)
                    await voice.performStart()
                } else { trackVoice(generation) }
            }
        }
    }

    private static func voiceImage(_ image: UIImage?, activity: JarvisOrbActivity) -> UIImage? {
        guard let image, !UIAccessibility.isReduceMotionEnabled,
              [.listening, .speaking, .thinking].contains(activity) else { return image }
        let renderer = UIGraphicsImageRenderer(size: image.size)
        let frames = (0..<12).map { index in
            renderer.image { _ in
                let inset = (1 - cos(Double(index) * .pi / 6)) * 1.6
                image.draw(in: CGRect(origin: .zero, size: image.size).insetBy(dx: inset, dy: inset))
            }
        }
        return UIImage.animatedImage(with: frames, duration: activity == .speaking ? 1.0 : 2.4)
    }

    private func trackVoice(_ generation: UUID, starting: Bool = false) {
        guard generation == voiceGeneration, let template = voiceTemplate else { return }
        let label: String = withObservationTracking {
            if voice.microphoneDenied { return "Microphone unavailable" }
            if voice.signInRequired { return "Sign-in required" }
            switch voice.voiceState {
            case .ended, .idle: return starting ? "Connecting" : "Ended"
            case .failed: return "Voice unavailable"
            case .connecting: return "Connecting"
            case .reconnecting: return "Reconnecting"
            case .listening, .thinking, .speaking:
                if voice.isMuted { return "Muted" }
                if voice.voiceState == .thinking { return "Thinking" }
                if voice.voiceState == .speaking { return "Speaking" }
                return voice.isAudioReady ? "Listening" : "Connecting"
            }
        } onChange: { [weak self] in
            Task { @MainActor in self?.trackVoice(generation) }
        }
        if label == "Ended" { endVoice(); return }
        if template.activeStateIdentifier != label { template.activateVoiceControlState(withIdentifier: label) }
    }

    private func endVoice() {
        guard voiceTemplate != nil else { return }
        voiceGeneration = UUID()
        voiceTemplate = nil
        let generation = voiceGeneration
        Task {
            if voice.isSessionActive || voice.liveActivitySessionID != nil { await voice.end(returnToChat: false) }
            guard voiceGeneration == generation, let controller, controller.presentedTemplate is CPVoiceControlTemplate else { return }
            controller.dismissTemplate(animated: true) { [weak self] success, _ in
                if success { Task { @MainActor in self?.refresh() } }
            }
        }
    }
}
