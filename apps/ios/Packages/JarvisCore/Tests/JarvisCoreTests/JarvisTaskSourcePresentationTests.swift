import XCTest
@testable import JarvisCore

final class JarvisTaskSourcePresentationTests: XCTestCase {
    func testGenericTaskSourcesDoNotRepeatCollectionOrScopeNames() {
        for heading in [nil, "Tasks", "  TASKS\n", "Opgaver", "To-do", "Work", "Actions", "Handlingspunkter"] {
            XCTAssertNil(JarvisNotesPresentation.taskSourceLabel(heading: heading, path: "Work/Tasks.md"))
        }
        XCTAssertNil(JarvisNotesPresentation.taskSourceLabel(heading: " ", path: "Personal/Opgaver.md"))
        XCTAssertNil(JarvisNotesPresentation.taskSourceLabel(heading: nil, path: "tasks.md"))
        for path in ["Vault/Tasks.md", "Obsidian/Tasks.md", "./Tasks.md", "Work/./Tasks.md"] {
            XCTAssertNil(JarvisNotesPresentation.taskSourceLabel(heading: "Action items", path: path))
        }
    }

    func testRealHeadingNoteAndProjectContextRemainUseful() {
        XCTAssertEqual(JarvisNotesPresentation.taskSourceLabel(heading: "Acme kickoff", path: "Work/Tasks.md"), "Acme kickoff")
        XCTAssertEqual(JarvisNotesPresentation.taskSourceLabel(heading: "Tasks", path: "Work/Roadmap draft.md"), "Roadmap draft")
        XCTAssertEqual(JarvisNotesPresentation.taskSourceLabel(heading: "Opgaver", path: "Work/Projects/Acme/Tasks.md"), "Acme")
        XCTAssertEqual(JarvisNotesPresentation.taskSourceLabel(heading: "Tasks for launch", path: "Work/Tasks.md"), "Tasks for launch")
        XCTAssertEqual(JarvisNotesPresentation.taskSourceLabel(heading: "Actions for Acme", path: "Work/Tasks.md"), "Actions for Acme")
        XCTAssertEqual(JarvisNotesPresentation.taskSourceLabel(heading: nil, path: "Personal/Garden plan.md"), "Garden plan")
    }
}
