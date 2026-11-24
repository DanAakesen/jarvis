import JarvisCore
import SwiftUI

struct JarvisCalendarPage: View {
    enum Period: String, CaseIterable { case day = "Day", week = "Week", month = "Month" }

    let source: JarvisBackendCalendarSource?
    let language: JarvisAppLanguage
    let onChanged: () async -> Void
    private let calendar = JarvisHealthSyncWindow.calendar
    @State private var date = Date()
    @State private var period = Period.day
    @State private var events: [JarvisTodayCalendarEntry] = []
    @State private var search = ""
    @State private var draft: CalendarDraft?
    @State private var conflict: JarvisTodayCalendarEntry?
    @State private var pendingDeletion = false
    @State private var busy = false
    @State private var loading = false
    @State private var truncated = false
    @State private var error: String?
    @State private var refresh = UUID()

    private var interval: DateInterval {
        let component: Calendar.Component = period == .week ? .weekOfYear : period == .month ? .month : .day
        return calendar.dateInterval(of: component, for: date)!
    }
    private var days: [Date] {
        (0..<(period == .week ? 7 : 1)).compactMap { calendar.date(byAdding: .day, value: $0, to: interval.start) }
    }
    private var listed: [JarvisTodayCalendarEntry] {
        events.filter { entry in
            if !search.isEmpty {
                return entry.title.localizedCaseInsensitiveContains(search) || entry.location?.localizedCaseInsensitiveContains(search) == true
            }
            guard period != .day else { return true }
            let day = calendar.dateInterval(of: .day, for: date)!
            return entry.start < day.end && entry.end > day.start
        }
    }
    private var periodTitle: String {
        switch period {
        case .day: return date.formatted(.dateTime.weekday(.abbreviated).day().month(.wide))
        case .week: return interval.start.formatted(.dateTime.day().month(.abbreviated)) + " – " +
                days.last!.formatted(.dateTime.day().month(.abbreviated))
        case .month: return date.formatted(.dateTime.month(.wide).year())
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            page
                .onChange(of: draft?.id) { _, id in
                    conflict = nil
                    guard let id else { return }
                    Task { @MainActor in
                        await Task.yield()
                        proxy.scrollTo(id, anchor: .center)
                    }
                }
        }
    }

