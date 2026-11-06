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
    static let heroInset: CGFloat = 16
    static let spacing: CGFloat = 12
    static let actionSpacing: CGFloat = 8
    static let statMinimumWidth: CGFloat = 72
    static let dockSpacing: CGFloat = 16
    static let groupRadius: CGFloat = 14
    static let rowInset: CGFloat = 16
    static let rowVerticalInset: CGFloat = 10
    static let rowLineSpacing: CGFloat = 4
    static let skeletonLineHeight: CGFloat = 18
    static let skeletonHeroHeight: CGFloat = 156
    static let heroValueMinimumWidth: CGFloat = 112
    static let compactChartHeight: CGFloat = 96
}

/// Title bar: the title is left aligned, bold and about 32 pt (scaling with Dynamic Type and wrapping rather than
/// truncating), level with the right-side glass buttons. The sidebar button always closes the row, as in Chat.
struct JarvisPageHeader<Actions: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
        .background {
            if dynamicTypeSize.isAccessibilitySize {
                Rectangle().fill(.regularMaterial).ignoresSafeArea(edges: .top)
            }
        }
    }
}

extension JarvisPageHeader where Actions == EmptyView {
    init(title: String, language: JarvisAppLanguage) {
        self.init(title: title, language: language) { EmptyView() }
    }
}

private struct JarvisPageHeaderModifier<Header: View>: ViewModifier {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var isScrolled = false
    let header: Header

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top > 1
            } action: { _, scrolled in
                isScrolled = scrolled
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                header.background {
                    // Accessibility headers already provide this material at every offset.
                    if isScrolled && !dynamicTypeSize.isAccessibilitySize {
                        Rectangle().fill(.regularMaterial).ignoresSafeArea(edges: .top)
                    }
                }
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
    }
}

extension View {
    /// The header is transparent at rest; native material protects its title once rows scroll beneath it.
    /// Observe only crossing the top edge, rather than rebuilding the page for every scroll offset.
    func jarvisPageHeader<Header: View>(@ViewBuilder _ header: () -> Header) -> some View {
        modifier(JarvisPageHeaderModifier(header: header()))
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
                .fontWeight(segment.isKey ? .bold : .regular)
        }
    }

    var body: some View {
        text
            .font(.title2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(phrase.plainText)
            .accessibilityIdentifier("page.headline")
    }
}

/// A section heading outside its content surface, with an optional trailing action.
/// The accessory stays a real control and the heading remains a VoiceOver heading at every text size.
struct JarvisSectionHeadline<Accessory: View>: View {
    let title: String
    let count: Int?
    let accessory: Accessory

    init(_ title: String, count: Int? = nil, @ViewBuilder accessory: () -> Accessory) {
        self.title = title
        self.count = count
        self.accessory = accessory()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: JarvisPageHeaderMetrics.spacing) {
            Text(title)
                .font(.title3.weight(.bold))
                // Keep section headings strong, including inside native List headers.
                .foregroundStyle(Color.primary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let count {
                Text(count, format: .number)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            accessory
        }
        .padding(.horizontal, JarvisPageHeaderMetrics.rowLineSpacing)
        .padding(.top, JarvisPageHeaderMetrics.spacing)
    }
}

extension JarvisSectionHeadline where Accessory == EmptyView {
    init(_ title: String, count: Int? = nil) {
        self.init(title, count: count) { EmptyView() }
    }
}

/// Shared spacing and structural separation for rows inside a grouped surface.
/// The caller owns the row's content and action; this modifier never adds a nested button.
extension View {
    func jarvisListRow(separator: Bool = true) -> some View {
        self
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, JarvisPageHeaderMetrics.rowInset)
            .padding(.vertical, JarvisPageHeaderMetrics.rowVerticalInset)
            .overlay(alignment: .bottom) {
                if separator { Divider() }
            }
    }
}

struct JarvisRowGroup<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
            .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
    }
}

/// The one hero component under the headline.
struct JarvisPageHeroCard<Accessory: View, Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
            if !title.isEmpty, dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.actionSpacing) {
                    heading
                    accessory
                }
            } else if !title.isEmpty {
                HStack(alignment: .firstTextBaseline) {
                    heading
                    Spacer(minLength: JarvisPageHeaderMetrics.actionSpacing)
                    accessory
                }
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

    private var heading: some View {
        Text(title).font(.headline).accessibilityAddTraits(.isHeader)
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
    var formattedValue: String?
}

/// Counts in a row that wraps at large Dynamic Type sizes. Each stat reads as one element.
struct JarvisPageStatGrid: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let stats: [JarvisPageStat]
    let language: JarvisAppLanguage

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: JarvisPageHeaderMetrics.spacing, alignment: .topLeading),
                           count: dynamicTypeSize.isAccessibilitySize ? 1 : max(1, min(stats.count, 4))),
            alignment: .leading,
            spacing: JarvisPageHeaderMetrics.spacing
        ) {
            ForEach(stats) { stat in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: JarvisPageHeaderMetrics.actionSpacing / 2) {
                        Text(stat.formattedValue ?? JarvisNumberFormat.compact(stat.value, language: language))
                            .font(.title.weight(.bold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
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
                .accessibilityLabel("\(stat.label), \(stat.formattedValue ?? stat.value.formatted(.number.locale(language.locale)))")
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

/// Initial page loading has one stable, noninteractive layout. No filters or invented values are exposed.
/// One localized announcement replaces decorative shapes for VoiceOver. The shared shimmer stops
/// offscreen, in the background and with Reduce Motion; loading never delays real content.
struct JarvisPageLoadingView: View {
    let title: String
    var identifier = "page.loading"
    @ScaledMetric(relativeTo: .body) private var lineHeight = JarvisPageHeaderMetrics.skeletonLineHeight

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
            line()
            line().frame(maxWidth: JarvisPageHeaderMetrics.statMinimumWidth * 3)
            RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius)
                .fill(.secondary.opacity(0.12))
                .frame(height: JarvisPageHeaderMetrics.skeletonHeroHeight)
            line().frame(maxWidth: JarvisPageHeaderMetrics.statMinimumWidth * 2)
                .padding(.top, JarvisPageHeaderMetrics.spacing)
            JarvisRowGroup {
                ForEach(0..<3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        line()
                        line().frame(maxWidth: JarvisPageHeaderMetrics.statMinimumWidth * 2)
                    }
                    .jarvisListRow()
                }
            }
        }
        .modifier(JarvisLoadingShimmer())
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }

    private func line() -> some View {
        RoundedRectangle(cornerRadius: JarvisPageHeaderMetrics.rowLineSpacing)
            .fill(.secondary.opacity(0.16))
            .frame(height: lineHeight)
    }
}

/// A quiet travelling highlight makes pending data distinguishable from an empty page.
private struct JarvisLoadingShimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.layoutDirection) private var layoutDirection
    @State private var visible = false

    func body(content: Content) -> some View {
        content.overlay {
            if visible && scenePhase == .active && !reduceMotion {
                TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
                    GeometryReader { geometry in
                        let phase = timeline.date.timeIntervalSinceReferenceDate
                            .truncatingRemainder(dividingBy: 1.8) / 1.8
                        let travel = layoutDirection == .rightToLeft ? 1 - phase : phase
                        LinearGradient(colors: [.clear, .primary.opacity(0.65), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: geometry.size.width * 0.5)
                            .offset(x: geometry.size.width * (travel * 1.5 - 0.5))
                    }
                }
                .mask(content)
                .accessibilityHidden(true)
            }
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}
