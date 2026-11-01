import JarvisCore
import SwiftUI
import UIKit
import WebKit

struct HTMLAppRenderer: View {
    let artifactId: String
    let runtime: WorkspaceRuntime
    let language: JarvisAppLanguage

    @State private var artifact: HtmlArtifact?
    @State private var failedArtifactID: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let artifact, artifact.id.caseInsensitiveCompare(artifactId) == .orderedSame {
                SandboxedHTMLApp(artifact: artifact)
                    .frame(height: 560)
            } else if failedArtifactID == artifactId {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
                    Text(text(.htmlAppLoadFailed))
                        .foregroundStyle(.secondary)
                    Button(text(.retry)) { attempt += 1 }
                        .buttonStyle(.glass)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ProgressView(text(.htmlAppLoading))
                    .frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .task(id: "\(artifactId)-\(attempt)") {
            artifact = nil
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
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedArtifactID != artifact.id else { return }
        context.coordinator.loadedArtifactID = artifact.id
        webView.loadHTMLString(Self.sandboxedDocument(artifact.html), baseURL: nil)
    }

    private static func sandboxedDocument(_ html: String) -> String {
        let policy = """
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">
        <meta name="referrer" content="no-referrer">
        """
        guard let doctype = html.range(
            of: #"^\s*<!doctype[^>]*>"#,
            options: [.regularExpression, .caseInsensitive]
        ) else {
            return policy + html
        }
        return String(html[..<doctype.upperBound]) + policy + String(html[doctype.upperBound...])
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedArtifactID: String?

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
