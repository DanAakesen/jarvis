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

    func testBothBoardPalettesAndEllipticalGlowsMatchSharedRenderer() throws {
        let design = try source("apps/ios/Jarvis/JarvisDesignSystem.swift")
        let colors = try matches(
            #"static let ambient(Cool|Warm|Green|Blue) = adaptiveColor\(light: 0x([a-f0-9]+), dark: 0x([a-f0-9]+)\)"#,
            in: design
        )
        XCTAssertEqual(colors.count, 4)
        let geometry = try matches(
            #"color: JarvisDesignTokens\.ambient(\w+),\s+center: UnitPoint\(x: ([0-9.]+), y: ([0-9.]+)\), radii: CGSize\(width: ([0-9.]+), height: ([0-9.]+)\),\s+opacity: colorScheme == \.dark \? ([0-9.]+) : ([0-9.]+)"#,
            in: design
        )
        XCTAssertEqual(geometry.count, 4)
        XCTAssertTrue(design.contains("endRadius: 0.70"))
        XCTAssertTrue(design.contains("Gradient(colors: [color.opacity(opacity), color.opacity(0)])"))

        for board in ["board.html", "surfaces.html"] {
            let html = try source("docs/ios/design/\(board)")
            let glows = try matches(
                #"radial-gradient\((\d+)% (\d+)% at (\d+)% (\d+)%, rgb\((\d+) (\d+) (\d+) / (\d+)%\), transparent (\d+)%\)"#,
                in: html
            )
            XCTAssertEqual(glows.count, 8, board)
            guard glows.count == 8 else { continue }
            for (index, name) in ["Cool", "Warm", "Green", "Blue"].enumerated() {
                let color = try XCTUnwrap(colors.first { $0[0] == name })
                let glow = try XCTUnwrap(geometry.first { $0[0] == name })
                for theme in 0..<2 {
                    let reference = glows[index + theme * 4]
                    let rgb = try XCTUnwrap(UInt32(color[theme + 1], radix: 16))
                    XCTAssertEqual(rgb, (UInt32(reference[4])! << 16) |
                                   (UInt32(reference[5])! << 8) | UInt32(reference[6])!, "\(board): \(name)")
                    for (actual, expected) in [(glow[1], reference[2]), (glow[2], reference[3]),
                                               (glow[3], reference[0]), (glow[4], reference[1]),
                                               (glow[theme == 0 ? 6 : 5], reference[7])] {
                        XCTAssertEqual(Double(actual)!, Double(expected)! / 100, accuracy: 0.0001)
                    }
                    XCTAssertEqual(reference[8], "70")
                }
            }
            for (token, css) in [("ambientPage", "page"), ("glassSolid", "g-solid")] {
                let palette = try XCTUnwrap(matches(
                    "static let \(token) = adaptiveColor\\(light: 0x([a-f0-9]+), dark: 0x([a-f0-9]+)\\)",
                    in: design
                ).first)
                for color in palette {
                    XCTAssertTrue(html.contains("--\(css): #\(color);"), "\(board): \(token)")
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
            "JarvisGateRootView.swift": ["JarvisGateSurface", "JarvisGateOverlayView"],
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
                    section.contains("JarvisAmbientBackground(") ||
                    section.contains("JarvisForm {"),
                    "\(name) must use the shared background"
                )
            }
        }
        let shell = try source("apps/ios/Jarvis/ContentView.swift")
        let sidebar = try source("apps/ios/Jarvis/JarvisSidebar.swift")
        XCTAssertTrue(shell.contains(".background { JarvisAmbientBackground() }"))
        XCTAssertTrue(sidebar.contains(".background(JarvisGlassSurface())"))
    }

    func testNoScreenReintroducesOpaqueSystemBackgroundsOrPrivateAmbientCopies() throws {
        let directory = repository.appendingPathComponent("apps/ios/Jarvis")
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "swift" }
        var definitions = 0
        for file in files {
            let text = try String(contentsOf: file, encoding: .utf8)
            definitions += text.components(separatedBy: "struct JarvisAmbientBackground: View").count - 1
            XCTAssertFalse(text.contains("JarvisGateAmbientBackground"), file.lastPathComponent)
            XCTAssertFalse(text.contains(".systemBackground"), file.lastPathComponent)
            XCTAssertFalse(text.contains(".secondarySystemBackground"), file.lastPathComponent)
            XCTAssertFalse(text.contains("Color.black.ignoresSafeArea()"), file.lastPathComponent)
            if file.lastPathComponent != "JarvisDesignSystem.swift" {
                XCTAssertTrue(try matches(#"(?:^|\n)\s*(?:List|Form) \{"#, in: text).isEmpty,
                              "\(file.lastPathComponent) must use shared glass rows")
            }
        }
        XCTAssertEqual(definitions, 1)
    }

    func testDecorativeOrbIsSharedAndVoiceKeepsItsForegroundOrb() throws {
        let design = try source("apps/ios/Jarvis/JarvisDesignSystem.swift")
        XCTAssertTrue(design.contains("JarvisOrbView(activity: .calm)"))
        XCTAssertTrue(design.contains(".allowsHitTesting(false)"))
        XCTAssertTrue(design.contains(".accessibilityHidden(true)"))
        XCTAssertTrue(design.contains("@Environment(\\.accessibilityReduceTransparency)"))
        XCTAssertTrue(design.contains("content.listRowBackground(JarvisGlassSurface())"))
        let voice = try source("apps/ios/Jarvis/VoiceScreen.swift")
        XCTAssertTrue(voice.contains("JarvisAmbientBackground(showsOrb: false)"))
        XCTAssertTrue(voice.contains("VoiceOrbView(status: model.statusText"))
        XCTAssertTrue(voice.contains("if !fixtureMode, model.voiceState == .idle"))
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
        XCTAssertEqual(workflow.components(separatedBy: #"xcrun simctl boot "$DEVICE_ID""#).count - 1, 1)
        let shell = try source("apps/ios/Jarvis/ContentView.swift")
        XCTAssertTrue(shell.contains("if fixtureMode,"))
        XCTAssertTrue(shell.contains("JarvisNotesPreview.makeClient()"))
        XCTAssertTrue(shell.contains("JarvisHealthPreview.makeClient()"))
        XCTAssertTrue(shell.contains("fixtureMode ? JarvisHealthPreview.now : Date()"))
    }
}
