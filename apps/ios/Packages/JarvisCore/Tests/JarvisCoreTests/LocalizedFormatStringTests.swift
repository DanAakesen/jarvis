import Foundation
import XCTest
@testable import JarvisCore

/// Format strings are checked against the argument types their call sites pass. A mismatch such as an Int
/// given to `%@` crashes at runtime, so every placeholder must match the declared argument types.
final class LocalizedFormatStringTests: XCTestCase {
    private static let tables = [
        "JarvisApprovals", "JarvisChat", "JarvisFactory", "JarvisHealth", "JarvisNotes",
        "JarvisSettings", "JarvisToday", "JarvisWorkspaces", "VoiceLiveActivity",
    ]

    /// "@" is an object argument (String); "ld" is an Int argument.
    private static let expected: [String: [String]] = [
        "approval.expires": ["@"],
        "chat.failedChecksSummary": ["ld"],
        "chat.dismissLabel": ["@"],
        "chat.clearGroupLabel": ["@"],
        "chat.groupMore": ["ld"],
        "factory.issueNumber": ["ld"],
        "factory.blockedBy": ["ld"],
        "health.target": ["@"],
        "today.greeting.nextEvent": ["@", "@"],
        "today.greeting.tasks": ["ld"],
        "today.showMore": ["ld"],
        "today.ago.days": ["ld"],
        "workspace.removeQuestion": ["@"],
        "workspace.connectionLabel": ["@"],
        "workspace.openItem": ["@", "@", "@"],
        "workspace.actionsFor": ["@"],
        "workspace.tableSize": ["ld", "ld"],
        "workspace.chartSummary": ["@", "@"],
        "workspace.chartNoValues": ["@"],
        "workspace.chartPoints": ["@", "ld"],
        "workspace.chartRange": ["@", "@", "@"],
        "workspace.unsupportedOnPhone": ["@", "@"],
        "workspace.actionUnavailableOnPhone": ["@"],
        "workspace.routeUnavailable": ["@"],
        "workspace.toolUnavailableLabel": ["@"],
    ]

    func testEveryFormatStringMatchesItsArgumentTypesInBothLanguages() throws {
        var seen = Set<String>()
        for language in JarvisAppLanguage.allCases {
            for table in Self.tables {
                let url = Self.resourcesURL
                    .appendingPathComponent("\(language.rawValue).lproj")
                    .appendingPathComponent("\(table).strings")
                let entries = try XCTUnwrap(
                    NSDictionary(contentsOf: url) as? [String: String],
                    "\(table).strings [\(language.rawValue)] must be readable"
                )
                for (key, value) in entries {
                    let specifiers = Self.specifiers(in: value)
                    guard !specifiers.isEmpty else {
                        XCTAssertNil(Self.expected[key], "\(key) [\(language.rawValue)] lost its placeholders")
                        continue
                    }
                    seen.insert(key)
                    XCTAssertEqual(
                        specifiers, Self.expected[key],
                        "\(key) [\(language.rawValue)] placeholders do not match the arguments passed"
                    )
                }
            }
        }
        XCTAssertEqual(seen, Set(Self.expected.keys))
    }

    /// The package sources are read directly; the library's resource bundle is not visible to the test target.
    private static var resourcesURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/JarvisCore/Resources")
    }

    private static func specifiers(in format: String) -> [String] {
        let pattern = #"%(?:\d+\$)?[-+ 0#]*\d*(?:\.\d+)?(ll|l|h)?([@dDiuUxXfeEgGcCsSp%])"#
        let regex = try! NSRegularExpression(pattern: pattern)
        let range = NSRange(format.startIndex..., in: format)
        return regex.matches(in: format, range: range).compactMap { match in
            let kind = String(format[Range(match.range(at: 2), in: format)!])
            guard kind != "%" else { return nil }
            let length = Range(match.range(at: 1), in: format).map { String(format[$0]) } ?? ""
            return length + kind
        }
    }
}
