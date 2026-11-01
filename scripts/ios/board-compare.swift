import AppKit
import CoreGraphics
import Darwin
import Foundation
import WebKit

private struct BoardReference {
    let appScreen: String
    let boardFile: String
    let query: [String: String]
}

@MainActor
private final class BoardRenderer: NSObject, WKNavigationDelegate {
    private let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 1600))
    private var completion: CheckedContinuation<CGImage, Error>?

    var view: WKWebView { webView }

    override init() {
        super.init()
        webView.navigationDelegate = self
    }

    func render(boardURL: URL, accessDirectory: URL) async throws -> CGImage {
        try await withCheckedThrowingContinuation { continuation in
            completion = continuation
            webView.loadFileURL(boardURL, allowingReadAccessTo: accessDirectory)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let script = """
        (() => {
          window.scrollTo(0, 0);
          const style = document.createElement('style');
          style.textContent = '* { animation: none !important; transition: none !important; caret-color: transparent !important; }';
          document.head.append(style);
          if (new URLSearchParams(location.search).get('needs') === 'open') {
            const needs = document.querySelector('#apv');
            const scrim = document.querySelector('#apv-scrim');
            if (needs && scrim) {
              needs.hidden = false;
              needs.inert = false;
              needs.setAttribute('aria-hidden', 'false');
              scrim.hidden = false;
            }
          }
          const phone = document.querySelector('#phone');
          if (!phone) throw new Error('Board reference has no #phone render target.');
          const rect = phone.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
        """
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self else { return }
            if let error {
                self.finish(.failure(error))
                return
            }
            guard let rect = result as? [String: NSNumber] else {
                self.finish(.failure(BoardCompareError.invalidBoardFrame))
                return
            }
            let frame = CGRect(
                x: rect["x"]?.doubleValue ?? 0,
                y: rect["y"]?.doubleValue ?? 0,
                width: rect["width"]?.doubleValue ?? 0,
                height: rect["height"]?.doubleValue ?? 0
            )
            guard frame.width > 0, frame.height > 0 else {
                self.finish(.failure(BoardCompareError.invalidBoardFrame))
                return
            }
            let configuration = WKSnapshotConfiguration()
            configuration.rect = frame
            webView.takeSnapshot(with: configuration) { image, error in
                guard let image, error == nil else {
                    self.finish(.failure(error ?? BoardCompareError.snapshotUnavailable))
                    return
                }
                var proposedRect = CGRect(origin: .zero, size: image.size)
                guard let cgImage = image.cgImage(
                    forProposedRect: &proposedRect,
                    context: nil,
                    hints: nil
                ) else {
                    self.finish(.failure(BoardCompareError.snapshotUnavailable))
                    return
                }
                self.finish(.success(cgImage))
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: any Error
    ) {
        finish(.failure(error))
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: any Error
    ) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<CGImage, Error>) {
        guard let completion else { return }
        self.completion = nil
        completion.resume(with: result)
    }
}

private enum BoardCompareError: Error, CustomStringConvertible {
    case usage
    case invalidBoardFrame
    case snapshotUnavailable
    case missingScreenshot(String)
    case checksFailed(String)

    var description: String {
        switch self {
        case .usage:
            "Usage: board-compare.swift <xcresult-attachments-directory> <output-directory>"
        case .invalidBoardFrame:
            "The board reference did not produce a valid phone frame."
        case .snapshotUnavailable:
            "WebKit could not capture or decode an image."
        case .missingScreenshot(let name):
            "Missing XCUITest screenshot attachment: \(name).png"
        case .checksFailed(let report):
            "iOS screenshot checks failed:\n\(report)"
        }
    }
}

@main
private struct BoardCompare {
    private static let width = 440
    private static let height = 956
    private static let tolerance = 0.38

