import JarvisCore
import SwiftUI

struct WatchDashboardView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var loading = false
    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Jarvis").font(.system(.headline, design: .rounded))
                        Spacer()
                        NavigationLink(value: WatchRoute.menu) {
                            Image(systemName: "line.3.horizontal").foregroundStyle(WatchStyle.amber)
                                .frame(width: 44, height: 44)
                        }.buttonStyle(.plain).accessibilityLabel("Menu")
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
                            Text("Saved \(snapshot.generatedAt.formatted(date: .abbreviated, time: .shortened)) · not current")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        upNext(snapshot, now: context.date)
                        Divider()
                        WatchDashboardSection(title: "Workouts", route: .workouts) {
                            workouts(now: context.date)
                            WatchLogLiftShortcut()
                        }.id("workouts")
                        Divider()
                        WatchDashboardSection(title: "Body Fat", route: .bodyFat) {
                            bodyFat(snapshot?.bodyFat)
                        }.id("body-fat")
                        Divider()
                        WatchDashboardSection(title: "Tasks", route: .tasks) {
                            if let preview = snapshot?.todayTasks {
                                if snapshot?.isCurrent(at: context.date) != true {
                                    missing("Saved tasks · open the full list to refresh")
                                    WatchTaskPreviewRows(titles: preview.tasks.map(\.text))
                                } else if preview.totalCount == 0 { missing("No tasks due today") }
                                else {
                                    Text("\(preview.totalCount) today, including overdue").font(.caption2).foregroundStyle(.secondary)
                                    WatchTaskPreviewRows(titles: preview.tasks.map(\.text))
                                }
                            } else if let health = connection.snapshot, health.isCurrent(at: context.date), let count = health.tasksToday {
                                Text(count == 0 ? "No tasks due today" : "\(count) today, including overdue")
                                    .font(.caption).foregroundStyle(.secondary)
                                if count > 0 { missing("Task titles unavailable. Open the full list.") }
                            } else { missing(loading ? "Loading today's tasks…" : "Today's tasks unavailable") }
                        }.id("tasks")
                        Divider()
                        WatchDashboardSection(title: "Recent Notes", route: .notes) {
                            if let notes = snapshot?.notes {
                                if notes.isEmpty { missing("No recent notes") }
                                ForEach(notes.prefix(3)) { note in
                                    NavigationLink {
                                        WatchNoteReaderView(note: note)
                                    } label: {
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(note.title).font(.system(.body, design: .rounded)).lineLimit(2)
                                            if let date = WatchDashboardDates.instant(note.updatedAt) {
                                                Text(date, format: .dateTime.month(.abbreviated).day())
                                                    .font(.caption2).foregroundStyle(.secondary)
                                            }
                                        }.frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                                    }.buttonStyle(.plain)
                                }
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
        .refreshable { await refresh() }
    }
    private func upNext(_ snapshot: WatchDashboardSnapshot?, now: Date) -> some View {
        NavigationLink(value: WatchRoute.agenda) {
            VStack(alignment: .leading, spacing: 9) {
                let entries = snapshot?.agenda?.filter { $0.end > now } ?? []
                let next = entries.first
                HStack(alignment: .firstTextBaseline) {
                    WatchDashboardHeading(title: "Up Next")
                    Spacer(minLength: 3)
                    if let next, snapshot?.isCurrent(at: now) == true { Text(next.start, format: .dateTime.hour().minute()).font(.caption).foregroundStyle(WatchStyle.amber) }
                }
                if snapshot == nil {
                    missing(loading ? "Loading agenda…" : "Agenda unavailable")
                } else if snapshot?.isCurrent(at: now) != true {
                    missing("Saved agenda · open to refresh")
                } else if snapshot?.agenda != nil {
                    WatchAgendaTimeline(intervals: entries.map { DateInterval(start: $0.start, end: max($0.start, $0.end)) }, now: now)
                    if let next {
                        Text(next.title).font(.system(.body, design: .rounded, weight: .semibold))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(next.start > now ? next.start.formatted(.relative(presentation: .named)) : "Happening now")
                            .font(.system(.body, design: .rounded, weight: .semibold)).foregroundStyle(WatchStyle.amber)
                        Text(next.start.formatted(date: .omitted, time: .shortened) + "–" +
                             next.end.formatted(date: Calendar.current.isDate(next.start, inSameDayAs: next.end) ? .omitted : .abbreviated,
                                                time: .shortened))
                            .font(.caption).foregroundStyle(.secondary)
                    } else { missing("No more events today") }
                } else { missing("Agenda unavailable") }
            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityHint("Opens your agenda")
    }
    private func workouts(now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let health = connection.snapshot {
                if !health.isCurrent(at: now) {
                    Text("Saved workout counts · not current").font(.caption2).foregroundStyle(.secondary)
                }
                HStack(spacing: 18) {
                    workoutCount("Gym", count: health.gym, goal: health.gymGoal)
                    workoutCount("Run", count: health.runs, goal: health.runGoal)
                }
                Text("Week of \(health.weekStart.formatted(.dateTime.month(.abbreviated).day()))")
                    .font(.caption2).foregroundStyle(.secondary)
            } else { missing(loading ? "Loading weekly workouts…" : "Weekly workouts unavailable") }
        }
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
        HStack(spacing: 6) {
            Image(systemName: "circle.fill").font(.system(size: 6))
                .foregroundStyle(WatchStyle.amber).accessibilityHidden(true)
            Text(title).font(.system(.headline, design: .rounded))
                .accessibilityAddTraits(.isHeader)
        }
    }
}

struct WatchDashboardSection<Content: View>: View {
    let title: String
    let route: WatchRoute
    let content: Content
    init(title: String, route: WatchRoute, @ViewBuilder content: () -> Content) {
        self.title = title; self.route = route; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                WatchDashboardHeading(title: title)
                Spacer(minLength: 0)
                NavigationLink(value: route) {
                    Text("See more")
                        .font(.system(size: 10, relativeTo: .caption2))
                        .underline()
                        .foregroundStyle(WatchStyle.amber)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                }
                    .buttonStyle(.plain)
                    .accessibilityLabel("See more \(title)")
            }
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
