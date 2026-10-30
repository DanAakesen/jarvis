import XCTest
@testable import JarvisCore

final class JarvisCoreTests: XCTestCase {
    func testPackageModuleIsAvailable() {
        XCTAssertEqual(String(describing: JarvisCore.self), "JarvisCore")
    }

    func testSidebarItemsAreOrderedFromLowestToHighest() {
        XCTAssertEqual(
            JarvisDestination.sidebarItems,
            [.proactive, .status, .usage, .banking, .softwareFactory, .health, .notes, .chat]
        )
    }

    func testNavigationPushesPlaceholderAndBackReturnsToChat() {
        var navigation = JarvisNavigationState()

        navigation.navigate(to: .health)
        XCTAssertEqual(navigation.currentDestination, .health)
        XCTAssertEqual(navigation.path, [.health])

        navigation.goBack()
        XCTAssertEqual(navigation.currentDestination, .chat)
        XCTAssertTrue(navigation.path.isEmpty)
    }

    func testNavigationReusesExistingDestinationAndChatReturnsToRoot() {
        var navigation = JarvisNavigationState()
        navigation.navigate(to: .notes)
        navigation.navigate(to: .settings)
        navigation.navigate(to: .notes)

        XCTAssertEqual(navigation.path, [.notes])
        navigation.navigate(to: .chat)
        XCTAssertTrue(navigation.path.isEmpty)
        XCTAssertEqual(navigation.currentDestination, .chat)
    }

    func testVoiceIsANavigableDestinationAndBankingIsDisabled() {
        var navigation = JarvisNavigationState()
        navigation.navigate(to: .voice)
        XCTAssertEqual(navigation.currentDestination, .voice)

        navigation.navigate(to: .banking)
        XCTAssertEqual(navigation.currentDestination, .voice)
        XCTAssertEqual(navigation.path, [.voice])
    }

    func testNavigationPathRejectsRootDisabledAndDuplicateDestinations() {
        var navigation = JarvisNavigationState()
        navigation.setPath([.chat, .notes, .banking, .notes, .settings])

        XCTAssertEqual(navigation.path, [.notes, .settings])
        XCTAssertEqual(navigation.currentDestination, .settings)
    }

    func testSidebarCanBeOpenedAndClosed() {
        var navigation = JarvisNavigationState()
        navigation.openSidebar()
        XCTAssertTrue(navigation.isSidebarOpen)

        navigation.navigate(to: .status)
        XCTAssertFalse(navigation.isSidebarOpen)

        navigation.setSidebarOpen(true)
        navigation.closeSidebar()
        XCTAssertFalse(navigation.isSidebarOpen)
    }
}
