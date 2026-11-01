import Foundation
import XCTest

final class NativeChatLayoutTests: XCTestCase {
    private var repository: URL {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        return root
    }

    private func source(_ path: String) throws -> String {
        try String(contentsOf: repository.appendingPathComponent(path), encoding: .utf8)
    }

    private func section(_ pattern: String, in text: String) throws -> String {
        let regex = try NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators])
        let match = try XCTUnwrap(regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)))
        let range = try XCTUnwrap(Range(match.range(at: 1), in: text))
        return String(text[range])
    }

    func testComposerUsesBoardOrderAndTransparentGlassSurfaces() throws {
        let screen = try source("apps/ios/Jarvis/JarvisChatScreen.swift")
        let composer = try section(
            #"private var composer: some View \{(.*?)(?=\n    private var plusMenu)"#,
            in: screen
        )
        let input = try XCTUnwrap(composer.range(of: #"TextField\("Ask Jarvis""#, options: .regularExpression))
        let firstAction = try XCTUnwrap(composer.range(of: #"Image\(systemName: "plus"\)"#, options: .regularExpression))
        XCTAssertLessThan(input.lowerBound, firstAction.lowerBound)
        XCTAssertTrue(composer.contains(".frame(width: 36, height: 36)"))
        XCTAssertTrue(composer.contains(".frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)"))
        XCTAssertTrue(composer.contains(".glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatComposerRadius))"))
        XCTAssertTrue(composer.contains(#"Image(systemName: dictation.isRecording ? "stop.fill" : "mic")"#))
        XCTAssertTrue(composer.contains("if hasDraftContent"))
        XCTAssertTrue(composer.contains("NavigationLink(value: JarvisDestination.voice)"))
        XCTAssertFalse(composer.contains("onNavigate(.voice)"))
        XCTAssertTrue(composer.contains(#"accessibilityIdentifier("chat.voiceOrSend")"#))
        XCTAssertFalse(composer.contains("Picker("))
        XCTAssertFalse(screen.contains(".background(.bar)"))

        let nowBar = try section(
            #"(private var nowBar: some View \{.*?)(?=\n    private func timeString)"#,
            in: screen
        )
        XCTAssertTrue(nowBar.contains(".glassEffect(.regular, in: .capsule)"))

        let messageBubble = try section(
            #"(private func messageBubble.*?)(?=\n    private var composer)"#,
            in: screen
        )
        let elseStart = try XCTUnwrap(messageBubble.range(of: "} else {"))
        XCTAssertTrue(messageBubble[..<elseStart.lowerBound].contains(".glassEffect("))
        XCTAssertFalse(messageBubble[elseStart.upperBound...].contains(".glassEffect("))
    }

    func testHeaderIsClearAndMessagesFadeAtTheTop() throws {
        let screen = try source("apps/ios/Jarvis/JarvisChatScreen.swift")
        XCTAssertTrue(screen.contains(".toolbarBackground(.hidden, for: .navigationBar)"))
        XCTAssertTrue(screen.contains(".scrollEdgeEffectStyle(.soft, for: .top)"))
    }

    func testSidebarInteractionsDoNotInterceptChatActions() throws {
        let contentView = try source("apps/ios/Jarvis/ContentView.swift")
        let dimmingLayer = try section(
            #"(private struct SidebarDimmingLayer: View \{.*?)(?=\nprivate struct SidebarDismissGestureLayer)"#,
            in: contentView
        )
        XCTAssertTrue(dimmingLayer.contains(".allowsHitTesting(false)"))

        let foregroundLayer = try section(
            #"(private struct ContentForegroundLayer<.*?)(?=\nprivate struct SidebarDimmingLayer)"#,
            in: contentView
        )
        XCTAssertFalse(foregroundLayer.contains(".simultaneousGesture("))

        let edgeGestureLayer = try section(
            #"(private struct SidebarEdgeGestureLayer<.*?)(?=\nprivate struct SidebarDrag)"#,
            in: contentView
        )
        XCTAssertTrue(edgeGestureLayer.contains(".gesture(gesture)"))
        XCTAssertTrue(edgeGestureLayer.contains("let edgeWidth: CGFloat = JarvisDesignTokens.sidebarEdgeGestureWidth"))
        let designSystem = try source("apps/ios/Jarvis/JarvisDesignSystem.swift")
        XCTAssertTrue(designSystem.contains("static let sidebarEdgeGestureWidth: CGFloat = 24"))
    }

    func testContentViewUsesSmallTypedViewComponents() throws {
        let contentView = try source("apps/ios/Jarvis/ContentView.swift")
        let body = try section(
            #"var body: some View \{(.*?)(?=\n    private func rootLayout)"#,
            in: contentView
        )
        XCTAssertTrue(body.contains("GeometryReader { (geometry: GeometryProxy) in"))
        XCTAssertFalse(body.contains("ZStack("))
        XCTAssertFalse(body.contains("NavigationStack("))

        let rootLayout = try section(
            #"(private func rootLayout\(in geometry: GeometryProxy\) -> some View \{.*?)(?=\n    private func sidebarProgress)"#,
            in: contentView
        )
        XCTAssertTrue(rootLayout.contains("let screenSize: CGSize = geometry.size"))
        XCTAssertTrue(rootLayout.contains("let drawerWidth: CGFloat = min(requestedDrawerWidth, maximumDrawerWidth)"))
        XCTAssertTrue(rootLayout.contains("let dimmingOpacity: CGFloat = progress * JarvisDesignTokens.screenDimOpacity"))
        XCTAssertTrue(contentView.contains("private struct ContentNavigationSurface: View"))
        XCTAssertTrue(contentView.contains("private struct ContentSidebarLayout<"))
        XCTAssertTrue(contentView.contains("private struct ContentForegroundLayer<"))
    }

    func testVoiceStateChangeIsFactoredOutOfNavigationViewBuilder() throws {
        let contentView = try source("apps/ios/Jarvis/ContentView.swift")
        XCTAssertTrue(contentView.contains("onVoiceStateChange(voiceState)"))
        XCTAssertTrue(contentView.contains("onVoiceStateChange: handleVoiceStateChange"))
        XCTAssertTrue(contentView.contains("private func handleVoiceStateChange(_ state: VoiceSessionState)"))
        XCTAssertTrue(contentView.contains("let endedState: VoiceSessionState = .ended"))
        XCTAssertTrue(contentView.contains("let shouldCloseSidebar: Bool = state == endedState"))
    }

    func testWorkspaceSheetBindingUsesExplicitTypedAccessors() throws {
        let contentView = try source("apps/ios/Jarvis/ContentView.swift")
        XCTAssertTrue(contentView.contains("Binding<PresentedWorkspaceView?>("))
        XCTAssertTrue(contentView.contains("get: workspaceRuntimePresentedView"))
        XCTAssertTrue(contentView.contains("set: setPresentedWorkspaceView"))
        XCTAssertTrue(contentView.contains("presentedView: presentedWorkspaceViewBinding"))
        XCTAssertTrue(contentView.contains(".sheet(item: presentedView)"))
        XCTAssertTrue(contentView.contains("(presented: PresentedWorkspaceView)"))
        XCTAssertFalse(contentView.contains("set: { if $0 == nil"))
    }

    func testSimulatorArtifactContainsBaseAndUpdatedChatCaptures() throws {
        let workflow = try source(".github/workflows/ios-ci.yml")
        XCTAssertTrue(workflow.contains(#"git show "$BASE_SHA:apps/ios/Jarvis/JarvisChatScreen.swift""#))
        XCTAssertTrue(workflow.contains(#"chat-before-${appearance}.png"#))
        XCTAssertTrue(workflow.contains("Chat before and after"))
        XCTAssertTrue(workflow.contains("Missing before/after simulator capture:"))
        XCTAssertTrue(workflow.contains("-only-testing:JarvisUITests/ChatComposerVoiceUITests"))
        let project = try source("apps/ios/project.yml")
        XCTAssertTrue(project.contains("type: bundle.ui-testing"))
        let uiTests = try source("apps/ios/JarvisUITests/ChatComposerVoiceUITests.swift")
        XCTAssertTrue(uiTests.contains("testVoiceActionOpensVoiceScreen"))
        XCTAssertTrue(uiTests.contains("testVoiceActionBecomesSendForNonemptyDraft"))
    }
}
