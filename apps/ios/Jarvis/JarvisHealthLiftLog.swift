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
            JarvisLoadingView(title: copy.text(.loading))
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
                JarvisLabelledButton(title: copy.text(.loadMore), isDisabled: loading, action: loadMore)
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
