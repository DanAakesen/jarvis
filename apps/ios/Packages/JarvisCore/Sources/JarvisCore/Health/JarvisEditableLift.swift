import Foundation

public struct JarvisLiftEdit: Encodable, Equatable, Sendable {
    public let exerciseName: String
    public let weightKg: Double
    public let reps: Int
    public let sets: Int

    public init(exerciseName: String, weightKg: Double, reps: Int, sets: Int) {
        self.exerciseName = exerciseName.trimmingCharacters(in: .whitespacesAndNewlines)
        self.weightKg = weightKg
        self.reps = reps
        self.sets = sets
    }

    public var isValid: Bool {
        JarvisLiftDraft(idempotencyKey: UUID(), exerciseName: exerciseName, weightKg: weightKg, reps: reps, sets: sets).isValid
    }
}

/// Retains the actual write identity; display values must never be used to locate a lift.
public struct JarvisEditableLift: Identifiable, Equatable, Sendable {
    public enum Source: Equatable, Sendable {
        case health(id: String)
        case vault(path: String, sha: String, content: String)
    }
    public let source: Source
    public let value: JarvisLiftEdit
    public let performedAt: String
    public var id: String {
        switch source {
        case .health(let id): id
        case .vault(let path, _, _): path
        }
    }

    public init?(row: [String: JSONValue]) {
        guard let name = row["exerciseName"]?.stringValue,
              let weight = row["weightKg"]?.numberValue,
              let reps = row["reps"]?.numberValue, let sets = row["sets"]?.numberValue,
              reps.isFinite, sets.isFinite, (1...1000).contains(reps), (1...100).contains(sets),
              reps.rounded() == reps, sets.rounded() == sets,
              let date = row["performedAt"]?.stringValue else { return nil }
        value = JarvisLiftEdit(exerciseName: name, weightKg: weight, reps: Int(reps), sets: Int(sets))
        guard value.isValid else { return nil }
        performedAt = date
        if let path = row["notePath"]?.stringValue,
           let sha = row["noteSha"]?.stringValue,
           let content = row["noteContent"]?.stringValue,
           JarvisGymLogNote.parse(path: path) != nil,
           sha.range(of: #"^[a-fA-F0-9]{40}$"#, options: .regularExpression) != nil {
            source = .vault(path: path, sha: sha, content: content)
        } else if let id = row["id"]?.stringValue, UUID(uuidString: id) != nil {
            source = .health(id: id)
        } else { return nil }
    }

    /// Change only the lift line. Keep the date, session, frontmatter and additional owner notes intact.
    public func replacingLift(with edit: JarvisLiftEdit) throws -> String {
        guard edit.isValid, edit.weightKg > 0, case .vault(_, _, let content) = source else {
            throw JarvisClientError.invalidRequest
        }
        var lines = content.components(separatedBy: "\n")
        let matches = lines.indices.filter { lines[$0].hasPrefix("- Lift:") }
        guard matches.count == 1, let index = matches.first,
              JarvisGymLogNote.lift(from: lines[index]) != nil else { throw JarvisClientError.invalidRequest }
        let weight = edit.weightKg.rounded() == edit.weightKg ? String(Int(edit.weightKg)) : String(edit.weightKg)
        lines[index] = "- Lift: \(edit.exerciseName) · \(weight) kg × \(edit.reps) × \(edit.sets)"
        return lines.joined(separator: "\n")
    }
}
