#if DEBUG
import Foundation
import JarvisCore

/// Synthetic native capture states, isolated behind --watch-fixture.
enum WatchLiftCaptureFixture {
    static var state: String {
        let value = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--watch-lift-state=") }?
            .components(separatedBy: "=").last ?? "draft"
        return value == "missing" ? "details" : value
    }

    static func draft() -> WatchLiftCaptureDraft {
        let text = state == "empty" ? "" : state == "details" ? "Bench press, 80 kg" : "Bench press, 80 kg, 4 reps"
        var value = WatchLiftCaptureDraft(text: text)
        if ["details", "saved", "uncertain", "deleted"].contains(state) {
            _ = value.beginSubmission(reachable: true)
            switch state {
            case "details": value.receive(.needsDetails(question: "How many reps?"))
            case "deleted": value.receive(.deleted)
            case "saved":
                if let result = try? result() { value.receive(result) }
            default: value.failSubmission()
            }
        }
        return value
    }

    static func result(for request: JarvisLiftCaptureRequest? = nil) throws -> JarvisLiftCaptureResult {
        if state == "error" { throw WatchFailure.unavailable }
        if state == "deleted" { return .deleted }
        if state == "details", request?.text.lowercased().contains("reps") != true {
            return .needsDetails(question: "How many reps?")
        }
        return try JSONDecoder().decode(JarvisLiftCaptureResult.self, from: Data(
            #"{"status":"saved","entry":{"id":"00000000-0000-4000-8000-000000000001","exerciseName":"Bench press","weightKg":80,"reps":4,"sets":1,"performedAt":"2026-11-10T12:00:00Z"},"replayed":false}"#.utf8
        ))
    }
}
#endif
