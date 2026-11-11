import JarvisCore
import SwiftUI

struct WatchReadState: View {
    let loading: Bool
    let failure: String?
    let empty: Bool
    let emptyText: String
    let retry: () -> Void
    var body: some View {
        if loading { ProgressView("Loading").font(.caption) }
        if let failure {
            Text(failure).font(.caption).foregroundStyle(.secondary)
            Button("Retry", action: retry).disabled(loading)
        } else if empty && !loading {
            Text(emptyText).font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct WatchReadFreshness: View {
    let date: Date?
    var label = "Read"
    var body: some View {
        if let date {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                Text(context.date >= date && context.date.timeIntervalSince(date) < 900
                     ? "\(label) \(date.formatted(date: .omitted, time: .shortened))"
                     : "\(label) \(date.formatted(date: .abbreviated, time: .shortened)) · not current")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

struct WatchAgendaView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var entries: [JarvisTodayCalendarEntry] = []
    @State private var nextOffset: Int?
    @State private var loading = false
    @State private var failure: String?
    @State private var readAt: Date?
    @State private var retryReset = true
    var body: some View {
        List {
            WatchReadState(loading: loading, failure: failure, empty: entries.isEmpty,
                           emptyText: "No events in the next 7 days") { Task { await load(reset: retryReset) } }
            ForEach(entries) { entry in
                NavigationLink {
                    List {
                        Text(entry.title).font(.system(.headline, design: .rounded))
                        Text(entry.start, format: .dateTime.weekday().month(.abbreviated).day().hour().minute())
                        Text("Until \(entry.end.formatted(.dateTime.hour().minute()))").foregroundStyle(.secondary)
                        if let location = entry.location, !location.isEmpty { Text(location) }
                    }.navigationTitle("Event")
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.title).font(.system(.body, design: .rounded)).fixedSize(horizontal: false, vertical: true)
                        Text(entry.start, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            if nextOffset != nil {
                Button("Load more") { Task { await load(reset: false) } }.disabled(loading)
            }
            WatchReadFreshness(date: readAt)
        }.navigationTitle("Agenda")
            .task(id: connection.reachable) { await load(reset: true) }
            .refreshable { await load(reset: true) }
    }
    private func load(reset: Bool) async {
        guard !loading else { return }
        loading = true; failure = nil; retryReset = reset
        defer { loading = false }
        do {
            let offset = reset ? 0 : nextOffset ?? 0
            let page = try await connection.loadAgenda(offset: offset)
            guard !Task.isCancelled else { return }
            guard page.offset == offset, page.nextOffset.map({ $0 > offset }) ?? true else { throw WatchFailure.failed }
            if reset { entries = page.entries }
            else {
                let existing = Set(entries.map(\.id))
                entries += page.entries.filter { !existing.contains($0.id) }
            }
            nextOffset = page.nextOffset; readAt = Date()
        } catch { failure = (error as? WatchFailure)?.message ?? "Agenda unavailable. Try again." }
    }
}

struct WatchBodyFatView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var points: [WatchBodyFatPoint] = []
    @State private var loading = false
    @State private var failure: String?
    @State private var readAt: Date?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                WatchReadState(loading: loading, failure: failure, empty: points.isEmpty,
                               emptyText: "No body fat measurements in the last three months") { Task { await load() } }
                if let latest = points.last {
                    Text(WatchDashboardFormatting.percentage(latest.percent))
                        .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                    Text("Measured \(latest.date)").font(.caption).foregroundStyle(.secondary)
                    WatchBodyFatChart(dates: points.compactMap { WatchDashboardFormatting.day($0.date) },
                                      percentages: points.map(\.percent)).frame(height: 126)
                    Text(WatchBodyFatSummary.trend(points)).font(.caption)
                    Text("\(points.count) measurements in the last three calendar months.")
                        .font(.caption2).foregroundStyle(.secondary)
                    Divider()
                    ForEach(Array(points.reversed().enumerated()), id: \.offset) { _, point in
                        HStack {
                            Text(point.date).font(.caption)
                            Spacer(minLength: 3)
                            Text(WatchDashboardFormatting.percentage(point.percent))
                                .font(.system(.body, design: .rounded, weight: .medium))
                        }.accessibilityElement(children: .combine)
                    }
                }
                WatchReadFreshness(date: readAt)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
        }.navigationTitle("Body Fat")
            .task(id: connection.reachable) { await load() }.refreshable { await load() }
    }
    private func load() async {
        guard !loading else { return }
        loading = true; failure = nil
        defer { loading = false }
        do {
            let result: [WatchBodyFatPoint] = try await connection.load(.bodyFat)
            guard !Task.isCancelled else { return }
            points = result; readAt = Date()
        } catch { failure = (error as? WatchFailure)?.message ?? "Body fat unavailable. Try again." }
    }
}

struct WatchNotesView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var notes: [VaultNoteSummary] = []
    @State private var nextOffset: Int?
    @State private var loading = false
    @State private var failure: String?
    @State private var readAt: Date?
    @State private var retryReset = true
    var body: some View {
        List {
            WatchReadState(loading: loading, failure: failure, empty: notes.isEmpty,
                           emptyText: "No recent notes") { Task { await load(reset: retryReset) } }
            ForEach(notes) { note in
                NavigationLink {
                    WatchNoteReaderView(note: note)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(note.title).font(.system(.body, design: .rounded))
                        if let date = WatchDashboardDates.instant(note.updatedAt) {
                            Text(date, format: .dateTime.month(.abbreviated).day().hour().minute())
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        if !note.folder.isEmpty { Text(note.folder).font(.caption2).foregroundStyle(.secondary) }
                    }
                }
            }
            if nextOffset != nil {
                Button("Load more") { Task { await load(reset: false) } }.disabled(loading)
            }
            WatchReadFreshness(date: readAt)
        }.navigationTitle("Recent Notes")
            .task(id: connection.reachable) { await load(reset: true) }
            .refreshable { await load(reset: true) }
    }
    private func load(reset: Bool) async {
        guard !loading else { return }
        loading = true; failure = nil; retryReset = reset
        defer { loading = false }
        do {
            let offset = reset ? 0 : nextOffset ?? 0
            let page = try await connection.loadNotes(offset: offset)
            guard !Task.isCancelled else { return }
            guard page.offset == offset, page.nextOffset.map({ $0 > offset }) ?? true else { throw WatchFailure.failed }
            if reset { notes = page.notes }
            else {
                let existing = Set(notes.map(\.path))
                notes += page.notes.filter { !existing.contains($0.path) }
            }
            nextOffset = page.nextOffset; readAt = Date()
        } catch { failure = (error as? WatchFailure)?.message ?? "Recent notes unavailable. Try again." }
    }
}

struct WatchNoteReaderView: View {
    let note: VaultNoteSummary
    @EnvironmentObject private var connection: WatchConnection
    @State private var content = ""
    @State private var revision: String?
    @State private var nextOffset: Int?
    @State private var loading = false
    @State private var failure: String?
    @State private var needsReload = false
    @State private var readAt: Date?
    @State private var retryReset = true
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(note.title).font(.system(.headline, design: .rounded))
                if !content.isEmpty { Text(content).font(.body).fixedSize(horizontal: false, vertical: true) }
                if needsReload {
                    Text(failure ?? "This note changed. Reload it to continue.").font(.caption)
                    Button("Reload note") { Task { await load(reset: true) } }.disabled(loading)
                } else {
                    WatchReadState(loading: loading, failure: failure, empty: revision != nil && content.isEmpty,
                                   emptyText: "This note is empty") {
                        Task { await load(reset: retryReset) }
                    }
                }
                if nextOffset != nil && !needsReload {
                    Text("Showing part of this note. Read more to continue.")
                        .font(.caption2).foregroundStyle(.secondary)
                    Button("Read more") { Task { await load(reset: false) } }.disabled(loading)
                }
                WatchReadFreshness(date: readAt)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
        }.navigationTitle("Note")
            .task(id: connection.reachable) { if revision == nil { await load(reset: true) } }
            .refreshable { await load(reset: true) }
    }
    private func load(reset: Bool) async {
        guard !loading else { return }
        loading = true; failure = nil; needsReload = false; retryReset = reset
        defer { loading = false }
        do {
            let offset = reset ? 0 : nextOffset ?? 0
            let page = try await connection.loadNote(path: note.path, offset: offset, revision: reset ? nil : revision)
            guard !Task.isCancelled else { return }
            guard page.path == note.path, page.offset == offset,
                  reset || page.revision == revision,
                  page.nextOffset.map({ $0 > offset }) ?? true else { throw WatchFailure.invalidRequest }
            content = reset ? page.content : content + page.content
            revision = page.revision; nextOffset = page.nextOffset; readAt = Date()
        } catch WatchFailure.invalidRequest {
            needsReload = true; failure = "This note changed or could not be read. Reload it to continue."
        } catch { failure = (error as? WatchFailure)?.message ?? "Note unavailable. Try again." }
    }
}

struct WatchHomeBriefView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var brief: WatchBriefSummary?
    @State private var loading = false
    @State private var failure: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                WatchReadState(loading: loading, failure: failure, empty: brief == nil && connection.dashboard?.brief == nil,
                               emptyText: "Your Home brief is unavailable") { Task { await load() } }
                if let brief = brief ?? connection.dashboard?.brief {
                    WatchBriefText(
                        text: brief.fullText ?? brief.text,
                        highlightedTerms: brief.fullText == nil ? brief.highlights : (brief.fullHighlights ?? brief.highlights),
                        lines: nil
                    )
                    WatchReadFreshness(date: brief.generatedAt, label: "Generated")
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
        }.navigationTitle("Home")
            .task(id: connection.reachable) { await load() }.refreshable { await load() }
    }
    private func load() async {
        guard !loading else { return }
        loading = true; failure = nil
        defer { loading = false }
        await connection.refreshBrief(force: true)
        guard !Task.isCancelled else { return }
        brief = connection.dashboard?.brief
        failure = connection.briefError
    }
}

