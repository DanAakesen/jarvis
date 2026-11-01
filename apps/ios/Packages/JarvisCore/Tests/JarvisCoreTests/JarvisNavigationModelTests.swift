import Foundation
import JarvisCore
import XCTest

final class JarvisNavigationModelTests: XCTestCase {
    private var repository: URL {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        return root
    }

    private func source(_ path: String) throws -> String {
        try String(contentsOf: repository.appendingPathComponent("apps/ios/\(path)"), encoding: .utf8)
    }

    func testReferenceModelOwnsOnePublishedNormalizedState() throws {
        let model = try source("Shared/JarvisNavigationModel.swift")
        XCTAssertTrue(model.contains("@MainActor\nfinal class JarvisNavigationModel: ObservableObject"))
        XCTAssertTrue(model.contains("@Published private(set) var state: JarvisNavigationState"))
        XCTAssertTrue(model.contains("var path: [JarvisDestination] { state.path }"))
        XCTAssertTrue(model.contains("var isSidebarOpen: Bool { state.isSidebarOpen }"))
        XCTAssertTrue(model.contains("var currentDestination: JarvisDestination { state.currentDestination }"))
        XCTAssertTrue(model.contains("dismissKeyboard()\n        write(caller: caller) { $0.openSidebar() }"))
        XCTAssertTrue(model.contains("guard path != state.path else { return }"))
        XCTAssertTrue(model.contains("$0.setPath(path)\n            $0.closeSidebar()"))
        XCTAssertTrue(model.contains("$0.navigate(to: destination)"))
        XCTAssertTrue(model.contains("$0.voiceSessionStateChanged(voiceState)"))
        XCTAssertTrue(model.contains("state = JarvisNavigationState()"))
    }

    func testGateOwnsReferenceAboveSignOutIdentityAndKeepsSecurityBoundary() throws {
        let gate = try source("Jarvis/JarvisGateRootView.swift")
        let root = try XCTUnwrap(gate.range(of: "struct JarvisGateRootView: View"))
        let content = String(gate[root.lowerBound...])
        let owner = try XCTUnwrap(content.range(of: "@StateObject private var navigation"))
        let identity = try XCTUnwrap(content.range(of: ".id(model.signOutGeneration)"))
        XCTAssertLessThan(owner.lowerBound, identity.lowerBound)
        XCTAssertTrue(content.contains(".environmentObject(navigation)"))
        XCTAssertTrue(content.contains("#selector(UIResponder.resignFirstResponder)"))
        XCTAssertTrue(content.contains(".allowsHitTesting(!model.shouldCoverContent)"))
        XCTAssertTrue(content.contains(".accessibilityHidden(model.shouldCoverContent)"))
        XCTAssertTrue(content.contains(".onChange(of: model.signOutGeneration) { _, _ in\n                navigation.reset()"))
        XCTAssertTrue(gate.contains("overlay.windowLevel = .alert + 1"))
        XCTAssertTrue(gate.contains("override var canBecomeKey: Bool { false }"))
    }

    func testMenuInvokesInjectedModelWithoutCapturedContentClosure() throws {
        let design = try source("Jarvis/JarvisDesignSystem.swift")
        let start = try XCTUnwrap(design.range(of: "struct JarvisSidebarMenuButton: View"))
        let end = try XCTUnwrap(design.range(of: "enum JarvisDesignTokens"))
        let button = String(design[start.lowerBound..<end.lowerBound])
        XCTAssertTrue(button.contains("@EnvironmentObject private var navigation: JarvisNavigationModel"))
        XCTAssertTrue(button.contains("Button {\n            navigation.openSidebar()\n        } label:"))
        XCTAssertTrue(button.contains(".jarvisToolbarButtonStyle()"))
        XCTAssertFalse(button.contains("let action"))
        for file in ["JarvisChatScreen", "JarvisHealthArea", "JarvisNotesArea", "JarvisFactoryArea"] {
            let screen = try source("Jarvis/\(file).swift")
            XCTAssertTrue(screen.contains("JarvisSidebarMenuButton(language:"))
            XCTAssertFalse(screen.contains("onOpenSidebar"))
        }
        let chat = try source("Jarvis/JarvisChatScreen.swift")
        XCTAssertFalse(chat.contains("ToolbarItemGroup(placement: .topBarTrailing)"))
        XCTAssertTrue(chat.contains("ToolbarSpacer(.fixed, placement: .topBarTrailing)"))
    }

