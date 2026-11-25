import JarvisCore
import SwiftUI
import UIKit
import WebKit

struct HTMLAppRenderer: View {
    let artifactId: String
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    var artifactVersion: Int? = nil
    var voiceHeight: CGFloat? = nil
    var revision: String? = nil

    @Environment(\.colorScheme) private var colorScheme

    @State private var artifact: HtmlArtifact?
    @State private var failedArtifactID: String?
    @State private var attempt = 0

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            if let artifact, artifact.id.caseInsensitiveCompare(artifactId) == .orderedSame {
                SandboxedHTMLApp(
                    artifact: artifact,
                    voiceStyle: voiceHeight == nil ? nil : (colorScheme == .dark ? .dark : .light),
                    palette: JarvisPalette.shared.selection
                )
                    .frame(minHeight: voiceHeight == nil ? 560 : JarvisDesignTokens.controlMinimumHeight,
                           maxHeight: voiceHeight ?? 560)
            }
            if failedArtifactID == artifactId {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                    Text(text(.htmlAppLoadFailed))
                        .foregroundStyle(.secondary)
                    JarvisLabelledButton(title: text(.retry)) { attempt += 1 }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if artifact?.id.caseInsensitiveCompare(artifactId) != .orderedSame {
                JarvisLoadingView(title: text(.htmlAppLoading))
                    .frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .task(id: "\(artifactId)-\(revision ?? "")-\(artifactVersion ?? 0)-\(attempt)") {
            if artifact?.id.caseInsensitiveCompare(artifactId) != .orderedSame { artifact = nil }
            failedArtifactID = nil
            do {
                let loadedArtifact = try await runtime.loadHTMLArtifact(id: artifactId, version: artifactVersion)
                guard !Task.isCancelled else { return }
                artifact = loadedArtifact
            } catch is CancellationError {
            } catch {
                guard !Task.isCancelled else { return }
                failedArtifactID = artifactId
            }
        }
    }

    private func text(_ key: JarvisWorkspaceLocalizationKey) -> String {
        JarvisWorkspaceLocalization.string(key, language: language)
    }
}

private struct SandboxedHTMLApp: UIViewRepresentable {
    let artifact: HtmlArtifact
    let voiceStyle: UIUserInterfaceStyle?
    let palette: JarvisPaletteSelection

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        if voiceStyle != nil {
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            let inset = JarvisDesignTokens.voicePanelEdgeInset
            webView.scrollView.contentInset = UIEdgeInsets(top: inset, left: 0, bottom: inset, right: 0)
            webView.scrollView.verticalScrollIndicatorInsets = webView.scrollView.contentInset
            webView.scrollView.setContentOffset(CGPoint(x: 0, y: -inset), animated: false)
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if let voiceStyle, webView.overrideUserInterfaceStyle != voiceStyle {
            webView.overrideUserInterfaceStyle = voiceStyle
        }
        let coordinator = context.coordinator
        let theme = voiceStyle == nil ? nil : Self.voiceAppearance(palette)
        let themeChanged = coordinator.theme != theme
        coordinator.theme = theme
        if coordinator.loadedArtifact != artifact {
            coordinator.loadedArtifact = artifact
            webView.loadHTMLString(Self.sandboxedDocument(artifact.html, theme: theme), baseURL: nil)
        } else if themeChanged {
            coordinator.updateTheme(in: webView)
        }
    }

    private static func sandboxedDocument(_ html: String, theme: String?) -> String {
        let policy = """
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">
        <meta name="referrer" content="no-referrer">
        """
        let appearance = theme.map {
            """
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style id="jarvis-voice-theme">\($0)</style>
            """
        } ?? ""
        guard let doctype = html.range(
            of: #"^\s*<!doctype[^>]*>"#,
            options: [.regularExpression, .caseInsensitive]
        ) else {
            return policy + appearance + html
        }
        return String(html[..<doctype.upperBound]) + policy + appearance + String(html[doctype.upperBound...])
    }

    private static func voiceAppearance(_ palette: JarvisPaletteSelection) -> String {
        func color(_ value: UIColor) -> String {
            func rgb(in style: UIUserInterfaceStyle) -> String {
                var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                _ = value.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
                    .getRed(&r, green: &g, blue: &b, alpha: &a)
                return "rgb(\(Int((r * 255).rounded())) \(Int((g * 255).rounded())) \(Int((b * 255).rounded()))"
            }
            return "light-dark(\(rgb(in: .light)), \(rgb(in: .dark)))"
        }
        return """
        :root {
            color-scheme: light dark !important;
            --jarvis-text: \(color(.label));
            --jarvis-muted: \(color(.secondaryLabel));
            --jarvis-background: \(color(UIColor(JarvisDesignTokens.glassSolid)));
            --jarvis-accent: \(color(UIColor(palette.primaryColor)));
            --jarvis-accent-warm: var(--jarvis-accent);
            --jarvis-accent-secondary: \(color(UIColor(palette.secondaryColor)));
            --jarvis-error: \(color(.systemRed));
        }
        :where(body) { color: var(--jarvis-text); background: var(--jarvis-background); font-family: system-ui, sans-serif; }
        body { overflow-wrap: anywhere; }
        :where(img, svg, canvas, video) { max-inline-size: 100%; }
        :where(pre) { white-space: pre-wrap; }
        :where(a) { color: var(--jarvis-accent); }
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedArtifact: HtmlArtifact?
        var theme: String?

        func updateTheme(in webView: WKWebView) {
            guard let theme else { return }
            webView.callAsyncJavaScript(
                "const style = document.getElementById('jarvis-voice-theme'); if (style) style.textContent = css;",
                arguments: ["css": theme], in: nil, in: .page, completionHandler: nil
            )
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            updateTheme(in: webView)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.targetFrame?.isMainFrame == true,
                  navigationAction.request.url?.scheme == "about" else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
