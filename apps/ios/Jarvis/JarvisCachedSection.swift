import JarvisCore
import SwiftUI

/// One card or list section that loads on its own through the on-device repository: cached data shows at once, a
/// stale entry refreshes in the background, and a failed refresh keeps the cached data with a quiet note. Loading
/// uses the one shared loading component. `reloadToken` forces a refresh (pull to refresh).
/// HIG: Loading, Refreshing content. API: structured concurrency (`task(id:)`), AsyncStream.
struct JarvisCachedSection<Value: Codable & Sendable & Equatable, Content: View>: View {
    let kind: JarvisRepositoryKind
    var scope = ""
    let language: JarvisAppLanguage
    let identifier: String
    var reloadToken = 0
    /// `nil` while the backend is not configured.
    let fetch: JarvisRepository<Value>.Fetch?
    var onRetryConfiguration: () -> Void = {}
    @ViewBuilder let content: (Value) -> Content

    @State private var state: JarvisCardState<Value> = .loading
    @State private var retryToken = 0
    @State private var handledToken = 0
    @State private var handledRetry = 0
    @State private var loadedScope: String?
    @State private var loadedKind: JarvisRepositoryKind?

    private struct LoadKey: Hashable {
        let reload: Int
        let retry: Int
        let scope: String
        let kind: JarvisRepositoryKind
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            switch loadedScope == scope && loadedKind == kind ? state : .loading {
            case .loading:
                JarvisInsightsStateView(kind: .loading, language: language, identifier: "\(identifier).loading")
            case .failed(let error):
                JarvisInsightsStateView(
                    kind: .failure(JarvisInsightsFailure(error)),
                    language: language,
                    identifier: "\(identifier).error"
                ) {
                    if fetch == nil { onRetryConfiguration() }
                    retryToken += 1
                }
            case .loaded(let value, let refreshFailed):
                content(value)
                if refreshFailed {
                    VStack(alignment: .leading) {
                        Text(jarvisInsightsText(.refreshFailedShowingSaved, language))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("\(identifier).refreshFailed")
                        JarvisLabelledButton(title: jarvisInsightsText(.retry, language)) {
                            retryToken += 1
                        }
                    }
                }
            }
        }
        .task(id: LoadKey(reload: reloadToken, retry: retryToken, scope: scope, kind: kind)) { await load() }
    }

    private func load() async {
        if loadedScope != scope || loadedKind != kind { state = .loading }
        loadedScope = scope
        loadedKind = kind
        guard let fetch else {
            state.apply(.failed(JarvisClientError.invalidBaseURL, cached: nil))
            return
        }
        let force = handledToken != reloadToken || handledRetry != retryToken
        handledToken = reloadToken
        handledRetry = retryToken
        let repository = await JarvisAppCache.repository(kind, scope: scope, fetch: fetch)
        for await update in repository.updates(force: force) {
            if Task.isCancelled { return }
            state.apply(update)
        }
        if !Task.isCancelled { state.finishLoading() }
    }
}