    func testDrawerExistsOnlyWhenOpenWithoutForegroundOrGestureStateTransforms() throws {
        let shell = try source("Jarvis/ContentView.swift")
        XCTAssertTrue(shell.contains("@EnvironmentObject private var navigation: JarvisNavigationModel"))
        XCTAssertTrue(shell.contains("get: { navigation.path }"))
        XCTAssertTrue(shell.contains("navigation.setPath($0)"))
        let sidebar = try source("Jarvis/JarvisSidebar.swift")
        XCTAssertFalse(shell.contains("JarvisSidebar("))
        XCTAssertTrue(sidebar.contains("struct JarvisSidebarDrawerLayer: View"))
        XCTAssertTrue(sidebar.contains("if navigation.isSidebarOpen {\n                    Color.black"))
        XCTAssertTrue(sidebar.contains(".onTapGesture { navigation.closeSidebar() }"))
        XCTAssertTrue(sidebar.contains(".move(edge: .trailing)"))
        XCTAssertTrue(sidebar.contains("reduceMotion ? nil"))
        let gate = try source("Jarvis/JarvisGateRootView.swift")
        XCTAssertTrue(gate.contains("JarvisSidebarDrawerLayer()\n                .zIndex(1)"))
        XCTAssertTrue(shell.contains("transaction.disablesAnimations = true"))
        XCTAssertTrue(shell.contains("guard scenePhase == .active, !navigation.isSidebarOpen"))
        for obsolete in ["@GestureState", "sidebarGestureGeneration", ".simultaneousGesture",
                         ".offset(", ".blur(", ".allowsHitTesting(", "NavigationBisect", "navigationWrites"] {
            XCTAssertFalse(shell.contains(obsolete), obsolete)
        }
        XCTAssertTrue(try source("Jarvis/JarvisSidebar.swift").contains(".accessibilityIdentifier(\"navigation.sidebar\")"))
    }

    func testStandalonePreviewsSupplyTheNavigationEnvironment() throws {
        for file in ["JarvisHealthPreview", "JarvisNotesPreview", "JarvisChatScreen", "JarvisFactoryArea"] {
            let preview = try source("Jarvis/\(file).swift")
            XCTAssertTrue(preview.contains(".environmentObject(JarvisNavigationModel())"), file)
        }
    }

    func testDiagnosticFilesAreRemovedAndRegressionUITestsRemain() throws {
        for path in ["Shared/NavigationBisectVariant.swift", "JarvisUITests/NavigationBisectTests.swift",
                     "Jarvis/JarvisInputHitTestingProbe.swift"] {
            XCTAssertFalse(FileManager.default.fileExists(
                atPath: repository.appendingPathComponent("apps/ios/\(path)").path
            ))
        }
        let tests = try source("JarvisUITests/SidebarNavigationTests.swift")
        XCTAssertTrue(tests.contains("timeout: 2"))
        XCTAssertTrue(tests.contains("sidebar.exists && sidebar.isHittable"))
        XCTAssertTrue(tests.contains("self.app.buttons[\"navigation.chat\"].isHittable"))
        XCTAssertTrue(tests.contains("menu.coordinate(withNormalizedOffset:"))
        let regression = try source("JarvisUITests/NavigationReliabilityTests.swift")
        for name in ["testRepeatedNavigationInDanish", "testRepeatedNavigationInEnglish",
                     "testShortDragAndBackgroundInterruptionRecover",
                     "testMenuRemainsHittableFiveSecondsAfterLaunchInDanish",
                     "testMenuRemainsHittableFiveSecondsAfterLaunchInEnglish"] {
            XCTAssertTrue(regression.contains("func \(name)()"))
        }
    }

    func testWrappedStatePreservesPathVoiceAndSignOutContracts() {
        var state = JarvisNavigationState()
        state.setPath([.chat, .health, .health, .notes, .banking])
        XCTAssertEqual(state.path, [.health, .notes])
        XCTAssertEqual(state.currentDestination, .notes)
        state.openSidebar()
        state.navigate(to: .health)
        XCTAssertEqual(state.path, [.health])
        XCTAssertFalse(state.isSidebarOpen)
        state.navigate(to: .voice)
        state.openSidebar()
        state.voiceSessionStateChanged(.ended)
        XCTAssertEqual(state.currentDestination, .chat)
        XCTAssertTrue(state.path.isEmpty)
        XCTAssertFalse(state.isSidebarOpen)
        state.navigate(to: .softwareFactory)
        state.openSidebar()
        state = JarvisNavigationState()
        XCTAssertEqual(state.currentDestination, .chat)
        XCTAssertTrue(state.path.isEmpty)
        XCTAssertFalse(state.isSidebarOpen)
    }
}
