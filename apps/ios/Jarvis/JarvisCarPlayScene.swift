import ActivityKit
import CarPlay
import JarvisCore
import Observation
import SwiftUI

/// CarPlay owns the template layout. The phone and car use the same authenticated clients and call.
@available(iOS 26.4, *)
@MainActor
final class JarvisCarPlayScene: UIResponder, CPTemplateApplicationSceneDelegate, CPInterfaceControllerDelegate {
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
    private var artwork: [String: UIImage] = [:]
    private var calendarStatus: String?
    private var noteStatus: String?
    private var taskStatus: String?
    private var expanded: [String: [String]] = [:]
    private var later = false
    private var recent = false
    private var scope: VaultTaskScope?
    private var taskLimit = 3
    private var noteLimit = 3
    private var scheduleLimit = 3

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        controller = interfaceController
        interfaceController.delegate = self
        let root = CPListTemplate(title: "Jarvis", sections: [])
        dashboard = root
        root.leadingNavigationBarButtons = [CPBarButton(title: "Talk to Jarvis") { [weak self] _ in self?.startVoice() }]
        root.trailingNavigationBarButtons = [CPBarButton(title: "Quick actions") { [weak self] _ in self?.quickActions() }]
        NotificationCenter.default.addObserver(self, selector: #selector(accountAccessChanged), name: .jarvisAccountAccessChanged, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(revoked), name: .jarvisSessionRevoked, object: nil)
        interfaceController.setRootTemplate(root, animated: false) { [weak self] success, _ in
            if success { Task { @MainActor in
                self?.refresh()
                self?.observePhoneVoice()
            } }
        }
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        NotificationCenter.default.removeObserver(self)
        controller = nil
        artwork = [:]
        dashboard = nil
        clearData()
        endVoice()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        if voiceTemplate == nil, controller?.rootTemplate === dashboard { refresh() }
    }

    @objc private func accountAccessChanged() {
        if JarvisComposition.accountAccessSuspended { revoked() } else { refresh() }
    }

    private func observePhoneVoice() {
        guard let controller else { return }
        let active = withObservationTracking { voice.isSessionActive } onChange: { [weak self] in
            Task { @MainActor in self?.observePhoneVoice() }
        }
        guard active, voiceTemplate == nil, !JarvisComposition.accountAccessSuspended else { return }
        if controller.presentedTemplate != nil {
            controller.dismissTemplate(animated: false) { [weak self] success, _ in
                Task { @MainActor in
                    if success, self?.voice.isSessionActive == true { self?.startVoice(startIfIdle: false) }
                }
            }
        } else { startVoice(startIfIdle: false) }
    }

