import Foundation
import XCTest

final class JarvisAmbientBackgroundTests: XCTestCase {
    private var repository: URL {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        return root
    }

    private func source(_ path: String) throws -> String {
        try String(contentsOf: repository.appendingPathComponent(path), encoding: .utf8)
    }

    private func matches(_ pattern: String, in text: String) throws -> [[String]] {
        let regex = try NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators])
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { match in
            (1..<match.numberOfRanges).map {
                Range(match.range(at: $0), in: text).map { String(text[$0]) } ?? ""
            }
        }
    }

    func testSharedGateRendererKeepsMainPaletteAndGlowPositions() throws {
        let design = try source("apps/ios/Jarvis/JarvisDesignSystem.swift")
        let geometry = try matches(
            #"JarvisDesignTokens\.ambient(\w+),\s+opacity: colorScheme == \.dark \? ([0-9.]+) : ([0-9.]+),\s+size: size,\s+x: ([0-9.]+),\s+y: ([0-9.]+)"#,
            in: design
        )
        XCTAssertEqual(geometry.count, 4)
        XCTAssertTrue(design.contains("struct JarvisScreenBackground: View"))
        XCTAssertTrue(design.contains("endRadius: max(size.width * 0.6, size.height * 0.36)"))
        XCTAssertTrue(design.contains("colors: [color.opacity(opacity), color.opacity(opacity * 0.3), .clear]"))

        for board in ["board.html", "surfaces.html"] {
            let html = try source("docs/ios/design/\(board)")
            let glows = try matches(
                #"radial-gradient\((\d+)% (\d+)% at (\d+)% (\d+)%, rgb\((\d+) (\d+) (\d+) / (\d+)%\), transparent (\d+)%\)"#,
                in: html
            )
            XCTAssertEqual(glows.count, 8, board)
            guard glows.count == 8 else { continue }
            for (index, name) in ["Cool", "Warm", "Green", "Blue"].enumerated() {
                let glow = try XCTUnwrap(geometry.first { $0[0] == name })
                let palette = try XCTUnwrap(matches(
                    #"static let ambient"# + name + #" = adaptiveColor\((.*?)\n    \)"#,
                    in: design
                ).first?.first)
                let components = try matches(
                    #"UIColor\(red: ([0-9.]+(?: / 255)?), green: ([0-9.]+(?: / 255)?), blue: ([0-9.]+(?: / 255)?), alpha: 1\)"#,
                    in: palette
                )
                XCTAssertEqual(components.count, 2)
                guard components.count == 2 else { continue }
                for theme in 0..<2 {
                    let reference = glows[index + theme * 4]
                    for component in 0..<3 {
                        let expression = components[theme][component].components(separatedBy: " / ")
                        let numerator = try XCTUnwrap(Double(expression[0]))
                        let value = expression.count == 2 ? numerator / 255 : numerator
                        XCTAssertEqual(value, Double(reference[component + 4])! / 255, accuracy: 0.0001)
                    }
                    for (actual, expected) in [(glow[3], reference[2]), (glow[4], reference[3]),
                                               (glow[theme == 0 ? 2 : 1], reference[7])] {
                        XCTAssertEqual(Double(actual)!, Double(expected)! / 100, accuracy: 0.0001)
                    }
                }
            }
        }
    }

    func testEveryNativeScreenAndSheetUsesSharedBackground() throws {
        let screens: [String: [String]] = [
            "ContentView.swift": ["JarvisPlaceholderView"],
            "JarvisChatScreen.swift": ["JarvisChatScreen"],
            "VoiceScreen.swift": ["VoiceScreenView", "VoicePhotoViewfinder", "VoiceScreenSharePicker"],
            "JarvisActivitySheet.swift": ["JarvisActivitySheet"],
            "WorkspacesView.swift": ["WorkspacesView"],
            "GeneratedWorkspaceView.swift": ["GeneratedWorkspaceSheet"],
            "JarvisNotesArea.swift": ["JarvisNotesArea"],
            "JarvisNoteEditorView.swift": ["JarvisNoteEditorView"],
            "JarvisNotesCreationSheets.swift": ["JarvisNewNoteSheet", "JarvisNewTaskSheet"],
            "JarvisHealthArea.swift": ["JarvisHealthArea"],
            "JarvisHealthDetailView.swift": ["JarvisHealthDetailView"],
            "JarvisFactoryArea.swift": ["JarvisFactoryArea"],
            "JarvisFactoryTaskDetailView.swift": ["JarvisFactoryTaskDetailView", "JarvisFactorySteerSheet"],
            "JarvisFactoryNewTaskSheet.swift": ["JarvisFactoryNewTaskSheet"],
            "JarvisFactoryReleaseViews.swift": ["JarvisFactoryReleaseDetailView"],
            "JarvisSettingsArea.swift": ["JarvisSettingsArea"],
            "JarvisSettingsEditorView.swift": ["JarvisSettingsEditorView", "JarvisSettingsLanguageView"],
            "JarvisSettingsResourceViews.swift": [
                "JarvisProactiveSettingsView", "JarvisRoutinesSettingsView", "JarvisMemorySettingsView",
                "JarvisMemoryEditorView", "JarvisTargetsSettingsView", "JarvisHealthCredentialView",
                "JarvisOwnerSettingsView", "JarvisCredentialsSettingsView",
            ],
            "JarvisSettingsDeploymentViews.swift": ["JarvisDeploymentsSettingsView", "JarvisNewDeploymentView"],
            "JarvisGateRootView.swift": ["JarvisGateSurface"],
        ]
        for (file, names) in screens {
            let text = try source("apps/ios/Jarvis/\(file)")
            for name in names {
                let section = try XCTUnwrap(matches(
                    #"struct "# + name + #": View \{(.*?)(?=\n(?:private )?struct |\z)"#,
                    in: text
                ).first?.first, name)
                XCTAssertTrue(
                    section.contains(".jarvisAmbientBackground()") ||
                    section.contains("JarvisScreenBackground(") ||
                    section.contains("JarvisGateAmbientBackground(") ||
                    section.contains("JarvisForm {"),
                    "\(name) must use the shared background"
                )
            }
        }
        let shell = try source("apps/ios/Jarvis/ContentView.swift")
        let sidebar = try source("apps/ios/Jarvis/JarvisSidebar.swift")
        XCTAssertTrue(shell.contains(".background { JarvisScreenBackground() }"))
        XCTAssertTrue(sidebar.contains(".background(JarvisGlassSurface())"))
    }

    func testNoScreenReintroducesOpaqueSystemBackgroundsOrPrivateAmbientCopies() throws {
        let directory = repository.appendingPathComponent("apps/ios/Jarvis")
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "swift" }
        var definitions = 0
        for file in files {
            let text = try String(contentsOf: file, encoding: .utf8)
            definitions += text.components(separatedBy: "struct JarvisScreenBackground: View").count - 1
            XCTAssertFalse(text.contains("struct JarvisAmbientBackground: View"), file.lastPathComponent)
            if file.lastPathComponent != "JarvisLockScreenTasksPreview.swift" {
                XCTAssertFalse(text.contains(".systemBackground"), file.lastPathComponent)
            }
            XCTAssertFalse(text.contains(".secondarySystemBackground"), file.lastPathComponent)
            XCTAssertFalse(text.contains("Color.black.ignoresSafeArea()"), file.lastPathComponent)
            if file.lastPathComponent != "JarvisDesignSystem.swift" {
                XCTAssertTrue(try matches(#"(?:^|\n)\s*(?:List|Form) \{"#, in: text).isEmpty,
                              "\(file.lastPathComponent) must use shared glass rows")
            }
        }
        XCTAssertEqual(definitions, 1)
    }

    func testMainVoiceOrbAndGateWrapperRemainUnchanged() throws {
        let design = try source("apps/ios/Jarvis/JarvisDesignSystem.swift")
        XCTAssertTrue(design.contains(".allowsHitTesting(false)"))
        XCTAssertTrue(design.contains(".accessibilityHidden(true)"))
        XCTAssertTrue(design.contains("@Environment(\\.accessibilityReduceTransparency)"))
        XCTAssertTrue(design.contains("content.listRowBackground(JarvisGlassSurface())"))
        let voice = try source("apps/ios/Jarvis/VoiceScreen.swift")
        XCTAssertTrue(voice.contains("JarvisScreenBackground()"))
        XCTAssertTrue(voice.contains("VoiceOrbView("))
        XCTAssertTrue(voice.contains("status: model.statusText"))
        XCTAssertTrue(voice.contains("isMuted: model.isMuted"))
        XCTAssertTrue(voice.contains("@State private var captionsHidden = false"))
        let gate = try source("apps/ios/Jarvis/JarvisGateRootView.swift")
        XCTAssertTrue(gate.contains("private struct JarvisGateAmbientBackground: View"))
        XCTAssertTrue(gate.contains("JarvisScreenBackground()"))
        XCTAssertTrue(gate.contains("JarvisDesignTokens.pageBackground"))
        XCTAssertTrue(voice.contains("if !fixtureMode, model.voiceState.canStartSession"))
        XCTAssertTrue(voice.contains(".disabled(fixtureMode)"))
    }

    func testScreenshotHookPairsEveryRequiredScreenInBothAppearances() throws {
        let workflow = try source(".github/workflows/ios-ci.yml")
        XCTAssertTrue(workflow.contains(#"for screen in chat voice notifications settings notes health sidebar;"#))
        XCTAssertTrue(workflow.contains(#"for appearance in light dark;"#))
        XCTAssertTrue(workflow.contains(#"("chat", "voice", "notifications", "factory", "settings", "notes", "health", "sidebar")"#))
        XCTAssertTrue(workflow.contains("comparisons.html"))
        XCTAssertTrue(workflow.contains("Missing simulator capture:"))
        XCTAssertTrue(workflow.contains("ios-screenshots/board"))
        XCTAssertTrue(workflow.contains("--screenshot-chat-plus-menu"))
        XCTAssertTrue(workflow.contains("chat-plus-menu-light.png"))
        XCTAssertEqual(workflow.components(separatedBy: #"xcrun simctl boot "$DEVICE_ID""#).count - 1, 1)
        let shell = try source("apps/ios/Jarvis/ContentView.swift")
        XCTAssertTrue(shell.contains("if fixtureMode,"))
        XCTAssertTrue(shell.contains("JarvisNotesPreview.makeClient()"))
        XCTAssertTrue(shell.contains("JarvisHealthPreview.makeClient()"))
        XCTAssertTrue(shell.contains("fixtureMode ? JarvisHealthPreview.now : Date()"))
    }
}
