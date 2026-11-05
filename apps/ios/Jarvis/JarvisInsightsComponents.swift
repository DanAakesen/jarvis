import JarvisCore
import SwiftUI

/// Shared pieces of the Usage, Status and Proactive pages. They sit on the shared control layer, the shared
/// glass and the one corner token; nothing here defines a second look.
/// HIG: Layout, Loading, Empty states, Alerts. API: Material, ProgressView, ContentUnavailableView.

/// One read of a page: loading, loaded or failed. A failed read can still carry the last good value.
enum JarvisInsightsLoad<Value> {
    case loading
    case loaded(Value)
    case failed(JarvisInsightsFailure)
}

func jarvisInsightsText(_ key: JarvisInsightsLocalizationKey, _ language: JarvisAppLanguage) -> String {
    JarvisInsightsLocalization.string(key, language: language)
}

/// A panel for one section: stone-on-material, with the board's single corner radius.
struct JarvisInsightsCard<Content: View>: View {
    var title: String?
    var accessory: AnyView?
    let content: Content

    init(title: String? = nil, accessory: AnyView? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.accessory = accessory
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            if title != nil || accessory != nil {
                JarvisSectionHeadline(title ?? "") {
                    if let accessory { accessory }
                }
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(JarvisDesignTokens.healthSectionSpacing)
                .background(
                    .regularMaterial,
                    in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius, style: .continuous)
                )
        }
    }
}

/// The page header: title on the left, page actions, then the sidebar button on the right as on every page.
struct JarvisInsightsHeader<Actions: View>: View {
    let title: String
    let language: JarvisAppLanguage
    let actions: Actions

    init(title: String, language: JarvisAppLanguage, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.language = language
        self.actions = actions()
    }

    var body: some View {
        HStack(spacing: JarvisDesignTokens.healthRowSpacing) {
            Text(title)
                .font(.title2.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            actions
            JarvisSidebarMenuButton(language: language)
        }
        .padding(.horizontal)
    }
}

/// Loading, error, offline, sign-in, unavailable and empty, each as one icon, one line and an optional retry.
struct JarvisInsightsStateView: View {
    enum Kind {
        case loading
        case empty
        case failure(JarvisInsightsFailure)
    }

    let kind: Kind
    var emptyTitle: String = ""
    /// Replaces the generic line for a failure, for pages with a more exact sentence.
    var message: String?
    let language: JarvisAppLanguage
    var identifier: String
    var retry: (() -> Void)?

    private var title: String {
        if let message { return message }
        switch kind {
        case .loading: return jarvisInsightsText(.loading, language)
        case .empty: return emptyTitle
        case .failure(let failure): return jarvisInsightsText(failure.localizationKey, language)
        }
    }

    private var systemImage: String {
        switch kind {
        case .loading:
            return "hourglass"
        case .empty:
            return "tray"
        case .failure(let failure):
            switch failure {
            case .offline, .timedOut:
                return "wifi.slash"
            case .signInRequired:
                return "person.crop.circle.badge.exclamationmark"
            case .unavailable, .notConfigured:
                return "slash.circle"
            default:
                return "exclamationmark.triangle"
            }
        }
    }

    private var canRetry: Bool {
        guard retry != nil else { return false }
        if case .failure(let failure) = kind { return failure != .signInRequired && failure != .unavailable }
        return false
    }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.healthRowSpacing) {
            if case .loading = kind {
                JarvisLoadingView().accessibilityHidden(true)
            } else {
                Image(systemName: systemImage)
                    .font(.title2)
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                    .accessibilityHidden(true)
            }
            Text(title)
                .font(.subheadline.weight(.medium))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if canRetry, let retry {
                JarvisIconButton(
                    title: jarvisInsightsText(.retry, language),
                    systemImage: "arrow.clockwise",
                    identifier: "\(identifier).retry",
                    action: retry
                )
            }
        }
        .frame(maxWidth: .infinity)
        .padding(JarvisDesignTokens.healthSectionSpacing)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

/// A small status pill. Text always carries the meaning; the icon only supports it.
struct JarvisInsightsBadge: View {
    let title: String
    var systemImage: String?
    var tint: Color = JarvisDesignTokens.secondaryAccent

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage).accessibilityHidden(true)
            }
            Text(title).lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(tint)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(tint.opacity(0.14), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