    func templateDidDisappear(_ aTemplate: CPTemplate, animated: Bool) {
        guard aTemplate === voiceTemplate, controller?.presentedTemplate !== aTemplate else { return }
        endVoice()
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
        guard !JarvisComposition.accountAccessSuspended else { revoked(); return }
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
            async let agenda = api.calendarSource.page(from: start, to: end)
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
                events = value.entries.filter { $0.start < end && $0.end > start }
                calendarStatus = value.truncated ? "Showing the first calendar results" : nil
                await updateTrackedEvent(from: start, to: end, truncated: value.truncated)
                try Task.checkCancellation()
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
        await JarvisAppCache.bindIfNeeded()
        let paths = await JarvisAppCache.shared.pinnedNotePaths()
        let summaries = try await api.noteSummaries(paths: paths)
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
                self?.eventDetails(event, label: label)
            }))
        }
        for task in (later ? groups?.upcoming : groups?.today) ?? [] {
            schedule.append(((task.dueDate ?? "") + " " + (task.dueTime ?? "24:00"), taskRow(task)))
        }
        var scheduleRows = schedule.sorted { $0.key < $1.key }.prefix(scheduleLimit).map(\.item)
        if schedule.count > scheduleLimit {
            scheduleRows.append(row("Show more schedule items") { [weak self] in self?.scheduleLimit += 3; self?.render() })
        }
        if let calendarStatus { scheduleRows.append(row(calendarStatus)) }
        if let taskStatus { scheduleRows.append(row(taskStatus)) }
        if scheduleRows.isEmpty { scheduleRows = [row("Nothing scheduled")] }

        var noteRows: [CPListItem] = []
        for note in notes.prefix(noteLimit) {
            let excerpt = expanded[note.path]
            let item = row(note.title, note.directory) { [weak self] in
                self?.toggleNote(note)
            }
            item.setAccessoryImage(UIImage(systemName: excerpt == nil ? "chevron.down" : "chevron.up"))
            noteRows.append(item)
            if let excerpt {
                for line in excerpt { noteRows.append(row(line)) }
            }
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
        let names = ["Schedule", "Notes", "Tasks"]
        let firstItems = [scheduleRows.first?.text, noteRows.first?.text, taskRows.first?.text]
        let cards = names.indices.map { index in
            CPListImageRowItemCardElement(image: cardArtwork(names[index]), showsImageFullHeight: true,
                title: names[index] + " · " + filters[index], subtitle: firstItems[index],
                tintColor: UIColor(JarvisDesignTokens.primaryAccent))
        }
        let tiles = CPListImageRowItem(text: nil, cardElements: cards, allowsMultipleLines: true)
        tiles.listImageRowHandler = { [weak self] _, index, done in
            self?.filterCard(index)
            done()
        }
        dashboard.updateSections([
            CPListSection(items: [tiles]),
            CPListSection(items: scheduleRows, header: "Schedule · " + filters[0], sectionIndexTitle: nil),
            CPListSection(items: noteRows, header: "Notes · " + filters[1], sectionIndexTitle: nil),
            CPListSection(items: taskRows, header: "Tasks · " + filters[2], sectionIndexTitle: nil)
        ])
    }

    private func cardArtwork(_ name: String) -> UIImage {
        if let cached = artwork[name] { return cached }
        guard let image = UIImage(named: "Car" + name) else { return UIImage() }
        let maxSize = CPListImageRowItemCardElement.maximumFullHeightImageSize
        let ratio = min(maxSize.width / image.size.width, maxSize.height / image.size.height)
        let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
        guard size.width > 0, size.height > 0 else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = max(1, controller?.carTraitCollection.displayScale ?? 1)
        let result = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        artwork[name] = result
        return result
    }

    private func filterCard(_ index: Int) {
        switch index {
        case 0: later.toggle(); scheduleLimit = 3; refresh()
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
                expanded[note.path] = JarvisCarPlayPresentation.noteExcerpt(data.content)
                render()
            } catch {
                if generation == accountGeneration { message(note.title, Self.errorText(error, for: "note")) }
            }
        }
    }

    private var trackedEvent: Activity<CarScheduleActivityAttributes>? {
        Activity<CarScheduleActivityAttributes>.activities.first
    }

    private func updateTrackedEvent(from start: Date, to end: Date, truncated: Bool) async {
        guard let activity = trackedEvent else { return }
        let previous = activity.content.state
        if let event = events.first(where: { $0.id == activity.attributes.eventID }), event.end > Date() {
            let state = CarScheduleActivityAttributes.ContentState(title: event.title, starts: event.start, ends: event.end)
            if state != previous { await activity.update(ActivityContent(state: state, staleDate: event.end)) }
        } else if previous.ends <= Date() || (!truncated && previous.starts < end && previous.ends > start) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    private func trackingChoice(for event: JarvisTodayCalendarEntry?) -> (String, () -> Void)? {
        if let activity = trackedEvent {
            return ("Stop tracking " + activity.content.state.title, {
                Task { await activity.end(nil, dismissalPolicy: .immediate) }
            })
        }
        guard let event, event.end > Date(), event.allDay != true,
              ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
        return ("Track " + event.title, { [weak self] in
            guard let self, !JarvisComposition.accountAccessSuspended, self.trackedEvent == nil else { return }
            do {
                let state = CarScheduleActivityAttributes.ContentState(title: event.title, starts: event.start, ends: event.end)
                _ = try Activity.request(attributes: CarScheduleActivityAttributes(eventID: event.id),
                    content: ActivityContent(state: state, staleDate: event.end), pushType: nil)
            } catch { self.message("Tracking unavailable", "The Live Activity could not start.") }
        })
    }

    private func callChoice(for event: JarvisTodayCalendarEntry?) -> (String, () -> Void)? {
        guard let event, let location = event.location,
              let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.phoneNumber.rawValue),
              let match = detector.firstMatch(in: location, range: NSRange(location.startIndex..., in: location)),
              let number = match.phoneNumber else { return nil }
        let dial = number.filter { $0.isNumber || $0 == "+" }
        guard let url = URL(string: "tel:" + dial) else { return nil }
        return ("Call " + number, { UIApplication.shared.open(url) })
    }

    private func quickActions() {
        let next = events.filter { $0.end > Date() && $0.allDay != true }.min { $0.start < $1.start }
        var choices = [callChoice(for: next), trackingChoice(for: next)].compactMap { $0 }
        choices.append(("Refresh dashboard", { [weak self] in self?.refresh() }))
        actions("Quick actions", nil, choices)
    }

    private func eventDetails(_ event: JarvisTodayCalendarEntry, label: String) {
        let track = trackedEvent.map { $0.attributes.eventID != event.id } == true ? nil : trackingChoice(for: event)
        let choices = [callChoice(for: event), track].compactMap { $0 }
        let detail = [label, event.location].compactMap { $0 }.joined(separator: " · ")
        if choices.isEmpty { message(event.title, detail) } else { actions(event.title, detail, choices) }
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
                guard generation == accountGeneration else { return }
                await JarvisAppCache.invalidateAll(.tasks)
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

    private func startVoice(startIfIdle: Bool = true) {
        guard let controller, voiceTemplate == nil, controller.presentedTemplate == nil, !JarvisComposition.accountAccessSuspended else { return }
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
            Task {
                if self.voice.connectionPresentationState == .lost { await self.voice.retryNow() }
                else { await self.voice.retryIfNeeded() }
            }
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
                    guard startIfIdle else { endVoice(); return }
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
            JarvisCarPlayPresentation.indicator(
                state: voice.voiceState, connection: voice.connectionPresentationState,
                starting: starting, muted: voice.isMuted, audioReady: voice.isAudioReady,
                signInRequired: voice.signInRequired, microphoneDenied: voice.microphoneDenied
            )
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
