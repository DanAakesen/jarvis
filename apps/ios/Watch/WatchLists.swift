import Foundation
import JarvisCore
import SwiftUI

struct WatchTasksView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var tasks: [VaultTask] = []
    @State private var loading = true
    @State private var failure: String?
    var body: some View {
        List {
            if loading { ProgressView() }
            if let failure { Text(failure); Button("Retry") { Task { await load() } } }
            else if !loading && tasks.isEmpty { Text("No tasks due today") }
            ForEach(tasks) { task in Text(task.text) }
        }.navigationTitle("Today").task { await load() }.refreshable { await load() }
    }
    private func load() async {
        loading = true; failure = nil
        defer { loading = false }
        do { tasks = try await connection.load(.tasks) }
        catch { tasks = []; failure = (error as? WatchFailure)?.message ?? "Tasks unavailable" }
    }
}

struct WatchHealthList: View {
    var lifts: Bool
    @EnvironmentObject private var connection: WatchConnection
    @State private var rows: [[String: JSONValue]] = []
    @State private var loading = true
    @State private var failure: String?
    @State private var showAdd = false
    var body: some View {
        List {
            if lifts { Button { showAdd = true } label: { Label("Add lift", systemImage: "plus") } }
            if loading { ProgressView() }
            if let failure { Text(failure); Button("Retry") { Task { await load() } } }
            else if !loading && rows.isEmpty { Text(lifts ? "No lifts recorded" : "No workouts in the last 7 days") }
            ForEach(0..<rows.count, id: \.self) { index in
                let row = rows[index]
                if lifts {
                    NavigationLink {
                        WatchLiftEditor(row: row) { Task { await load() } }
                    } label: { liftSummary(row) }
                } else {
                    NavigationLink {
                        List {
                            Text(row["workout_type"]?.stringValue ?? "Workout").font(.headline)
                            if let start = row["start_at"]?.stringValue ?? row["workout_date"]?.stringValue { Text(start) }
                            if let seconds = row["duration_seconds"]?.numberValue { Text("\(Int(seconds / 60)) min") }
                            if let kcal = row["active_energy_value"]?.numberValue { Text("\(Int(kcal)) active \(row["active_energy_unit"]?.stringValue ?? "")") }
                            if let distance = row["distance_value"]?.numberValue { Text("\(distance, specifier: "%.1f") \(row["distance_unit"]?.stringValue ?? "")") }
                        }.navigationTitle("Workout")
                    } label: {
                        VStack(alignment: .leading) {
                            Text(row["workout_type"]?.stringValue ?? "Workout")
                            if let seconds = row["duration_seconds"]?.numberValue { Text("\(Int(seconds / 60)) min").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
            if rows.count == 30 { Text("Showing the latest 30. Open iPhone for full history.").font(.caption2) }
        }.navigationTitle(lifts ? "Lifts" : "Workouts")
        .task { await load() }.refreshable { await load() }
        .sheet(isPresented: $showAdd) { NavigationStack { WatchLiftEditor { Task { await load() } } } }
    }
    private func liftSummary(_ row: [String: JSONValue]) -> some View {
        VStack(alignment: .leading) {
            Text(row["exerciseName"]?.stringValue ?? "Lift")
            Text("\(row["weightKg"]?.numberValue.map { String(format: "%g", $0) } ?? "—") kg · \(row["reps"]?.numberValue.map { String(Int($0)) } ?? "—") × \(row["sets"]?.numberValue.map { String(Int($0)) } ?? "—")")
                .font(.caption).foregroundStyle(.secondary)
            if let date = row["performedAt"]?.stringValue {
                Text(JarvisHealthLocalization.formattedDateTime(date, language: .en)).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
    private func load() async {
        loading = true; failure = nil
        defer { loading = false }
        do { rows = try await connection.load(lifts ? .lifts : .workouts) }
        catch { rows = []; failure = (error as? WatchFailure)?.message ?? "History unavailable" }
    }
}

struct WatchLiftEditor: View {
    var row: [String: JSONValue] = [:]
    var saved: () -> Void
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.dismiss) private var dismiss
    @State private var exercise = ""
    @State private var kilograms = 0.0
    @State private var reps = 8
    @State private var sets = 3
    @State private var submissionID = UUID()
    @State private var busy = false
    @State private var failure: String?
    @State private var confirmDelete = false
    private var id: String? { row["id"]?.stringValue }
    private var value: WatchLiftInput { .init(submissionID: submissionID, exercise: exercise, kilograms: kilograms, reps: reps, sets: sets) }
    var body: some View {
        Form {
            TextField("Exercise", text: $exercise)
            TextField("kg", value: $kilograms, format: .number).accessibilityLabel("Weight in kilograms")
            Stepper("\(reps) reps", value: $reps, in: 1...100)
            Stepper("\(sets) sets", value: $sets, in: 1...100)
            if let failure { Text(failure).font(.caption) }
            Button(busy ? "Saving…" : "Save") { Task { await save() } }
                .disabled(busy || !value.isValid || !connection.reachable || (!row.isEmpty && id == nil))
            if id != nil { Button("Delete lift", role: .destructive) { confirmDelete = true }.disabled(busy || !connection.reachable) }
        }.navigationTitle(id == nil ? "New lift" : "Edit lift")
        .onAppear {
            exercise = row["exerciseName"]?.stringValue ?? ""
            kilograms = row["weightKg"]?.numberValue ?? 0
            reps = Int(row["reps"]?.numberValue ?? 8); sets = Int(row["sets"]?.numberValue ?? 3)
        }
        .confirmationDialog("Delete this lift?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await remove() } }
        }
    }
    private func save() async {
        guard !busy, value.isValid else { return }
        busy = true; defer { busy = false }
        do {
            _ = try await connection.request(.init(action: .saveLift, itemID: id, data: WatchCodec.encode(value), id: submissionID))
            saved(); dismiss()
        } catch { failure = (error as? WatchFailure)?.message ?? "Save failed. Your entry is kept for retry." }
    }
    private func remove() async {
        guard !busy, let id else { return }
        busy = true; defer { busy = false }
        do { _ = try await connection.request(.init(action: .deleteLift, itemID: id)); saved(); dismiss() }
        catch { failure = (error as? WatchFailure)?.message ?? "Delete failed" }
    }
}

struct WatchFactoryView: View {
    @EnvironmentObject private var connection: WatchConnection
    @State private var projects: [FactoryProject] = []
    @State private var error: String?
    @State private var loading = true
    var body: some View {
        List {
            if loading { ProgressView() }
            if let error { Text(error); Button("Retry") { Task { await load() } } }
            else if !loading && projects.isEmpty { Text("No projects") }
            ForEach(projects) { project in NavigationLink(project.name) { WatchFactoryTasks(project: project) } }
        }.navigationTitle("Factory").task { await load() }
    }
    private func load() async {
        loading = true; error = nil; defer { loading = false }
        do { projects = try await connection.load(.projects) }
        catch { self.error = (error as? WatchFailure)?.message ?? "Factory unavailable" }
    }
}
struct WatchFactoryTasks: View {
    var project: FactoryProject
    @EnvironmentObject private var connection: WatchConnection
    @State private var tasks: [WatchFactoryTask] = []
    @State private var error: String?
    @State private var loading = true
    var body: some View {
        List {
            if loading { ProgressView() }
            if let error { Text(error); Button("Retry") { Task { await load() } } }
            else if !loading && tasks.isEmpty { Text("No tasks") }
            ForEach(tasks) { task in
                NavigationLink {
                    List {
                        Text(task.title).font(.headline)
                        Text(task.state)
                        Text(task.request)
                        if let activity = task.activity { Text(activity).foregroundStyle(.secondary) }
                    }.navigationTitle("Task")
                } label: {
                    VStack(alignment: .leading) { Text(task.title); Text(task.state).font(.caption).foregroundStyle(WatchStyle.stone) }
                }
            }
            if tasks.count == 10 { Text("Latest 10 tasks. Full board on iPhone.").font(.caption2) }
        }.navigationTitle(project.name).task { await load() }.refreshable { await load() }
    }
    private func load() async {
        loading = true; error = nil; defer { loading = false }
        do { tasks = try await connection.load(.factoryTasks, id: project.id) }
        catch { self.error = (error as? WatchFailure)?.message ?? "Tasks unavailable" }
    }
}

private extension JSONValue {
    var stringValue: String? { if case .string(let value) = self { return value }; return nil }
    var numberValue: Double? { if case .number(let value) = self { return value }; return nil }
}
