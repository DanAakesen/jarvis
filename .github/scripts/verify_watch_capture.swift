import Foundation
#if canImport(Vision)
import Vision
#endif

func normalized(_ text: String) -> String {
    text.lowercased().unicodeScalars.map {
        CharacterSet.alphanumerics.contains($0) ? String($0) : " "
    }.joined().split(whereSeparator: \.isWhitespace).joined(separator: " ")
}

func requiredText(for name: String) -> [[String]]? {
    let name = name.hasPrefix("small-") ? String(name.dropFirst(6)) : name
    switch name {
    case "dashboard": return [["up next"], ["design review"]]
    case "dashboard-workouts": return [["workouts"], ["see more"]]
    case "dashboard-body-fat": return [["body fat"]]
    case "dashboard-tasks": return [["tasks"], ["call dentist", "pay phone bill"]]
    case "dashboard-notes": return [["recent notes"], ["design review"]]
    case "actions": return [["voice"], ["dictate"], ["factory"]]
    case "chat": return [["bench"], ["message"]]
    case "health": return [["health"]]
    case "lifts": return [["lifts"], ["bench press"]]
    case "new-lift": return [["new lift"], ["exercise"]]
    case "reps-picker": return [["reps"]]
    case "new-task": return [["new task"], ["title"], ["request"]]
    case "project": return [["fixture project"], ["no tasks"]]
    case "tasks": return [["today"], ["upcoming"], ["dentist", "phone bill"]]
    case "task-detail": return [["task"], ["call dentist"], ["edit"], ["due"]]
    case "task-edit": return [["edit task"], ["title"], ["call dentist"]]
    case "personal-new-task": return [["new task"], ["auto"], ["manual"], ["describe your task", "call the dentist"]]
    case "personal-new-task-manual": return [["new task"], ["auto"], ["manual"], ["title"]]
    case "agenda": return [["agenda"], ["design review"]]
    case "body-fat": return [["body fat"], ["measured"]]
    case "notes": return [["recent notes"], ["design review"]]
    case "home": return [["home"], ["design review"]]
    case "nutrition": return [["nutrition"], ["carb"], ["fat"]]
    case "complications": return [["synthetic data"]]
    case "log-lift", "log-lift-deep-link": return [["log lift"], ["bench press"], ["save"]]
    case "log-lift-complication": return [["log lift"]]
    case "log-lift-saved": return [["saved"], ["bench press"], ["80"]]
    case "log-lift-missing": return [["how many reps"]]
    case "log-lift-uncertain": return [["save not confirmed"], ["retry"]]
    case "log-lift-deleted": return [["lift deleted"]]
    case "tasks-deep-link": return requiredText(for: "tasks")
    default: return nil
    }
}

func verify(_ text: String, name: String) -> Bool {
    guard let groups = requiredText(for: name) else { return false }
    let text = normalized(text)
    return groups.allSatisfy { alternatives in
        alternatives.contains { text.contains(normalized($0)) }
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 2 || (arguments.count == 3 && arguments[0] == "--recognized-text") else {
    fputs("Usage: verify_watch_capture <capture-name> <screenshot.png>\n", stderr)
    exit(2)
}
let name: String
let text: String
if arguments.count == 3 {
    name = arguments[1]
    text = arguments[2]
} else {
    name = arguments[0]
    #if canImport(Vision)
    do {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(url: URL(fileURLWithPath: arguments[1])).perform([request])
        text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    } catch {
        fputs("Screenshot text recognition failed.\n", stderr)
        exit(1)
    }
    #else
    fputs("Screenshot verification requires Apple's Vision framework.\n", stderr)
    exit(2)
    #endif
}
print(text)
guard verify(text, name: name) else {
    fputs("Screenshot does not show the required destination content for \(name).\n", stderr)
    exit(1)
}
