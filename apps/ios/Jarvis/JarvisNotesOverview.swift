import JarvisCore
import SwiftUI

enum JarvisNotesOverviewMetrics {
    static let hairline: CGFloat = 0.5
    static let listRadius: CGFloat = 20
    static let listIndent: CGFloat = 16
    static let barHeight: CGFloat = 8
    static let barGap: CGFloat = 2
    static let bottomClearance: CGFloat = 190
}

extension View {
    /// A transparent rounded outline in the Software Factory list style: no fill, a 0.5 pt hairline.
    func jarvisHairlineOutline(radius: CGFloat) -> some View {
        overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.12), lineWidth: JarvisNotesOverviewMetrics.hairline)
        )
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// The Notes hero: Overview with the link count, four equal columns (Notes, Open tasks, Overdue, Today) split by
/// hairlines, then one segmented colour bar per folder with a small legend.
/// HIG: Layout, Typography. API: GeometryReader for the proportional bar.
struct JarvisNotesOverviewHero: View {
    let title: String
    let linkCount: Int?
    let linksLabel: String
    let stats: [JarvisPageStat]
    let shares: [JarvisNotesFolderShare]
    let rootTitle: String
    let language: JarvisAppLanguage

    private var palette: [Color] {
        [
            JarvisDesignTokens.primaryAccent,
            JarvisDesignTokens.secondaryAccent,
            JarvisDesignTokens.primaryAccent.opacity(0.55),
            JarvisDesignTokens.secondaryAccent.opacity(0.55),
            Color.secondary.opacity(0.6),
        ]
    }

    private func color(_ index: Int) -> Color { palette[index % palette.count] }

    private func name(_ share: JarvisNotesFolderShare) -> String {
        share.folder.isEmpty ? rootTitle : share.folder
    }

    var body: some View {
        JarvisPageHeroCard(title: title) {
            if let linkCount {
                Text("\(JarvisNumberFormat.compact(linkCount, language: language)) \(linksLabel)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("notes.hero.links")
            }
        } content: {
            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.spacing) {
                columns
                if !shares.isEmpty {
                    folderBar
                    legend
                }
            }
        }
        .accessibilityIdentifier("notes.hero")
    }

    private var columns: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(stats.enumerated()), id: \.element.id) { index, stat in
                if index > 0 {
                    Rectangle()
                        .fill(Color.primary.opacity(0.12))
                        .frame(width: JarvisNotesOverviewMetrics.hairline)
                        .accessibilityHidden(true)
                }
                VStack(spacing: 4) {
                    Text(JarvisNumberFormat.compact(stat.value, language: language))
                        .font(.title.weight(.semibold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Image(systemName: stat.systemImage)
                        .font(.subheadline)
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .accessibilityHidden(true)
                    Text(stat.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(stat.label), \(stat.value.formatted(.number.locale(language.locale)))")
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var folderBar: some View {
        GeometryReader { proxy in
            let total = CGFloat(max(1, shares.map(\.count).reduce(0, +)))
            let gaps = JarvisNotesOverviewMetrics.barGap * CGFloat(max(0, shares.count - 1))
            let available = max(0, proxy.size.width - gaps)
            HStack(spacing: JarvisNotesOverviewMetrics.barGap) {
                ForEach(Array(shares.enumerated()), id: \.element.id) { index, share in
                    Capsule()
                        .fill(color(index))
                        .frame(width: max(4, available * CGFloat(share.count) / total))
                }
            }
        }
        .frame(height: JarvisNotesOverviewMetrics.barHeight)
        .accessibilityHidden(true)
    }

    private var legend: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 110), spacing: JarvisPageHeaderMetrics.actionSpacing, alignment: .leading)],
            alignment: .leading,
            spacing: 4
        ) {
            ForEach(Array(shares.enumerated()), id: \.element.id) { index, share in
                HStack(spacing: 4) {
                    Circle().fill(color(index)).frame(width: 8, height: 8).accessibilityHidden(true)
                    Text(name(share)).lineLimit(1)
                    Text(JarvisNumberFormat.compact(share.count, language: language)).foregroundStyle(.secondary)
                }
                .font(.caption)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// A small horizontal strip of the latest notes, directly under the segmented bar.
struct JarvisNotesRecentStrip: View {
    let title: String
    let notes: [KnowledgeGraphNode]
    let onOpen: (KnowledgeGraphNode) -> Void

    var body: some View {
        if !notes.isEmpty {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                ScrollView(.horizontal) {
                    HStack(spacing: JarvisDesignTokens.notesChipSpacing) {
                        ForEach(notes) { note in
                            JarvisLabelledButton(title: note.title, identifier: "notes.recent.item") { onOpen(note) }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("notes.recent")
        }
    }
}

struct JarvisNotesHairline: View {
    var body: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.12))
            .frame(height: JarvisNotesOverviewMetrics.hairline)
            .accessibilityHidden(true)
    }
}