    private static let references = [
        BoardReference(appScreen: "sign-in", boardFile: "board.html", query: ["screen": "signin", "state": "idle"]),
        BoardReference(appScreen: "chat", boardFile: "board.html", query: ["screen": "chat"]),
        BoardReference(appScreen: "screen-chat", boardFile: "board.html", query: ["screen": "chat"]),
        BoardReference(appScreen: "sidebar", boardFile: "board.html", query: ["screen": "chat", "sidebar": "open"]),
        BoardReference(appScreen: "plus-menu", boardFile: "board.html", query: ["screen": "chat", "plus": "open"]),
        BoardReference(appScreen: "notifications", boardFile: "board.html", query: ["screen": "chat", "needs": "open"]),
        BoardReference(appScreen: "screen-voice", boardFile: "board.html", query: ["screen": "voice", "voice": "listening"]),
        BoardReference(appScreen: "screen-notes", boardFile: "board.html", query: ["screen": "notes", "tab": "notes"]),
        BoardReference(appScreen: "screen-health", boardFile: "board.html", query: ["screen": "health", "tab": "dashboard"]),
        BoardReference(appScreen: "screen-softwareFactory", boardFile: "board.html", query: ["screen": "factory", "tab": "board"]),
        BoardReference(appScreen: "screen-settings", boardFile: "board.html", query: ["screen": "settings", "tab": "general"]),
        BoardReference(appScreen: "screen-status", boardFile: "board.html", query: ["screen": "status"]),
        BoardReference(appScreen: "screen-usage", boardFile: "board.html", query: ["screen": "usage"]),
        BoardReference(appScreen: "screen-proactive", boardFile: "board.html", query: ["screen": "proactive"]),
        BoardReference(appScreen: "screen-workspaces", boardFile: "workspaces.html", query: ["state": "default"])
    ]