struct WatchNutritionView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var nutrition: WatchNutritionSnapshot?
    @State private var loading = false
    @State private var failure: String?
    @State private var readAt: Date?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WatchReadState(loading: loading, failure: failure, empty: nutrition == nil,
                               emptyText: "Today's nutrition unavailable") { Task { await load() } }
                if let nutrition {
                    Text(nutrition.date).font(.caption).foregroundStyle(.secondary)
                    macro("CARB", consumed: nutrition.carbsGrams, goal: nutrition.carbsGoalGrams,
                          partial: WatchDashboardFormatting.isPartialNutrient("CARB", in: nutrition.partialNutrients))
                    macro("FAT", consumed: nutrition.fatGrams, goal: nutrition.fatGoalGrams,
                          partial: WatchDashboardFormatting.isPartialNutrient("FAT", in: nutrition.partialNutrients))
                    macro("PROT", consumed: nutrition.proteinGrams, goal: nutrition.proteinGoalGrams,
                          partial: WatchDashboardFormatting.isPartialNutrient("PROT", in: nutrition.partialNutrients))
                    if nutrition.carbsGrams == nil && nutrition.fatGrams == nil && nutrition.proteinGrams == nil {
                        Text("No nutrition values available for today. Log meals on iPhone.").font(.caption).foregroundStyle(.secondary)
                    }
                    if !nutrition.partialNutrients.isEmpty {
                        Text("* Marked fields show at least this intake; some logged meals are missing nutrient values.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text("Grams consumed against your saved goals. Missing goals are not estimated.")
                        .font(.caption2).foregroundStyle(.secondary)
                    if let updatedAt = nutrition.updatedAt {
                        Text("Source updated \(updatedAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    WatchReadFreshness(date: readAt)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
        }.navigationTitle("Nutrition")
            .task(id: connection.reachable) { await load() }.refreshable { await load() }
    }
    private func macro(_ label: String, consumed: Double?, goal: Double?, partial: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            WatchMacroBar(label: label, consumed: consumed, goal: goal, partial: partial)
            if let goal {
                Text("Goal \(goal.formatted(.number.precision(.fractionLength(0)))) g")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
    private func load() async {
        guard !loading else { return }
        loading = true; failure = nil
        defer { loading = false }
        do {
            let result: WatchNutritionSnapshot = try await connection.load(.nutrition)
            guard !Task.isCancelled else { return }
            nutrition = result; readAt = Date()
        } catch { failure = (error as? WatchFailure)?.message ?? "Nutrition unavailable. Try again." }
    }
}
