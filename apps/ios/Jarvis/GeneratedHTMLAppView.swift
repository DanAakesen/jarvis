import JarvisCore
import SwiftUI
import UIKit
import WebKit

struct HTMLAppRenderer: View {
    let artifactId: String
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage
    var voiceHeight: CGFloat? = nil
    var revision: String? = nil

    @Environment(\.colorScheme) private var colorScheme

    @State private var artifact: HtmlArtifact?
    @State private var failedArtifactID: String?
    @State private var attempt = 0

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            if let artifact, artifact.id.caseInsensitiveCompare(artifactId) == .orderedSame {
                SandboxedHTMLApp(artifact: artifact, voiceStyle: voiceHeight == nil ? nil : (colorScheme == .dark ? .dark : .light))
                    .frame(height: voiceHeight ?? 560)
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
        .task(id: "\(artifactId)-\(revision ?? "")-\(attempt)") {
            if artifact?.id.caseInsensitiveCompare(artifactId) != .orderedSame { artifact = nil }
            failedArtifactID = nil
            do {
                let loadedArtifact = try await runtime.loadHTMLArtifact(id: artifactId)
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
            webView.scrollView.contentInset.top = JarvisDesignTokens.controlMinimumHeight
            webView.scrollView.verticalScrollIndicatorInsets.top = JarvisDesignTokens.controlMinimumHeight
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if let voiceStyle, webView.overrideUserInterfaceStyle != voiceStyle {
            webView.overrideUserInterfaceStyle = voiceStyle
        }
        guard context.coordinator.loadedArtifact != artifact else { return }
        context.coordinator.loadedArtifact = artifact
        webView.loadHTMLString(Self.sandboxedDocument(artifact.html, followsVoiceTheme: voiceStyle != nil), baseURL: nil)
    }

    private static func sandboxedDocument(_ html: String, followsVoiceTheme: Bool) -> String {
        let policy = """
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">
        <meta name="referrer" content="no-referrer">
        """
        let appearance = followsVoiceTheme ? voiceAppearance : ""
        guard let doctype = html.range(
            of: #"^\s*<!doctype[^>]*>"#,
            options: [.regularExpression, .caseInsensitive]
        ) else {
            return policy + appearance + html
        }
        return String(html[..<doctype.upperBound]) + policy + appearance + String(html[doctype.upperBound...])
    }

    private static var voiceAppearance: String {
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
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root {
            color-scheme: light dark !important;
            --jarvis-text: \(color(.label));
            --jarvis-muted: \(color(.secondaryLabel));
            --jarvis-background: \(color(UIColor(JarvisDesignTokens.glassSolid)));
            --jarvis-accent: \(color(UIColor(JarvisDesignTokens.primaryAccent)));
            --jarvis-accent-warm: \(color(UIColor(JarvisDesignTokens.ambientWarm)));
            --jarvis-error: \(color(.systemRed));
        }
        :where(body) { color: var(--jarvis-text); background: var(--jarvis-background); font-family: system-ui, sans-serif; }
        :where(a) { color: var(--jarvis-accent); }
        </style>
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedArtifact: HtmlArtifact?

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
