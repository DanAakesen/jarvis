import JarvisCore
import SwiftUI

/// The shared page header for every page except Chat, Settings, Voice and Home: a bold title level with the
/// glass action buttons, then one data headline, then one hero card. Pages place `JarvisPageHeader` above the
/// scroller and `JarvisPageHeadline` plus `JarvisPageHeroCard` as the first scrolling content.
/// HIG: Navigation bars, Toolbars, Buttons, Typography (Dynamic Type), Accessibility.
/// API: ScaledMetric, ButtonStyle.glass, Menu, Text concatenation, accessibilityAddTraits(.isHeader).
enum JarvisPageHeaderMetrics {
    static let titleSize: CGFloat = 32
    static let actionSize = JarvisDesignTokens.iconButtonDiameter
    static let actionIconSize = JarvisDesignTokens.iconButtonGlyphSize
    static let inset: CGFloat = 16
    static let heroInset: CGFloat = 20
    static let spacing: CGFloat = 12
    static let actionSpacing: CGFloat = 8
    static let statMinimumWidth: CGFloat = 72
    static let dockSpacing: CGFloat = 16
    static let groupRadius: CGFloat = 14
}

/// Title bar: the title is left aligned, bold and about 32 pt (scaling with Dynamic Type and wrapping rather than
/// truncating), level with the right-side glass buttons. The sidebar button always closes the row, as in Chat.
struct JarvisPageHeader<Actions: View>: View {
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize = JarvisPageHeaderMetrics.titleSize
    let title: String
    let language: JarvisAppLanguage
    let actions: Actions

    init(title: String, language: JarvisAppLanguage, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.language = language
        self.actions = actions()
    }

    var body: some View {
        HStack(alignment: .center, spacing: JarvisPageHeaderMetrics.spacing) {
            Text(title)
                .font(.system(size: titleSize, weight: .bold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: JarvisPageHeaderMetrics.actionSize, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("page.title")
            HStack(spacing: JarvisPageHeaderMetrics.actionSpacing) {
                actions
                JarvisSidebarMenuButton(language: language)
            }
        }
        .padding(.horizontal, JarvisPageHeaderMetrics.inset)
        .padding(.top, JarvisPageHeaderMetrics.actionSpacing)
        .padding(.bottom, JarvisPageHeaderMetrics.actionSpacing)
    }
}

extension JarvisPageHeader where Actions == EmptyView {
    init(title: String, language: JarvisAppLanguage) {
        self.init(title: title, language: language) { EmptyView() }
    }
}

extension View {
    /// Pins the page header over the content with no bar background and no line: the content scrolls behind the
    /// title and the header buttons. HIG: Navigation bars, Toolbars, Scroll views.
    func jarvisPageHeader<Header: View>(@ViewBuilder _ header: () -> Header) -> some View {
        safeAreaInset(edge: .top, spacing: 0) { header() }
            .scrollEdgeEffectHidden(true, for: .top)
    }
}

/// The page's one headline, written from real data. Key words are orange. Loading and error states pass no
/// phrase, so only the title shows.
struct JarvisPageHeadline: View {
    let phrase: JarvisPagePhrase

    private var text: Text {
        phrase.segments.reduce(Text("")) { partial, segment in
            partial + Text(segment.text)
                .foregroundStyle(segment.isKey ? JarvisDesignTokens.primaryAccent : Color.primary)
        }
    }

    var body: some View {
        text
            .font(.title3.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(phrase.plainText)
            .accessibilityIdentifier("page.headline")
    }
}

/// The one hero component under the headline.
struct JarvisPageHeroCard<Accessory: View, Content: View>: View {
    let title: String
    let accessory: Accessory
    let content: Content
    private var fillsHeight = false

    /// Stretches the card to the height its parent offers, so cards in a carousel share one height.
    func fillingHeight(_ fills: Bool = true) -> Self {
        var copy = self
        copy.fillsHeight = fills
        return copy
    }

    init(title: String, @ViewBuilder accessory: () -> Accessory, @ViewBuilder content: () -> Content) {
        self.title = title
        self.accessory = accessory()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: JarvisPageHeaderMetrics.actionSpacing)
                accessory
            }
            content
        }
        .frame(maxWidth: .infinity, maxHeight: fillsHeight ? .infinity : nil, alignment: .topLeading)
        .padding(JarvisPageHeaderMetrics.heroInset)
        .background(
            .regularMaterial,
            in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }
}

extension JarvisPageHeroCard where Accessory == EmptyView {
    init(title: String, @ViewBuilder content: () -> Content) {
        self.init(title: title, accessory: { EmptyView() }, content: content)
    }
}

struct JarvisPageStat: Identifiable {
    let id: String
    let value: Int
    let label: String
    let systemImage: String
    var tint: Color = .secondary
}

/// Counts in a row that wraps at large Dynamic Type sizes. Each stat reads as one element.
struct JarvisPageStatGrid: View {
    let stats: [JarvisPageStat]
    let language: JarvisAppLanguage

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: JarvisPageHeaderMetrics.statMinimumWidth), spacing: JarvisPageHeaderMetrics.spacing, alignment: .topLeading)],
            alignment: .leading,
            spacing: JarvisPageHeaderMetrics.spacing
        ) {
            ForEach(stats) { stat in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: JarvisPageHeaderMetrics.actionSpacing / 2) {
                        Text(JarvisNumberFormat.compact(stat.value, language: language))
                            .font(.title2.weight(.semibold))
                            .monospacedDigit()
                        Spacer(minLength: JarvisPageHeaderMetrics.actionSpacing)
                        Image(systemName: stat.systemImage)
                            .font(.subheadline)
                            .foregroundStyle(stat.value > 0 ? stat.tint : Color.secondary)
                            .accessibilityHidden(true)
                    }
                    Text(stat.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(stat.label), \(stat.value.formatted(.number.locale(language.locale)))")
            }
        }
    }
}

/// The one page scaffold: a transparent top bar with the bold left-aligned title level with trailing glass actions
/// (`JarvisPageHeader`), then a data-phrase headline slot, a hero slot and a sections slot, on the shared ambient
/// background. Without a title (Home) there is no top bar and the headline sits at the very top. Chat, Settings and
/// Voice keep their own patterns. HIG: Navigation bars, Toolbars, Layout. API: ScrollView, ViewBuilder.
struct JarvisPageScaffold<Actions: View, Headline: View, Hero: View, Sections: View>: View {
    let title: String?
    let language: JarvisAppLanguage
    let actions: Actions
    let headline: Headline
    let hero: Hero
    let sections: Sections

    init(
        title: String?,
        language: JarvisAppLanguage,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder headline: () -> Headline,
        @ViewBuilder hero: () -> Hero,
        @ViewBuilder sections: () -> Sections
    ) {
        self.title = title
        self.language = language
        self.actions = actions()
        self.headline = headline()
        self.hero = hero()
        self.sections = sections()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                headline
                hero
                sections
            }
            .padding(.horizontal, JarvisPageHeaderMetrics.inset)
            .padding(.top, title == nil ? JarvisPageHeaderMetrics.spacing : 0)
            .padding(.bottom, JarvisPageHeaderMetrics.spacing)
        }
        .jarvisPageHeader {
            if let title {
                JarvisPageHeader(title: title, language: language) { actions }
            }
        }
        .jarvisAmbientBackground()
        .toolbar(.hidden, for: .navigationBar)
    }
}
