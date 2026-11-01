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
        XCTAssertTrue(model.contains("dismissKeyboard()\n        writeSidebar(caller: caller, requested: true)"))
        XCTAssertTrue(model.contains("let update = JarvisNavigationPathUpdate(path: path, from: state)"))
        XCTAssertTrue(model.contains("writeSidebar(caller: caller, requested: false) { $0 = update.state }"))
        XCTAssertTrue(model.contains("{ $0.navigate(to: destination) }"))
        XCTAssertTrue(model.contains("{ $0.voiceSessionStateChanged(voiceState) }"))
        XCTAssertTrue(model.contains("{ $0 = JarvisNavigationState() }"))
        XCTAssertTrue(model.contains("sidebarDiagnostics.record(caller: caller, requested: requested, before: before, after: isSidebarOpen)"))
        XCTAssertTrue(model.contains("if next != state { state = next }"))
        XCTAssertTrue(model.contains("voiceState == .ended ? .voiceEnded : .voiceState"))
        XCTAssertFalse(model.contains("caller: String"))
        XCTAssertFalse(model.contains("recentSidebarWrites"))
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
        XCTAssertTrue(content.contains("navigation.reset(caller: .gateSignOut)"))
        XCTAssertTrue(content.contains("if covered { navigation.closeSidebar(caller: .gateCover) }"))
        XCTAssertTrue(gate.contains("overlay.windowLevel = .alert + 1"))
        XCTAssertTrue(gate.contains("override var canBecomeKey: Bool { false }"))
    }

    func testMenuInvokesInjectedModelWithoutCapturedContentClosure() throws {
        let design = try source("Jarvis/JarvisDesignSystem.swift")
        let start = try XCTUnwrap(design.range(of: "struct JarvisSidebarMenuButton: View"))
        let end = try XCTUnwrap(design.range(of: "enum JarvisDesignTokens"))
        let button = String(design[start.lowerBound..<end.lowerBound])
        XCTAssertTrue(button.contains("@EnvironmentObject private var navigation: JarvisNavigationModel"))
        XCTAssertTrue(button.contains("Button {\n            navigation.openSidebar(caller: .menu)\n        } label:"))
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
        XCTAssertTrue(shell.contains("navigation.setPath($0, caller: .pathBinding)"))
        XCTAssertFalse(shell.contains("JarvisSidebar("))
        XCTAssertFalse(shell.contains("screenDimOpacity"))
        XCTAssertTrue(shell.contains("transaction.disablesAnimations = true"))
        XCTAssertTrue(shell.contains("navigation.closeSidebar(caller: .scenePhase)"))
        XCTAssertTrue(shell.contains("guard scenePhase == .active, !navigation.isSidebarOpen"))
        for obsolete in ["@GestureState", "sidebarGestureGeneration", ".simultaneousGesture",
                         ".offset(", ".blur(", ".allowsHitTesting(", "NavigationBisect", "navigationWrites"] {
            XCTAssertFalse(shell.contains(obsolete), obsolete)
        }
        XCTAssertTrue(try source("Jarvis/JarvisSidebar.swift").contains(".accessibilityIdentifier(\"navigation.sidebar\")"))
    }

    func testLastRootChildOwnsDrawerAndLiveReleaseBadgeOutsideContentModifiers() throws {
        let gate = try source("Jarvis/JarvisGateRootView.swift")
        let root = String(gate[try XCTUnwrap(gate.range(of: "struct JarvisGateRootView: View")).lowerBound...])
        let drawer = try XCTUnwrap(root.range(of: "ZStack(alignment: .trailing)"))
        let hitTesting = try XCTUnwrap(root.range(of: ".allowsHitTesting(!model.shouldCoverContent)"))
        let identity = try XCTUnwrap(root.range(of: ".id(model.signOutGeneration)"))
        XCTAssertLessThan(hitTesting.lowerBound, drawer.lowerBound)
        XCTAssertLessThan(identity.lowerBound, drawer.lowerBound)
        XCTAssertTrue(root.contains("if navigation.isSidebarOpen && !model.shouldCoverContent"))
        XCTAssertEqual(root.components(separatedBy: "JarvisSidebar(").count - 1, 1)
        XCTAssertEqual(root.components(separatedBy: "JarvisSidebarDebugBadge(navigation: navigation)").count - 1, 1)
        XCTAssertFalse(root.contains("JarvisNavigationDebugBadge"))
        XCTAssertFalse(try source("Jarvis/JarvisSidebar.swift").contains("JarvisSidebarDrawerLayer"))
        XCTAssertTrue(root.contains(".zIndex(1000)\n        }"))
        XCTAssertTrue(root.contains("ContentView.keyWindow?.bounds.size ?? UIScreen.main.bounds.size"))
        XCTAssertTrue(root.contains("ContentView.resolvedSafeAreaInsets(fallback: EdgeInsets())"))
        XCTAssertTrue(root.contains("@AppStorage(\"jarvis.appTheme\") private var storedTheme"))
        XCTAssertTrue(root.contains(".preferredColorScheme(storedTheme == \"light\" ? .light : storedTheme == \"dark\" ? .dark : nil)"))
        XCTAssertTrue(root.contains(".onGeometryChange(for: CGSize.self)"))
        XCTAssertTrue(root.contains("drawerWindowSize = ContentView.keyWindow?.bounds.size ?? UIScreen.main.bounds.size"))
        XCTAssertLessThan(
            try XCTUnwrap(root.range(of: ".padding(.bottom, drawerSafeAreaInsets.bottom + 96)")).lowerBound,
            try XCTUnwrap(root.range(of: ".zIndex(1)")).lowerBound
        )
        XCTAssertFalse(root.components(separatedBy: "private struct JarvisGateOverlayView").first!.contains("GeometryReader"))
        XCTAssertTrue(root.contains("onNavigate: { navigation.navigate(to: $0, caller: .rootDrawer) }"))
        XCTAssertTrue(root.contains(".onTapGesture { navigation.closeSidebar(caller: .rootDrawer) }"))
        XCTAssertTrue(root.contains(".transition(reduceMotion ? .opacity : .move(edge: .trailing))"))
        XCTAssertTrue(root.contains("reduceMotion ? nil"))
        let badge = String(root[try XCTUnwrap(root.range(of: "private struct JarvisSidebarDebugBadge")).lowerBound...])
        XCTAssertTrue(badge.contains("@ObservedObject var navigation: JarvisNavigationModel"))
        XCTAssertTrue(badge.contains("navigation.sidebarDiagnostics.badgeText(isSidebarOpen: navigation.isSidebarOpen)"))
        XCTAssertTrue(badge.contains(".allowsHitTesting(false)"))
        XCTAssertTrue(badge.contains(".accessibilityHidden(!Self.exposesTestValue)"))
        XCTAssertTrue(root.contains("JarvisSidebarDebugBadge(navigation: navigation)"))
    }

    func testRootDrawerNavigationDeliversContentOwnedVoiceAndFixtureEffectsBeforeRouteWrite() throws {
        let model = try source("Shared/JarvisNavigationModel.swift")
        XCTAssertTrue(model.contains("let navigationRequested = PassthroughSubject<(from: JarvisDestination, to: JarvisDestination), Never>()"))
        XCTAssertFalse(model.contains("guard destination != currentDestination"))
        XCTAssertLessThan(try XCTUnwrap(model.range(of: "navigationRequested.send")).lowerBound,
                          try XCTUnwrap(model.range(of: "writeSidebar(caller: caller, requested: false) { $0.navigate")).lowerBound)
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

    func testTemporaryTraceKeepsExactlyLastThreeRequestsIncludingNoOps() {
        var trace = JarvisSidebarDiagnostics()
        trace.record(caller: .menu, requested: true, before: false, after: true)
        trace.record(caller: .pathBinding, requested: false, before: true, after: true)
        trace.record(caller: .scenePhase, requested: false, before: true, after: false)
        trace.record(caller: .gateCover, requested: false, before: false, after: false)
        XCTAssertEqual(trace.writes.count, 3)
        XCTAssertEqual(trace.writes.map(\.caller), [.pathBinding, .scenePhase, .gateCover])
        XCTAssertEqual(trace.writes.map(\.requested), [false, false, false])
        XCTAssertEqual(trace.writes.map(\.before), [true, true, false])
        XCTAssertEqual(trace.writes.map(\.after), [true, false, false])
        XCTAssertEqual(trace.buttonTapCount, 1)
        let badge = trace.badgeText(isSidebarOpen: false)
        XCTAssertTrue(badge.contains("isSidebarOpen=false taps=1 last=gateCover"))
        XCTAssertTrue(badge.contains("gateCover req=false false→false"))
        XCTAssertFalse(badge.contains("menu req"))
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
                          try XCTUnwrap(setter.range(of: "writeSidebar(")).lowerBound)
    }

    func testEquivalentNormalizedBackPathsKeepOpenDrawerAndEmitNoEvent() {
        var previous = JarvisNavigationState()
        previous.navigate(to: .voice)
        previous.openSidebar()
        for path: [JarvisDestination] in [[.voice], [.chat, .voice, .voice, .banking]] {
            let update = JarvisNavigationPathUpdate(path: path, from: previous)
            XCTAssertEqual(update.state, previous)
            XCTAssertNil(update.navigationRequest)
            var trace = JarvisSidebarDiagnostics()
            trace.record(caller: .pathBinding, requested: false,
                         before: previous.isSidebarOpen, after: update.state.isSidebarOpen)
            XCTAssertEqual(trace.writes.count, 1)
            XCTAssertEqual(trace.writes.first?.caller, .pathBinding)
            XCTAssertEqual(trace.writes.first?.before, true)
            XCTAssertEqual(trace.writes.first?.after, true)
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

    func testTemporaryTraceCountsOnlyActualMenuRequestsAndSurvivesResetWrites() {
        var trace = JarvisSidebarDiagnostics()
        for caller in [JarvisSidebarWriter.edge, .contentAccessibility, .sidebarAccessibility, .voiceEnded, .gateSignOut] {
            trace.record(caller: caller, requested: false, before: false, after: false)
        }
        XCTAssertEqual(trace.buttonTapCount, 0)
        trace.record(caller: .menu, requested: true, before: false, after: true)
        trace.record(caller: .menu, requested: true, before: true, after: true)
        trace.record(caller: .gateSignOut, requested: false, before: true, after: false)
        XCTAssertEqual(trace.buttonTapCount, 2)
        XCTAssertEqual(trace.writes.count, 3)
        XCTAssertEqual(trace.writes[1].caller, .menu)
        XCTAssertEqual(trace.writes[1].before, trace.writes[1].after)
        XCTAssertTrue(trace.badgeText(isSidebarOpen: true).contains("isSidebarOpen=true"))
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
