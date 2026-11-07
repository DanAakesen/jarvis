import JarvisCore
import SwiftUI
import WidgetKit

private func staleText(_ data: JarvisGymWidgetData, stale: Bool, language: JarvisAppLanguage) -> String? {
    stale ? JarvisWidgetFormat.updated(data.generatedAt, language: language) : nil
}

private func stepsDescription(_ data: JarvisGymWidgetData, language: JarvisAppLanguage) -> String {
    "\(JarvisWidgetCopy.steps.text(language: language)): \(data.dailySteps.map(String.init).joined(separator: ", ")). "
        + JarvisWidgetFormat.ofGoal(data.stepGoal, language: language)
}

private func lifts(_ data: JarvisGymWidgetData) -> String { "\(data.liftsDone)/\(data.liftsTarget)" }
private func runs(_ data: JarvisGymWidgetData) -> String { "\(data.runsDone)/\(data.runsTarget)" }

/// Steps (small): the chart fills the card.
struct JarvisGymStepsWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.gym, language: language, emptyCopy: .emptyGym) { data, stale in
            VStack(alignment: .leading, spacing: 4) {
                JarvisWidgetHeader(
                    symbol: "figure.walk", title: JarvisWidgetCopy.steps.text(language: language),
                    staleText: staleText(data, stale: stale, language: language)
                )
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(JarvisWidgetFormat.count(data.stepsToday, language: language))
                        .font(.title.weight(.bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(JarvisWidgetFormat.ofGoal(data.stepGoal, language: language))
                        .font(.caption2)
                        .foregroundStyle(JarvisWidgetPalette.secondaryText)
                        .lineLimit(1)
                }
                JarvisWidgetBarChart(
                    values: data.dailySteps,
                    labels: JarvisWidgetFormat.dayLetters(endingOn: data.lastDay, language: language),
                    target: data.stepGoal,
                    accessibilityText: stepsDescription(data, language: language)
                )
            }
        }
        .jarvisWidgetSurface()
    }
}

/// Workouts (small): the week count sits in the free space, dots and day letters below.
struct JarvisGymWorkoutsWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.gym, language: language, emptyCopy: .emptyGym) { data, stale in
            VStack(alignment: .leading, spacing: 4) {
                JarvisWidgetHeader(
                    symbol: "figure.strengthtraining.traditional",
                    title: JarvisWidgetCopy.workouts.text(language: language),
                    staleText: staleText(data, stale: stale, language: language)
                )
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(data.workoutsDone)/\(data.workoutsTarget)")
                        .font(.largeTitle.weight(.bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(JarvisWidgetCopy.thisWeek.text(language: language))
                        .font(.caption)
                        .foregroundStyle(JarvisWidgetPalette.secondaryText)
                }
                Spacer(minLength: 0)
                JarvisWidgetWeekDots(
                    trained: data.trainedDays,
                    labels: JarvisWidgetFormat.dayLetters(endingOn: data.lastDay, language: language),
                    accessibilityText: "\(JarvisWidgetCopy.workouts.text(language: language)) \(data.workoutsDone)/\(data.workoutsTarget) \(JarvisWidgetCopy.thisWeek.text(language: language))"
                )
            }
        }
        .jarvisWidgetSurface()
    }
}

/// Medium: a full-width heading above the steps ring, balanced metric columns and week dots.
struct JarvisGymMediumWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.gym, language: language, emptyCopy: .emptyGym) { data, stale in
            VStack(alignment: .leading, spacing: 6) {
                JarvisWidgetHeader(
                    symbol: "figure.strengthtraining.traditional",
                    title: JarvisWidgetCopy.workouts.text(language: language),
                    staleText: staleText(data, stale: stale, language: language)
                )
                HStack(spacing: 16) {
                    JarvisWidgetStepsRing(steps: data.stepsToday, goal: data.stepGoal, language: language)
                        .frame(width: 88, height: 88)
                        .padding(4) // Keep the stroked ring inside the content inset.
                    VStack(alignment: .leading, spacing: 6) {
                        VStack(spacing: 6) {
                            HStack(spacing: 12) {
                                cell(.lift, lifts(data))
                                cell(.run, runs(data))
                            }
                            HStack(spacing: 12) {
                                cell(.kilometers, JarvisWidgetFormat.kilometers(data.kilometers, language: language))
                                cell(.calories, JarvisWidgetFormat.count(data.calories, language: language))
                            }
                        }
                        JarvisWidgetWeekDots(
                            trained: data.trainedDays,
                            labels: JarvisWidgetFormat.dayLetters(endingOn: data.lastDay, language: language),
                            accessibilityText: "\(JarvisWidgetCopy.workouts.text(language: language)) \(data.workoutsDone)/\(data.workoutsTarget)"
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .jarvisWidgetSurface()
    }

    private func cell(_ copy: JarvisWidgetCopy, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
            Text(copy.text(language: entry.language)).font(.caption2).foregroundStyle(JarvisWidgetPalette.secondaryText).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("widget.workouts.\(copy.rawValue)")
    }
}

/// Large: the steps section, then the workouts section with the seven-week stacked chart.
struct JarvisGymLargeWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.gym, language: language, emptyCopy: .emptyGym) { data, stale in
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    JarvisWidgetHeader(
                        symbol: "figure.walk", title: JarvisWidgetCopy.steps.text(language: language),
                        staleText: staleText(data, stale: stale, language: language)
                    )
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(JarvisWidgetFormat.count(data.averageSteps, language: language))
                            .font(.title.weight(.bold))
                        Text(JarvisWidgetCopy.average.text(language: language))
                            .font(.caption)
                            .foregroundStyle(JarvisWidgetPalette.secondaryText)
                        Spacer()
                        Text(JarvisWidgetFormat.ofGoal(data.stepGoal, language: language))
                            .font(.caption)
                            .foregroundStyle(JarvisWidgetPalette.secondaryText)
                    }
                    JarvisWidgetBarChart(
                        values: data.dailySteps,
                        labels: JarvisWidgetFormat.dayLetters(endingOn: data.lastDay, language: language),
                        target: data.stepGoal,
                        accessibilityText: stepsDescription(data, language: language)
                    )
                }
                VStack(alignment: .leading, spacing: 4) {
                    JarvisWidgetHeader(
                        symbol: "figure.strengthtraining.traditional",
                        title: JarvisWidgetCopy.workouts.text(language: language)
                    )
                    HStack(spacing: 18) {
                        headline(.lift, lifts(data), JarvisWidgetPalette.lift)
                        headline(.run, runs(data), JarvisWidgetPalette.run)
                        Spacer()
                    }
                    JarvisWidgetStackedChart(
                        weeks: data.weeks,
                        target: data.liftsTarget + data.runsTarget,
                        accessibilityText: "\(JarvisWidgetCopy.lift.text(language: language)) \(lifts(data)), \(JarvisWidgetCopy.run.text(language: language)) \(runs(data))"
                    )
                }
            }
        }
        .jarvisWidgetSurface()
    }

    private func headline(_ copy: JarvisWidgetCopy, _ value: String, _ color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7).accessibilityHidden(true)
            Text(copy.text(language: entry.language)).font(.caption).foregroundStyle(JarvisWidgetPalette.secondaryText)
            Text(value).font(.title2.weight(.bold))
        }
        .accessibilityElement(children: .combine)
    }
}