    private var page: some View {
        JarvisPageScaffold(title: "Calendar", language: language, actions: {}, headline: {
            HStack {
                JarvisSegmentedBar(title: "Calendar period", identifierPrefix: "calendar.period", items: Period.allCases.map { JarvisTabItem(tag: $0, title: $0.rawValue, identifier: "calendar." + $0.rawValue) }, selection: $period)
                JarvisLabelledButton(title: "Today", isEmphasised: true) { date = Date() }
            }
        }, hero: {
            VStack(spacing: 12) {
                HStack {
                    Text(periodTitle).font(.headline)
                    Spacer()
                    arrow("Previous", -1)
                    arrow("Next", 1)
                }
                if period == .month {
                    DatePicker("Selected day", selection: $date, displayedComponents: .date)
                        .datePickerStyle(.graphical).tint(JarvisDesignTokens.primaryAccent)
                } else {
                    JarvisCalendarTimeline(days: days, events: events, calendar: calendar, selectedDay: $date,
                                           onSelect: { date = max(interval.start, $0.start); draft = CalendarDraft($0) }, onMove: move)
                }
            }.padding().jarvisDashboardSurface().environment(\.jarvisCardRole, "calendar")
        }, sections: {
            VStack(alignment: .leading, spacing: 8) {
                Text(search.isEmpty ? date.formatted(.dateTime.weekday(.wide).day().month(.wide)) : "Search results").font(.headline)
                if loading { ProgressView() }
                if let error {
                    Text(error).font(.footnote)
                    JarvisLabelledButton(title: "Refresh", systemImage: "arrow.clockwise") { refresh = UUID() }
                }
                if truncated { Text("Showing the first 200 appointments. Select a shorter period to see more.").font(.footnote) }
                if let draft, draft.isNew || !listed.contains(where: { $0.id == draft.id }) { editor(draft).id(draft.id) }
                if listed.isEmpty && !loading && error == nil {
                    Text(search.isEmpty ? "No appointments" : "No matching appointments").foregroundStyle(.secondary)
                }
                ForEach(listed) { event in
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            draft = draft?.id == event.id ? nil : CalendarDraft(event)
                        } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    if period != .day { Text(event.start, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated)).font(.caption) }
                                    Text(event.allDay == true ? "All day" : event.start.formatted(date: .omitted, time: .shortened) + " – " + event.end.formatted(date: .omitted, time: .shortened))
                                        .font(.subheadline).foregroundStyle(JarvisDesignTokens.primaryAccent)
                                }
                                Text(event.title).font(.body.weight(.semibold)).multilineTextAlignment(.leading)
                                Spacer()
                                Image(systemName: draft?.id == event.id ? "chevron.down" : "chevron.right").font(.caption)
                            }.contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        if let draft, !draft.isNew, draft.id == event.id { Divider(); editor(draft) }
                    }.padding().jarvisDashboardSurface().environment(\.jarvisCardRole, "agenda").id(event.id)
                }
            }
        })
        .jarvisPageFooter {
            HStack {
                JarvisSearchField(placeholder: "Search calendar", text: $search, identifier: "calendar.search", clearTitle: "Clear")
                JarvisIconButton(title: "New event", systemImage: "plus", identifier: "calendar.add", tint: JarvisDesignTokens.primaryAccent) {
                    search = ""
                    draft = CalendarDraft(date: date, calendar: calendar)
                }
            }.padding(.horizontal).padding(.vertical, 4)
        }
        .disabled(busy)
        .environment(\.calendar, calendar).environment(\.timeZone, calendar.timeZone)
        .task(id: CalendarQuery(interval: interval, refresh: refresh)) { await load() }
        .confirmationDialog("Delete this appointment?", isPresented: $pendingDeletion) {
            Button("Delete", role: .destructive) { if let draft { Task { await persist(draft, delete: true) } } }
        }
    }

    private func arrow(_ label: String, _ direction: Int) -> some View {
        JarvisIconButton(title: label, systemImage: direction < 0 ? "chevron.left" : "chevron.right",
                         identifier: "calendar." + label, tint: JarvisDesignTokens.primaryAccent) {
            let unit: Calendar.Component = period == .month ? .month : .day
            date = calendar.date(byAdding: unit, value: direction * (period == .week ? 7 : 1), to: date) ?? date
        }
    }

    private func editor(_ value: CalendarDraft) -> some View {
        let binding = Binding(get: { draft ?? value }, set: { draft = $0 })
        return VStack(alignment: .leading, spacing: 10) {
            if let current = conflict, current.id == value.id {
                Text("Google Calendar has a newer version.").font(.subheadline.bold())
                Text(current.title + " · " + current.start.formatted() + " – " + current.end.formatted())
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Use calendar version") { draft = CalendarDraft(current); conflict = nil }
                Button("Keep my changes") {
                    var updated = CalendarDraft(current)
                    updated.title = value.title
                    updated.start = value.start
                    updated.end = value.end
                    updated.allDay = value.allDay
                    draft = updated
                    conflict = nil
                }
            }
            TextField("Title", text: binding.title).textFieldStyle(.roundedBorder)
            Toggle("All day", isOn: binding.allDay)
            DatePicker("Starts", selection: binding.start, displayedComponents: value.allDay ? [.date] : [.date, .hourAndMinute])
            DatePicker(value.allDay ? "Ends before" : "Ends", selection: binding.end, displayedComponents: value.allDay ? [.date] : [.date, .hourAndMinute])
            HStack {
                if !value.isNew {
                    JarvisLabelledButton(title: "Delete", systemImage: "trash", isCompact: true) { pendingDeletion = true }
                }
                Spacer()
                JarvisLabelledButton(title: "Cancel", systemImage: "xmark", isCompact: true) { draft = nil }
                JarvisLabelledButton(title: "Save", systemImage: "checkmark", isDisabled: !value.valid(calendar) || conflict?.id == value.id,
                                     isEmphasised: true, isCompact: true) { Task { await persist(value) } }
            }
        }
    }

    private func move(_ event: JarvisTodayCalendarEntry, to start: Date) {
        var edit = CalendarDraft(event)
        edit.start = start
        edit.end = start.addingTimeInterval(event.end.timeIntervalSince(event.start))
        Task { await persist(edit) }
    }

    @MainActor private func load() async {
        let range = interval
        loading = true; error = nil
        do {
            guard let source else { throw JarvisTodayDataError.unavailable }
            let page = try await source.page(from: range.start, to: range.end)
            try Task.checkCancellation()
            events = page.entries; truncated = page.truncated
            if let draft, let saved = events.first(where: { $0.id == draft.id }), saved.etag != draft.version {
                if draft.matches(saved, calendar: calendar) {
                    self.draft = nil
                    conflict = nil
                    await onChanged()
                } else {
                    conflict = saved
                }
            }
        } catch {
            if Task.isCancelled { return }
            events = []; truncated = false
            self.error = "Calendar could not load these appointments."
        }
        loading = false
    }

    @MainActor private func persist(_ change: CalendarDraft, delete: Bool = false) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            guard let source else { throw JarvisTodayDataError.unavailable }
            if !change.isNew && change.version == nil { throw JarvisTodayDataError.failed }
            if delete, let version = change.version {
                try await source.delete(id: change.id, version: version)
            } else {
                try await source.save(id: change.id, title: change.title, start: change.start, end: change.end,
                                      allDay: change.allDay, calendar: calendar, version: change.version)
            }
            draft = nil; refresh = UUID()
            await onChanged()
        } catch {
            draft = change
            self.error = "The change could not be confirmed. Refresh to compare with Google Calendar."
        }
    }
}

private struct CalendarQuery: Equatable {
    let interval: DateInterval
    let refresh: UUID
}

private struct CalendarDraft {
    let id: String
    let version: String?
    let isNew: Bool
    var title: String
    var start, end: Date
    var allDay: Bool
    init(_ event: JarvisTodayCalendarEntry) {
        id = event.id; version = event.etag; isNew = false
        title = event.title; start = event.start; end = event.end; allDay = event.allDay == true
    }
    init(date: Date, calendar: Calendar) {
        id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        version = nil; isNew = true; title = ""; allDay = false
        start = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date) ?? date
        end = start.addingTimeInterval(3600)
    }
    func matches(_ event: JarvisTodayCalendarEntry, calendar: Calendar) -> Bool {
        guard title == event.title, allDay == (event.allDay == true) else { return false }
        if allDay {
            return calendar.isDate(start, inSameDayAs: event.start) && calendar.isDate(end, inSameDayAs: event.end)
        }
        return abs(start.timeIntervalSince(event.start)) < 1 && abs(end.timeIntervalSince(event.end)) < 1
    }
    func valid(_ calendar: Calendar) -> Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        (allDay ? calendar.startOfDay(for: start) < calendar.startOfDay(for: end) : start < end)
    }
}
