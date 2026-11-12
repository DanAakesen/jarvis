import Foundation
import JarvisCore
import SwiftUI

struct JarvisHealthLiftLog: View {
    let lifts: [[String: JSONValue]]
    let exercises: [[String: JSONValue]]
    let searchText: String
    let loading: Bool
    let exercisesLoading: Bool
    let historyLoaded: Bool
    let exercisesLoaded: Bool
    let failed: Bool
    let exercisesFailed: Bool
    let hasMore: Bool
    let exercisesPartial: Bool
    let language: JarvisAppLanguage
    let loadMore: () -> Void
    let deletingID: String?
    let onEdit: (JarvisEditableLift) -> Void
    let onDelete: (JarvisEditableLift) -> Void

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private func matches(_ lift: [String: JSONValue]) -> Bool {
        searchText.isEmpty ||
            (lift["exerciseName"]?.stringValue ?? "").localizedCaseInsensitiveContains(searchText)
    }

    var body: some View {
        let visibleExercises = exercises.filter(matches)
        let visibleLifts = lifts.filter(matches)
        JarvisHealthPanel(title: copy.text(.exercises)) {
            if visibleExercises.isEmpty {
                emptyRows(loading: exercisesLoading && !exercisesLoaded, failed: exercisesFailed)
            } else {
                ForEach(visibleExercises.indices, id: \.self) { index in
                    liftRow(visibleExercises[index], date: false)
                }
                if exercisesPartial {
                    Text(copy.text(.partial)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        JarvisHealthPanel(title: copy.text(.history)) {
            if visibleLifts.isEmpty {
                emptyRows(loading: loading && !historyLoaded, failed: failed)
            } else {
                ForEach(visibleLifts.indices, id: \.self) { index in
                    liftRow(visibleLifts[index], date: true)
                }
            }
        }
        if hasMore {
            JarvisLabelledButton(title: copy.text(.loadMore), isDisabled: loading, action: loadMore)
        }
    }

    private func emptyRows(loading: Bool, failed: Bool) -> some View {
        Group {
            if loading {
                JarvisHealthStateLine(state: .loading, language: language)
            } else {
                Text(copy.text(failed ? .loadFailed : searchText.isEmpty ? .noLifts : .noResults))
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func liftRow(_ lift: [String: JSONValue], date: Bool) -> some View {
        if let editable = JarvisEditableLift(row: lift) {
            JarvisEditableSwipeRow(
                identifier: "health.lift." + (date ? "history." : "exercise.") + editable.id,
                editTitle: "Edit",
                deleteTitle: "Delete",
                isBusy: deletingID == editable.id,
                onEdit: { onEdit(editable) }, onDelete: { onDelete(editable) }
            ) { liftContent(lift, date: date) }
            .id(editable.id)
        } else { liftContent(lift, date: date) }
    }

    private func liftContent(_ lift: [String: JSONValue], date: Bool) -> some View {
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
