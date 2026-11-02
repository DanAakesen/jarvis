import JarvisCore
import SwiftUI

/// The shared page header for every page except Chat, Settings, Voice and Home: a bold title level with the
/// glass action buttons, then one data headline, then one hero card. Pages place `JarvisPageHeader` above the
/// scroller and `JarvisPageHeadline` plus `JarvisPageHeroCard` as the first scrolling content.
/// HIG: Navigation bars, Toolbars, Buttons, Typography (Dynamic Type), Accessibility.
/// API: ScaledMetric, ButtonStyle.glass, Menu, Text concatenation, accessibilityAddTraits(.isHeader).
enum JarvisPageHeaderMetrics {
    static let titleSize: CGFloat = 32
    static let actionSize = JarvisDesignTokens.chatMinimumTapTarget
    static let actionIconSize: CGFloat = 18
    static let inset: CGFloat = 16
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
                    .jarvisGlassSurface()
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

private struct JarvisPageActionIcon: View {
    let systemImage: String

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: JarvisPageHeaderMetrics.actionIconSize, weight: .medium))
            .frame(width: JarvisPageHeaderMetrics.actionSize, height: JarvisPageHeaderMetrics.actionSize)
            .contentShape(Rectangle())
    }
}

/// A glass icon button for the title bar, the same 44 pt size as the Chat header buttons.
struct JarvisPageActionButton: View {
    let systemImage: String
    let label: String
    let identifier: String
    var isBusy = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if isBusy {
                ProgressView()
                    .frame(width: JarvisPageHeaderMetrics.actionSize, height: JarvisPageHeaderMetrics.actionSize)
            } else {
                JarvisPageActionIcon(systemImage: systemImage)
            }
        }
        .buttonStyle(.glass)
        .disabled(isDisabled || isBusy)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }
}

/// A glass icon button that opens a menu (for example the plus chooser).
struct JarvisPageActionMenu<Content: View>: View {
    let systemImage: String
    let label: String
    let identifier: String
    var isDisabled = false
    let content: Content

    init(
        systemImage: String,
        label: String,
        identifier: String,
        isDisabled: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.systemImage = systemImage
        self.label = label
        self.identifier = identifier
        self.isDisabled = isDisabled
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            JarvisPageActionIcon(systemImage: systemImage)
        }
        .buttonStyle(.glass)
        .disabled(isDisabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(JarvisPageHeaderMetrics.inset)
        .background(
            .regularMaterial,
            in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius, style: .continuous)
        )
        .accessibilityIdentifier("page.hero")
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
                        Text(stat.value.formatted(.number.locale(language.locale)))
                            .font(.title2.weight(.semibold))
                            .monospacedDigit()
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
