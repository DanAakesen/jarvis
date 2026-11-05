import Foundation
import JarvisCore

/// Illustrative data for the widget gallery and the Xcode previews. Never read from, or written to, the App Group.
enum JarvisWidgetSamples {
    static let now = Date()
    private static var calendar: Calendar { .current }

    static var gym: JarvisGymWidgetData {
        JarvisGymWidgetData(
            generatedAt: now,
            lastDay: calendar.startOfDay(for: now),
            stepGoal: 8_000,
            dailySteps: [5_200, 9_100, 7_400, 3_800, 8_600, 10_200, 6_400],
            liftsDone: 3, liftsTarget: 4, runsDone: 1, runsTarget: 2,
            trainedDays: [true, false, true, false, true, false, true],
            kilometers: 5.2, calories: 1_240,
            weeks: [
                .init(weekNumber: 40, lifts: 3, runs: 1), .init(weekNumber: 41, lifts: 4, runs: 2),
                .init(weekNumber: 42, lifts: 2, runs: 1), .init(weekNumber: 43, lifts: 4, runs: 2),
                .init(weekNumber: 44, lifts: 3, runs: 0), .init(weekNumber: 45, lifts: 4, runs: 1),
                .init(weekNumber: 46, lifts: 3, runs: 1),
            ]
        )
    }

    static func factory(language: JarvisAppLanguage = .da) -> JarvisFactoryWidgetData {
        let da = language == .da
        return JarvisFactoryWidgetData(
            generatedAt: now,
            lastDay: calendar.startOfDay(for: now),
            running: 2, awaiting: 1, review: 1, failed: 1,
            doneLast7Days: [2, 4, 1, 3, 5, 2, 3],
            tasks: [
                .init(id: "c1", title: da ? "Flet release-PR" : "Merge release PR",
                      detail: da ? "Udløber kl. 17:47" : "Expires at 17:47", status: .awaiting, action: .approve),
                .init(id: "t1", title: da ? "Widgets til hjemmeskærmen" : "Home screen widgets",
                      detail: "Copilot · " + (da ? "Skriver tests" : "Writing tests"), status: .running, action: .pause),
                .init(id: "t2", title: da ? "Ret sync-fejl" : "Fix sync bug",
                      detail: da ? "Fejlet · Sessionen sluttede uventet" : "Failed · Session ended unexpectedly",
                      status: .failed, action: .retry),
                .init(id: "t3", title: da ? "Opdater afhængigheder" : "Update dependencies",
                      detail: da ? "PR 134 · checks kører" : "PR 134 · checks running", status: .review),
                .init(id: "t4", title: da ? "Ryd op i logs" : "Tidy logs",
                      detail: "Codex · " + (da ? "Læser kode" : "Reading code"), status: .running, action: .pause),
            ]
        )
    }

    static func notes(language: JarvisAppLanguage = .da) -> JarvisNotesWidgetData {
        let da = language == .da
        let today = calendar.startOfDay(for: now)
        return JarvisNotesWidgetData(
            generatedAt: now,
            tasksToday: 3,
            tasks: [
                .init(id: "k1", title: da ? "Ring til tandlægen" : "Call the dentist", time: "14:00", dueDate: today),
                .init(id: "k2", title: da ? "Send faktura" : "Send invoice", dueDate: today),
                .init(id: "k3", title: da ? "Planlæg ugen" : "Plan the week", time: "17:30", dueDate: today),
            ],
            notes: [
                .init(id: "n1", title: da ? "Idéer til widgets" : "Widget ideas", editedAt: now.addingTimeInterval(-1_800)),
                .init(id: "n2", title: da ? "Mødenoter" : "Meeting notes", editedAt: now.addingTimeInterval(-90_000)),
                .init(id: "n3", title: da ? "Indkøb" : "Shopping", editedAt: now.addingTimeInterval(-200_000)),
            ]
        )
    }

    static var home: JarvisHomeWidgetData {
        JarvisHomeWidgetData(generatedAt: now, approvals: 1, running: 2)
    }

    static func entry(
        gym: JarvisWidgetViewState<JarvisGymWidgetData>? = nil,
        factory: JarvisWidgetViewState<JarvisFactoryWidgetData>? = nil,
        notes: JarvisWidgetViewState<JarvisNotesWidgetData>? = nil,
        home: JarvisWidgetViewState<JarvisHomeWidgetData>? = nil,
        language: JarvisAppLanguage = .da
    ) -> JarvisWidgetEntry {
        JarvisWidgetEntry(
            date: now, language: language,
            gym: gym ?? .content(Self.gym, isStale: false),
            factory: factory ?? .content(Self.factory(language: language), isStale: false),
            notes: notes ?? .content(Self.notes(language: language), isStale: false),
            home: home ?? .content(Self.home, isStale: false)
        )
    }
}
