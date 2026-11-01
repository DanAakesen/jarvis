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
        XCTAssertTrue(model.contains("dismissKeyboard()\n        write(\"openSidebar\") { $0.openSidebar() }"))
        XCTAssertTrue(model.contains("guard path != state.path else {"))
        XCTAssertTrue(model.contains("let update = JarvisNavigationPathUpdate(path: path, from: state)"))
        XCTAssertTrue(model.contains("{ $0 = update.state }"))
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
        XCTAssertTrue(content.contains(".onChange(of: model.signOutGeneration) { _, _ in\n            navigation.reset()"))
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
        XCTAssertTrue(shell.contains("destinationView(navigation.currentDestination)"))
        XCTAssertFalse(shell.contains("path: Binding"))
        let sidebar = try source("Jarvis/JarvisSidebar.swift")
        XCTAssertFalse(shell.contains("JarvisSidebar("))
        XCTAssertTrue(sidebar.contains("struct JarvisSidebarReveal<Page: View>: View"))
        XCTAssertTrue(sidebar.contains("if progress > 0 {\n                    JarvisSidebar("))
        XCTAssertTrue(sidebar.contains(".offset(x: -drawerWidth * progress)"))
        XCTAssertTrue(sidebar.contains(".allowsHitTesting(progress == 0)"))
        XCTAssertTrue(sidebar.contains(".onTapGesture { navigation.closeSidebar() }"))
        XCTAssertTrue(sidebar.contains("reduceMotion || navigation.dragProgress != nil ? nil"))
        let gate = try source("Jarvis/JarvisGateRootView.swift")
        XCTAssertTrue(gate.contains("JarvisSidebarReveal(isEnabled: !model.shouldCoverContent) {"))
        XCTAssertTrue(shell.contains("transaction.disablesAnimations = true"))
        for obsolete in ["@GestureState", "sidebarGestureGeneration", ".simultaneousGesture",
                         ".offset(", ".blur(", ".allowsHitTesting(", "NavigationBisect", "navigationWrites"] {
            XCTAssertFalse(shell.contains(obsolete), obsolete)
        }
        XCTAssertTrue(try source("Jarvis/JarvisSidebar.swift").contains(".accessibilityIdentifier(\"navigation.sidebar\")"))
    }

    func testRootDrawerNavigationDeliversContentOwnedVoiceAndFixtureEffectsBeforeRouteWrite() throws {
        let model = try source("Shared/JarvisNavigationModel.swift")
        XCTAssertTrue(model.contains("let navigationRequested = PassthroughSubject<(from: JarvisDestination, to: JarvisDestination), Never>()"))
        XCTAssertFalse(model.contains("guard destination != currentDestination"))
        XCTAssertLessThan(try XCTUnwrap(model.range(of: "navigationRequested.send")).lowerBound,
                          try XCTUnwrap(model.range(of: "write(\"navigate(")).lowerBound)
        let content = try source("Jarvis/ContentView.swift")
        XCTAssertTrue(content.contains(".onReceive(navigation.navigationRequested) { request in\n            prepareNavigation(to: request.to, from: request.from)"))
        XCTAssertFalse(content.contains(".onChange(of: navigation.currentDestination)"))
        XCTAssertTrue(content.contains("voiceModel.restore()"))
        XCTAssertTrue(content.contains("if destination == .voice {\n            voiceModel.restore()"))
        XCTAssertTrue(content.contains("previous == .voice && voiceModel.isSessionActive"))
        XCTAssertTrue(content.contains("voiceModel.minimize()"))
        XCTAssertTrue(content.contains("if navigationFixtureMode"))
        XCTAssertTrue(content.contains("workspaceRuntime.resetSession()"))
        XCTAssertTrue(content.contains("await voiceModel.end(returnToChat: false)"))
    }

    func testBackPathEmitsVoiceRestoreDestinationBeforeModelWrite() throws {
        var previous = JarvisNavigationState()
        previous.navigate(to: .voice)
        previous.navigate(to: .status)
        previous.openSidebar()
        let update = JarvisNavigationPathUpdate(path: [.voice], from: previous)
        let request = try XCTUnwrap(update.navigationRequest)
        XCTAssertEqual(request.from, .status)
        XCTAssertEqual(request.to, .voice)
        XCTAssertEqual(previous.currentDestination, .status)
        XCTAssertTrue(previous.isSidebarOpen)
        XCTAssertEqual(update.state.currentDestination, .voice)
        XCTAssertFalse(update.state.isSidebarOpen)

        let model = try source("Shared/JarvisNavigationModel.swift")
        let setter = try XCTUnwrap(model.components(separatedBy: "func setPath(").last?
            .components(separatedBy: "func navigate(").first)
        XCTAssertTrue(setter.contains("JarvisNavigationPathUpdate(path: path, from: state)"))
        XCTAssertTrue(setter.contains("if let request = update.navigationRequest"))
        XCTAssertLessThan(try XCTUnwrap(setter.range(of: "navigationRequested.send(request)")).lowerBound,
                          try XCTUnwrap(setter.range(of: "write(\"setPath(binding)")).lowerBound)
    }

    func testEquivalentNormalizedBackPathsKeepOpenDrawerAndEmitNoEvent() {
        var previous = JarvisNavigationState()
        previous.navigate(to: .voice)
        previous.openSidebar()
        for path: [JarvisDestination] in [[.voice], [.chat, .voice, .voice, .banking]] {
            let update = JarvisNavigationPathUpdate(path: path, from: previous)
            XCTAssertEqual(update.state, previous)
            XCTAssertNil(update.navigationRequest)
        }
    }

    func testPathChangesWithSameDestinationDoNotRepeatVoiceEffects() {
        var previous = JarvisNavigationState()
        previous.navigate(to: .notes)
        previous.navigate(to: .voice)
        previous.openSidebar()
        let update = JarvisNavigationPathUpdate(path: [.voice], from: previous)
        XCTAssertEqual(update.state.path, [.voice])
        XCTAssertFalse(update.state.isSidebarOpen)
        XCTAssertNil(update.navigationRequest)
    }

    func testRevealOwnsDrawerOutsidePageGatingAndIsInertWhileCovered() throws {
        let gate = try source("Jarvis/JarvisGateRootView.swift")
        let root = String(gate[try XCTUnwrap(gate.range(of: "struct JarvisGateRootView: View")).lowerBound...])
        let reveal = try XCTUnwrap(root.range(of: "JarvisSidebarReveal(isEnabled: !model.shouldCoverContent) {"))
        let hitTesting = try XCTUnwrap(root.range(of: ".allowsHitTesting(!model.shouldCoverContent)"))
        let environment = try XCTUnwrap(root.range(of: ".environmentObject(navigation)"))
        XCTAssertLessThan(reveal.lowerBound, hitTesting.lowerBound)
        XCTAssertLessThan(hitTesting.lowerBound, environment.lowerBound)
        XCTAssertFalse(root.contains("JarvisSidebar("))
        XCTAssertTrue(root.contains("@AppStorage(\"jarvis.appTheme\") private var storedTheme"))
        XCTAssertTrue(root.contains(".preferredColorScheme(storedTheme == \"light\" ? .light : storedTheme == \"dark\" ? .dark : nil)"))
        XCTAssertFalse(gate.contains("JarvisSidebarDebugBadge"))
        let sidebar = try source("Jarvis/JarvisSidebar.swift")
        XCTAssertTrue(sidebar.contains("let progress = isEnabled ? CGFloat(navigation.revealProgress) : 0"))
        XCTAssertTrue(sidebar.contains("if isEnabled && (progress == 0 || isDraggingOpen) {"))
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
        XCTAssertTrue(tests.contains("sidebar.exists && !sidebar.frame.isEmpty"))
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
