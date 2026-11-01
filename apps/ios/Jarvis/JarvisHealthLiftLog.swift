import Foundation
import JarvisCore
import SwiftUI

struct JarvisHealthLiftLog: View {
    let lifts: [[String: JSONValue]]
    let exercises: [[String: JSONValue]]
    let searchText: String
    let loading: Bool
    let failed: Bool
    let hasMore: Bool
    let exercisesPartial: Bool
    let language: JarvisAppLanguage
    let loadMore: () -> Void

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private func matches(_ lift: [String: JSONValue]) -> Bool {
        searchText.isEmpty ||
            (lift["exerciseName"]?.stringValue ?? "").localizedCaseInsensitiveContains(searchText)
    }

    var body: some View {
        let visibleExercises = exercises.filter(matches)
        let visibleLifts = lifts.filter(matches)
        if loading && lifts.isEmpty {
            ProgressView(copy.text(.loading))
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.healthChartHeight)
        } else if lifts.isEmpty && !failed {
            ContentUnavailableView(copy.text(.noLifts), systemImage: "dumbbell")
        } else {
            if !visibleExercises.isEmpty {
                JarvisHealthPanel(title: copy.text(.exercises)) {
                    ForEach(visibleExercises.indices, id: \.self) { index in
                        liftRow(visibleExercises[index], date: false)
                    }
                    if exercisesPartial {
                        Text(copy.text(.partial)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !visibleLifts.isEmpty {
                JarvisHealthPanel(title: copy.text(.history)) {
                    ForEach(visibleLifts.indices, id: \.self) { index in
                        liftRow(visibleLifts[index], date: true)
                    }
                }
            }
            if visibleExercises.isEmpty && visibleLifts.isEmpty && !searchText.isEmpty {
                ContentUnavailableView(copy.text(.noResults), systemImage: "magnifyingglass")
            }
            if hasMore {
                Button(copy.text(.loadMore), action: loadMore)
                    .buttonStyle(.bordered)
                    .disabled(loading)
            }
        }
    }

    private func liftRow(_ lift: [String: JSONValue], date: Bool) -> some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            Text(lift["exerciseName"]?.stringValue ?? "").font(.body.weight(.medium))
            HStack {
                Text(lift["weightKg"]?.numberValue ?? 0, format: .number)
                Text("kg")
                Text("×")
                Text(lift["reps"]?.numberValue ?? 0, format: .number)
                Text("×")
                Text(lift["sets"]?.numberValue ?? 0, format: .number)
                Text(copy.text(.sets))
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            if date, let performedAt = lift["performedAt"]?.stringValue {
                Text(JarvisHealthLocalization.formattedDateTime(performedAt, language: language))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct JarvisHealthNewLiftSheet: View {
    let client: JarvisHealthClient?
    let exercises: [[String: JSONValue]]
    let language: JarvisAppLanguage
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var weight = ""
    @State private var reps = ""
    @State private var sets = ""
    @State private var submissionID = UUID()
    @State private var submittedDraft: JarvisLiftDraft?
    @State private var saving = false
    @State private var failed = false
    @State private var saveVersion = 0

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private var suggestedExercises: [[String: JSONValue]] {
        let query = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return Array(exercises.filter {
            guard let exercise = $0["exerciseName"]?.stringValue else { return false }
            return (query.isEmpty || exercise.localizedCaseInsensitiveContains(query)) &&
                exercise.caseInsensitiveCompare(query) != .orderedSame
        }.prefix(4))
    }
    private var draft: JarvisLiftDraft? {
        guard let kg = Double(weight.replacingOccurrences(of: ",", with: ".")),
              let repetitions = Int(reps), let setCount = Int(sets) else { return nil }
        let value = JarvisLiftDraft(
            idempotencyKey: submissionID, exerciseName: name,
            weightKg: kg, reps: repetitions, sets: setCount
        )
        return value.isValid ? value : nil
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section {
                    TextField(copy.text(.name), text: $name)
                    TextField(copy.text(.liftWeight), text: $weight).keyboardType(.decimalPad)
                    TextField(copy.text(.reps), text: $reps).keyboardType(.numberPad)
                    TextField(copy.text(.sets), text: $sets).keyboardType(.numberPad)
                }
                .disabled(submittedDraft != nil)
                if !suggestedExercises.isEmpty {
                    Section {
                        ScrollView(.horizontal) {
                            HStack(spacing: JarvisDesignTokens.notesChipSpacing) {
                                ForEach(suggestedExercises.indices, id: \.self) { index in
                                    let exercise = suggestedExercises[index]
                                    Button(exercise["exerciseName"]?.stringValue ?? "") {
                                        name = exercise["exerciseName"]?.stringValue ?? ""
                                        weight = String(format: "%g", exercise["weightKg"]?.numberValue ?? 0)
                                        reps = String(format: "%.0f", exercise["reps"]?.numberValue ?? 1)
                                        sets = String(format: "%.0f", exercise["sets"]?.numberValue ?? 1)
                                    }
                                    .buttonStyle(.glass)
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel(copy.text(.pastExercises))
                    }
                    .disabled(submittedDraft != nil)
                }
                if failed {
                    Text(copy.text(.saveFailed))
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .navigationTitle(copy.text(.newLift))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(copy.text(.cancel)) { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(copy.text(saving ? .saving : .save)) {
                        submittedDraft = submittedDraft ?? draft
                        saving = true
                        failed = false
                        saveVersion += 1
                    }
                    .disabled(saving || client == nil || (submittedDraft ?? draft) == nil)
                }
            }
        }
        .environment(\.locale, language.locale)
        .tint(JarvisDesignTokens.healthAccent)
        .interactiveDismissDisabled(saving)
        .task(id: saveVersion) {
            guard saveVersion > 0, let client, let submittedDraft else { return }
            do {
                try await client.createLift(submittedDraft)
                try Task.checkCancellation()
                onSaved()
                dismiss()
            } catch {
                failed = true
            }
            saving = false
        }
    }
}
