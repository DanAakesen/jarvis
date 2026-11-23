import JarvisCore
import SwiftUI

struct WatchDashboardView: View {
    let voiceActive: Bool
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var loading = false
    @State private var workoutRows: [[String: JSONValue]]?
    @State private var workoutReadAt: Date?
    @State private var workoutFailed = false
    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 6) {
                        chatLink
                        Spacer(minLength: 0)
                        menuLink
                    }
                    if loading && connection.dashboard == nil {
                        ProgressView("Loading dashboard").font(.caption)
                    }
                    if let failure = connection.dashboardError, connection.reachable {
                        Text(failure).font(.caption).foregroundStyle(.secondary)
                    }
                    if !connection.reachable {
                        if connection.connecting {
                            Text("Connecting to iPhone…").font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("Open Jarvis on your iPhone to connect.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    let snapshot = connection.dashboard
                    Group {
                        if let snapshot, !snapshot.isCurrent(at: context.date) {
                            WatchSnapshotAge(date: snapshot.generatedAt)
                        }
                        upNext(snapshot, now: context.date)
                        WatchDashboardSection(title: "Workouts", symbol: "figure.run", route: .workouts) {
                            workouts(now: context.date)
                            WatchLogLiftShortcut()
                        }.id("workouts")
                        Divider()
                        WatchDashboardSection(title: "Body Fat", symbol: "chart.line.uptrend.xyaxis", route: .bodyFat) {
                            bodyFat(snapshot?.bodyFat)
                        }.id("body-fat")
                        Divider()
                        WatchDashboardSection(title: "Tasks", symbol: "checklist", route: .tasks) {
                            if let preview = snapshot?.todayTasks {
                                if snapshot?.isCurrent(at: context.date) != true {
                                    missing("Saved tasks · open the full list to refresh")
                                    WatchTaskPreviewRows(titles: preview.tasks.map(\.text))
                                } else if preview.totalCount == 0 { missing("No tasks due today") }
                                else {
                                    Text("\(preview.totalCount) today, including overdue").font(.caption2).foregroundStyle(.secondary)
                                    WatchTaskPreviewRows(titles: preview.tasks.map(\.text))
                                }
                            } else if let health = connection.snapshot, let count = health.tasksToday {
                                if !health.isCurrent(at: context.date) { WatchSnapshotAge(date: health.generatedAt) }
                                Text(count == 0 ? "No tasks due today" : "\(count) today, including overdue")
                                    .font(.caption).foregroundStyle(.secondary)
                                if count > 0 { missing("Task titles unavailable. Open the full list.") }
                            } else { missing(loading ? "Loading today's tasks…" : "Today's tasks unavailable") }
                        }.id("tasks")
                        Divider()
                        WatchDashboardSection(title: "Recent Notes", symbol: "note.text", route: .notes) {
                            if let notes = snapshot?.notes {
                                if notes.isEmpty { missing("No recent notes") }
                                WatchNoteLinks(notes: Array(notes.prefix(3)))
                            } else { missing(loading ? "Loading recent notes…" : "Recent notes unavailable") }
                        }.id("notes")
                    }
                }.padding(.horizontal, 4).padding(.bottom, 22)
            }
            .task {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--watch-fixture"),
                   let section = ["workouts", "body-fat", "tasks", "notes"].first(where: {
                       ProcessInfo.processInfo.arguments.contains("--watch-dashboard-section=\($0)")
                   }) {
                    await Task.yield()
                    proxy.scrollTo(section, anchor: .top)
                }
                WatchPreview.captureReady("dashboard")
                #endif
            }
            }
        }
        .task(id: connection.reachable) { await refresh() }
        .task(id: connection.reachable) { await refreshWorkouts() }
        .refreshable { await refresh() }
    }
    private var chatLink: some View {
        NavigationLink(value: WatchRoute.chat) {
            HStack(spacing: 4) {
                WatchOrb().frame(width: 22, height: 22)
                if !typeSize.isAccessibilitySize {
                    Text(voiceActive ? "Resume" : "Chat")
                        .font(.subheadline.weight(.semibold)).lineLimit(1)
                }
            }
            .padding(.horizontal, 6)
            .frame(minWidth: 44, minHeight: 44)
            .watchGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voiceActive ? "Resume voice" : "Chat")
    }

    private var menuLink: some View {
        NavigationLink(value: WatchRoute.menu) {
            HStack(spacing: 4) {
                Image(systemName: "square.grid.2x2")
                if !typeSize.isAccessibilitySize { Text("Menu").lineLimit(1) }
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(WatchStyle.amber)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Menu")
    }

    private func upNext(_ snapshot: WatchDashboardSnapshot?, now: Date) -> some View {
        NavigationLink(value: WatchRoute.agenda) {
            VStack(alignment: .leading, spacing: 9) {
                let current = snapshot?.isCurrent(at: now) == true
                let entries = current ? (snapshot?.agenda?.filter { $0.end > now } ?? []) : (snapshot?.agenda ?? [])
                let next = entries.first
                HStack(alignment: .firstTextBaseline) {
                    Label { WatchDashboardHeading(title: "Up Next") } icon: {
                        Image(systemName: "calendar").foregroundStyle(WatchStyle.amber)
                    }
                    Spacer(minLength: 3)
                    Image(systemName: "chevron.forward")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                if snapshot == nil {
                    missing(loading ? "Loading agenda…" : "Agenda unavailable")
                } else if snapshot?.agenda != nil {
                    if let next {
                        Text(next.title).font(.system(.body, design: .rounded, weight: .semibold))
                            .fixedSize(horizontal: false, vertical: true)
                        if current {
                            Text(next.start > now ? next.start.formatted(.relative(presentation: .named)) : "Happening now")
                                .font(.system(.body, design: .rounded, weight: .semibold)).foregroundStyle(WatchStyle.amber)
                        }
                        Text(next.start.formatted(date: .omitted, time: .shortened) + "–" +
                             next.end.formatted(date: Calendar.current.isDate(next.start, inSameDayAs: next.end) ? .omitted : .abbreviated,
                                                time: .shortened))
                            .font(.caption).foregroundStyle(.secondary)
                        if current && entries.count > 1 {
                            WatchAgendaTimeline(intervals: entries.map { DateInterval(start: $0.start, end: max($0.start, $0.end)) }, now: now)
                        }
                    } else if current { missing("No more events today") }
                    else { Text("No events in saved agenda").font(.caption).foregroundStyle(.secondary) }
                } else { missing("Agenda unavailable") }
            }
            .padding(9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .modifier(WatchSurface(radius: 16))
            .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityHint("Opens your agenda")
    }
    private func workouts(now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let health = connection.snapshot, health.gym != nil || health.runs != nil {
                if !health.isCurrent(at: now) {
                    WatchSnapshotAge(date: health.generatedAt)
                }
                HStack(spacing: 18) {
                    workoutCount("Gym", count: health.gym, goal: health.gymGoal)
                    workoutCount("Run", count: health.runs, goal: health.runGoal)
                }
                Text("Week of \(health.weekStart.formatted(.dateTime.month(.abbreviated).day()))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if let rows = workoutRows {
                if workoutFailed || workoutReadAt.map({ now.timeIntervalSince($0) >= 900 }) != false {
                    Text("Saved workouts · not current").font(.caption2).foregroundStyle(.secondary)
                }
                if let row = rows.max(by: { workoutDate($0) < workoutDate($1) }) {
                    Text(JarvisHealthLocalization.workoutName(row["workout_type"]?.stringValue, language: .en))
                        .font(.system(.title3, design: .rounded, weight: .semibold))
                    if let stamp = row["start_at"]?.stringValue, let date = WatchDashboardDates.instant(stamp) {
                        Text(date, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let duration = row["duration_seconds"]?.numberValue {
                        Label("\((duration / 60).formatted(.number.precision(.fractionLength(0)))) min", systemImage: "stopwatch")
                            .font(.caption).foregroundStyle(WatchStyle.amber)
                    }
                } else {
                    Text("No workouts in the last 7 days").font(.caption).foregroundStyle(.secondary)
                }
            } else if workoutFailed || (!connection.reachable && !connection.connecting) {
                Text("Workouts unavailable").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Loading workouts…").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func workoutDate(_ row: [String: JSONValue]) -> Date {
        if let stamp = row["start_at"]?.stringValue, let date = WatchDashboardDates.instant(stamp) { return date }
        if let day = row["workout_date"]?.stringValue, let date = WatchDashboardFormatting.day(day) { return date }
        return .distantPast
    }
    private func workoutCount(_ title: String, count: Int?, goal: Int?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(count.map(String.init) ?? "—").font(.system(.title2, design: .rounded, weight: .semibold))
                if let goal, goal > 0 { Text("/ \(goal)").font(.caption).foregroundStyle(.secondary) }
            }
            Text(title).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title + " this week")
            .accessibilityValue(count.map { "\($0)" + (goal.map { " of \($0)" } ?? "") } ?? "Unavailable")
    }
    private func bodyFat(_ points: [WatchBodyFatPoint]?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let points, let latest = points.last {
                Text(WatchDashboardFormatting.percentage(latest.percent))
                    .font(.system(.title2, design: .rounded, weight: .semibold))
                WatchBodyFatChart(dates: points.compactMap { WatchDashboardFormatting.day($0.date) },
                                  percentages: points.map(\.percent), showDates: false)
                    .frame(height: 76)
            } else { missing(points == nil ? (loading ? "Loading body fat…" : "Body fat unavailable") : "No body fat measurements") }
        }
    }
    private func missing(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
    private func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        await connection.refresh()
    }
    private func refreshWorkouts() async {
        guard connection.reachable else {
            workoutFailed = !connection.connecting
            return
        }
        while !Task.isCancelled {
            do {
                let rows: [[String: JSONValue]] = try await connection.load(.workouts)
                guard !Task.isCancelled else { return }
                workoutRows = rows
                workoutReadAt = Date()
                workoutFailed = false
            } catch {
                guard !Task.isCancelled else { return }
                workoutFailed = true
            }
            do { try await Task.sleep(for: .seconds(workoutFailed ? 15 : 300)) } catch { return }
        }
    }
}

enum WatchBodyFatSummary {
    static func trend(_ points: [WatchBodyFatPoint]) -> String {
        guard points.count > 1, let first = points.first, let last = points.last else { return "One measurement" }
        let change = last.percent - first.percent
        if abs(change) < 0.05 { return "Unchanged across \(points.count) measurements" }
        return "\(change > 0 ? "+" : "−")\(abs(change).formatted(.number.precision(.fractionLength(1)))) percentage points across \(points.count) measurements"
    }
}

struct WatchDashboardHeading: View {
    let title: String
    var body: some View {
        Text(LocalizedStringKey(title))
            .font(.system(.headline, design: .rounded))
            .accessibilityAddTraits(.isHeader)
    }
}

struct WatchDashboardSection<Content: View>: View {
    let title: String
    let symbol: String
    let route: WatchRoute
    let content: Content
    init(title: String, symbol: String, route: WatchRoute, @ViewBuilder content: () -> Content) {
        self.title = title; self.symbol = symbol; self.route = route; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            NavigationLink(value: route) {
                HStack {
                    Image(systemName: symbol).foregroundStyle(WatchStyle.amber).accessibilityHidden(true)
                    WatchDashboardHeading(title: title)
                    Spacer()
                    Image(systemName: "chevron.forward")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            content
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
struct WatchComplicationPreviewView: View {
    @EnvironmentObject private var connection: WatchConnection
    private var kind: String? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--watch-complication=") }?
            .replacingOccurrences(of: "--watch-complication=", with: "")
    }
    var body: some View {
        let entry = WatchEntry(date: Date(), health: connection.snapshot, current: true, dashboard: connection.dashboard)
        GeometryReader { proxy in
            let width = min(193, proxy.size.width)
            let height = width * 82 / 193
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if kind == nil { Text("Synthetic data").font(.caption).foregroundStyle(.secondary) }
                    if kind == nil || kind == "nutrition" {
                        WatchNutritionComplicationView(entry: entry).frame(width: width, height: height)
                    }
                    if kind == nil || kind == "home" {
                        WatchHomeComplicationView(entry: entry).frame(width: width, height: height)
                    }
                    if kind == nil || kind == "tasks" {
                        WatchTasksComplicationView(entry: entry).frame(width: width, height: height)
                    }
                    if kind == nil || kind == "body-fat" {
                        WatchBodyFatComplicationView(entry: entry).frame(width: width, height: height)
                    }
                }
            }
        }.navigationTitle("Fixture previews")
    }
}
#endif

struct WatchAgendaTimeline: View {
    let intervals: [DateInterval]
    let now: Date
    private var start: Date {
        Calendar.current.dateInterval(of: .hour, for: now)?.start ?? now
    }
    private var end: Date { start.addingTimeInterval(3 * 3600) }
    var body: some View {
        VStack(spacing: 4) {
            Canvas { context, size in
                let width = max(0, size.width)
                let height = max(0, size.height)
                let total = end.timeIntervalSince(start)
                for hour in 0...6 {
                    let x = width * CGFloat(hour) / 6
                    var tick = Path()
                    tick.move(to: CGPoint(x: x, y: height - 4))
                    tick.addLine(to: CGPoint(x: x, y: height))
                    context.stroke(tick, with: .color(.white.opacity(0.35)), lineWidth: 0.7)
                }
                for interval in intervals where interval.end > start && interval.start < end {
                    let left = max(0, min(1, interval.start.timeIntervalSince(start) / total))
                    let right = max(0, min(1, interval.end.timeIntervalSince(start) / total))
                    let rect = CGRect(x: width * CGFloat(left), y: 1, width: max(2, width * CGFloat(right - left)), height: max(1, height - 7))
                    context.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(WatchStyle.amber))
                }
                let fraction = now.timeIntervalSince(start) / total
                var marker = Path()
                let x = width * CGFloat(max(0, min(1, fraction)))
                marker.move(to: CGPoint(x: x, y: 0))
                marker.addLine(to: CGPoint(x: x, y: height))
                context.stroke(marker, with: .color(WatchStyle.amber), lineWidth: 1)
            }.frame(height: 17)
            HStack {
                ForEach(0..<4) { hour in
                    if hour > 0 { Spacer(minLength: 0) }
                    Text(start.addingTimeInterval(Double(hour) * 3600), format: .dateTime.hour())
                }
            }.font(.system(.caption2, design: .rounded)).foregroundStyle(.secondary)
        }.accessibilityHidden(true)
    }
}
