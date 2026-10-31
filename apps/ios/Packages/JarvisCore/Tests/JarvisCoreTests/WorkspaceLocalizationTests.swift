import Foundation
import XCTest
@testable import JarvisCore

final class WorkspaceLocalizationTests: XCTestCase {
    func testEveryWorkspaceStringHasDanishAndEnglishTranslations() {
        for key in JarvisWorkspaceLocalizationKey.allCases {
            XCTAssertNotEqual(
                JarvisWorkspaceLocalization.string(key, language: .da),
                key.rawValue
            )
            XCTAssertNotEqual(
                JarvisWorkspaceLocalization.string(key, language: .en),
                key.rawValue
            )
        }

        XCTAssertEqual(JarvisWorkspaceLocalization.string(.title, language: .da), "Arbejdsområder")
        XCTAssertEqual(JarvisWorkspaceLocalization.string(.groupWeek, language: .da), "Denne uge")
        XCTAssertEqual(
            JarvisWorkspaceLocalization.formatted(.openItem, language: .da, arguments: ["Plan", "Rapporter", "i dag"]),
            "Åbn Plan, Rapporter, i dag"
        )
    }

    func testCommandRefusalUsesTheSelectedLanguage() {
        let command = WorkspaceCommand(
            commandId: "fixture_move",
            operation: "move",
            fields: ["viewId": .string("fixture_view")]
        )

        XCTAssertEqual(
            WorkspaceCommandInterpreter.interpret(command, language: .da),
            .refused(reason: "Placering af vinduer understøttes ikke på iPhone.")
        )
        XCTAssertEqual(
            WorkspaceCommandInterpreter.interpret(command, language: .en),
            .refused(reason: "Window positioning is not supported on iPhone.")
        )
    }
}