    @MainActor
    static func main() async {
        do {
            guard CommandLine.arguments.count == 3 else { throw BoardCompareError.usage }
            let screenshotDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
            let designDirectory = URL(fileURLWithPath: "docs/ios/design", isDirectory: true)
            let boardURL = designDirectory.appendingPathComponent("board.html")
            try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

            let application = NSApplication.shared
            application.setActivationPolicy(.accessory)
            let renderer = BoardRenderer()
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1200, height: 1600),
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            window.contentView = renderer.view
            window.orderFrontRegardless()
            application.activate(ignoringOtherApps: true)

            var failures: [String] = []
            var report: [String] = []
            for theme in ["light", "dark"] {
                for language in ["da", "en"] {
                    for reference in references {
                        let attachmentName = "ios-\(reference.appScreen)-\(theme)-\(language)"
                        guard let screenshotURL = findAttachment(
                            attachmentName,
                            in: screenshotDirectory
                        ) else {
                            throw BoardCompareError.missingScreenshot(attachmentName)
                        }
                        let referenceURL = try boardURL(
                            for: reference,
                            base: designDirectory,
                            theme: theme,
                            language: language
                        )
                        let boardImage = try await renderer.render(
                            boardURL: referenceURL,
                            accessDirectory: designDirectory
                        )
                        let boardPNG = outputDirectory.appendingPathComponent(
                            "board-\(reference.appScreen)-\(theme)-\(language).png"
                        )
                        try writePNG(boardImage, to: boardPNG)
                        let appPNG = outputDirectory.appendingPathComponent("\(attachmentName).png")
                        try FileManager.default.copyItem(at: screenshotURL, to: appPNG)
                        let result = try compare(app: appPNG, board: boardPNG)
                        let line = "\(attachmentName): color \(result.colorDelta), structure \(result.structureDrift)"
                        print(line)
                        report.append(line)
                        if result.colorDelta > tolerance || result.structureDrift > tolerance {
                            failures.append(line)
                        }
                    }
                }
            }
            let appearanceCheck = try verifyNamedScreenshotAppearances(in: screenshotDirectory)
            for line in appearanceCheck.report {
                print(line)
                report.append(line)
            }
            failures.append(contentsOf: appearanceCheck.failures)
            try (report.joined(separator: "\n") + "\n").write(
                to: outputDirectory.appendingPathComponent("comparison.txt"),
                atomically: true,
                encoding: .utf8
            )
            if !failures.isEmpty {
                throw BoardCompareError.checksFailed(failures.joined(separator: "\n"))
            }
            print("Compared \(references.count * 4) simulator screens to board renders (tolerance \(tolerance)).")
        } catch {
            fputs("::error::\(error)\n", stderr)
            exit(EXIT_FAILURE)
        }
    }

    private static func boardURL(
        for reference: BoardReference,
        base: URL,
        theme: String,
        language: String
    ) throws -> URL {
        let fileURL = base.appendingPathComponent(reference.boardFile)
        var components = URLComponents(url: fileURL, resolvingAgainstBaseURL: false)!
        var query = reference.query
        query["theme"] = theme
        query["lang"] = language
        query["bare"] = "screen"
        components.queryItems = query.keys.sorted().map {
            URLQueryItem(name: $0, value: query[$0])
        }
        guard let url = components.url else { throw BoardCompareError.invalidBoardFrame }
        return url
    }

    private static func findAttachment(_ name: String, in directory: URL) -> URL? {
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }
        var files: [URL] = []
        while let url = enumerator.nextObject() as? URL {
            files.append(url)
        }
        for manifestURL in files where manifestURL.lastPathComponent == "manifest.json" {
            guard
                let data = try? Data(contentsOf: manifestURL),
                let manifest = try? JSONSerialization.jsonObject(with: data)
            else { continue }
            if let exportedName = manifestExportedFilename(manifest, matching: name) {
                let fileName = URL(fileURLWithPath: exportedName).lastPathComponent
                if let url = files.first(where: { $0.lastPathComponent == fileName }) {
                    return url
                }
            }
        }
        for url in files
        where url.pathExtension.lowercased() == "png" && url.lastPathComponent.contains(name) {
            return url
        }
        return nil
    }

    private static func manifestExportedFilename(_ value: Any, matching name: String) -> String? {
        switch value {
        case let entries as [Any]:
            return entries.lazy.compactMap { manifestExportedFilename($0, matching: name) }.first
        case let entry as [String: Any]:
            let nameKeys = ["name", "attachmentName", "suggestedHumanReadableName", "displayName"]
            let fileKeys = ["exportedFileName", "filename", "fileName"]
            let attachmentNames = nameKeys.compactMap { entry[$0] as? String }
            if attachmentNames.contains(where: {
                URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent == name
            }) {
                if let fileName = fileKeys.compactMap({ entry[$0] as? String }).first {
                    return fileName
                }
            }
            for (fileName, attachmentName) in entry {
                if let attachmentName = attachmentName as? String,
                   URL(fileURLWithPath: attachmentName).deletingPathExtension().lastPathComponent == name,
                   fileName.lowercased().hasSuffix(".png") {
                    return fileName
                }
            }
            return entry.values.lazy.compactMap { manifestExportedFilename($0, matching: name) }.first
        default:
            return nil
        }
    }

    private static func verifyNamedScreenshotAppearances(
        in directory: URL
    ) throws -> (report: [String], failures: [String]) {
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return ([], []) }

        var report: [String] = []
        var failures: [String] = []
        while let url = enumerator.nextObject() as? URL {
            guard url.pathExtension.lowercased() == "png" else { continue }
            let components = url.deletingPathExtension().lastPathComponent.split(separator: "-")
            guard let theme = components.first(where: { $0 == "light" || $0 == "dark" }) else {
                continue
            }
            guard
                let image = NSImage(contentsOf: url),
                let imageCG = cgImage(image)
            else {
                throw BoardCompareError.snapshotUnavailable
            }
            let luminance = backgroundLuminance(pixels(imageCG))
            let requestedTheme = String(theme)
            let matchesTheme = requestedTheme == "dark"
                ? luminance < 0.5
                : luminance >= 0.5
            let line = "\(url.lastPathComponent): \(requestedTheme) background luminance \(luminance)"
            report.append(line)
            if !matchesTheme {
                failures.append(
                    "Screenshot \(url.lastPathComponent) requests \(requestedTheme) appearance but its sampled background luminance is \(luminance)."
                )
            }
        }
        return (report, failures)
    }

    private static func backgroundLuminance(_ imagePixels: [UInt8]) -> Double {
        let edgeSamples = [
            (x: width / 40, y: height * 3 / 20),
            (x: width * 39 / 40, y: height * 3 / 20),
            (x: width / 40, y: height / 2),
            (x: width * 39 / 40, y: height / 2),
            (x: width / 40, y: height * 17 / 20),
            (x: width * 39 / 40, y: height * 17 / 20)
        ]
        let patchRadius = 4
        let patchLuminances = edgeSamples.map { sample in
            var total = 0.0
            var count = 0.0
            for y in (sample.y - patchRadius)..<(sample.y + patchRadius) {
                for x in (sample.x - patchRadius)..<(sample.x + patchRadius) {
                    let offset = (y * width + x) * 4
                    total += 0.2126 * Double(imagePixels[offset])
                        + 0.7152 * Double(imagePixels[offset + 1])
                        + 0.0722 * Double(imagePixels[offset + 2])
                    count += 1
                }
            }
            return total / count / 255
        }.sorted()
        return (patchLuminances[2] + patchLuminances[3]) / 2
    }

    private static func writePNG(_ image: CGImage, to url: URL) throws {
        let representation = NSBitmapImageRep(cgImage: image)
        guard let data = representation.representation(using: .png, properties: [:]) else {
            throw BoardCompareError.snapshotUnavailable
        }
        try data.write(to: url)
    }

    private static func compare(
        app appURL: URL,
        board boardURL: URL
    ) throws -> (colorDelta: Double, structureDrift: Double) {
        guard
            let appImage = NSImage(contentsOf: appURL),
            let boardImage = NSImage(contentsOf: boardURL),
            let appCG = cgImage(appImage),
            let boardCG = cgImage(boardImage)
        else {
            throw BoardCompareError.snapshotUnavailable
        }
        let appPixels = pixels(appCG)
        let boardPixels = pixels(boardCG)
        let columns = 22
        let rows = 48
        var colorDelta = 0.0
        var structureDrift = 0
        let cellCount = columns * rows
        for row in 0..<rows {
            for column in 0..<columns {
                let x0 = column * width / columns
                let x1 = (column + 1) * width / columns
                let y0 = row * height / rows
                let y1 = (row + 1) * height / rows
                var appRGB = [Double](repeating: 0, count: 3)
                var boardRGB = [Double](repeating: 0, count: 3)
                var samples = 0.0
                for y in y0..<y1 {
                    for x in x0..<x1 {
                        let offset = (y * width + x) * 4
                        for channel in 0..<3 {
                            appRGB[channel] += Double(appPixels[offset + channel])
                            boardRGB[channel] += Double(boardPixels[offset + channel])
                        }
                        samples += 1
                    }
                }
                for channel in 0..<3 {
                    appRGB[channel] /= samples
                    boardRGB[channel] /= samples
                    colorDelta += abs(appRGB[channel] - boardRGB[channel]) / 255
                }
                let appLuma = 0.2126 * appRGB[0] + 0.7152 * appRGB[1] + 0.0722 * appRGB[2]
                let boardLuma = 0.2126 * boardRGB[0] + 0.7152 * boardRGB[1] + 0.0722 * boardRGB[2]
                if abs(appLuma - boardLuma) / 255 > 0.18 {
                    structureDrift += 1
                }
            }
        }
        return (
            colorDelta / Double(cellCount * 3),
            Double(structureDrift) / Double(cellCount)
        )
    }

    private static func cgImage(_ image: NSImage) -> CGImage? {
        var bounds = CGRect(origin: .zero, size: image.size)
        return image.cgImage(forProposedRect: &bounds, context: nil, hints: nil)
    }

    private static func pixels(_ image: CGImage) -> [UInt8] {
        var result = [UInt8](repeating: 0, count: width * height * 4)
        result.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        return result
    }
}
