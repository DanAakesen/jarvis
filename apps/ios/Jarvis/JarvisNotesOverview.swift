import JarvisCore
import SwiftUI

enum JarvisNotesFolderPalette {
    static func color(_ folder: String) -> Color {
        switch folder.split(separator: "/").first?.lowercased() {
        case "work": JarvisDesignTokens.primaryAccent
        case "personal": JarvisDesignTokens.notesFolderPersonal
        case "people": JarvisDesignTokens.ambientWarm
        default: Color.secondary
        }
    }
}

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

    private func color(_ index: Int) -> Color { JarvisNotesFolderPalette.color(shares[index].folder) }

    private func name(_ share: JarvisNotesFolderShare) -> String {
        share.folder.isEmpty ? rootTitle : share.folder
    }

    var body: some View {
        JarvisPageHeroCard(title: title) {
            Text("\(linkCount.map { JarvisNumberFormat.compact($0, language: language) } ?? "—") \(linksLabel)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("notes.hero.links")
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
                    if let value = stat.value {
                        Text(JarvisNumberFormat.compact(value, language: language))
                            .font(.title.weight(.semibold))
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    } else if stat.isLoading {
                        JarvisLoadingView(title: JarvisNotesCopy(language: language).loading, size: .inline)
                    } else {
                        Text("—").font(.title.weight(.semibold))
                    }
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
                .accessibilityLabel("\(stat.label), \(stat.value.map { $0.formatted(.number.locale(language.locale)) } ?? (stat.isLoading ? JarvisNotesCopy(language: language).loading : JarvisNotesCopy(language: language).unavailable))")
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
    let visits: [JarvisNoteVisit]
    let language: JarvisAppLanguage
    let onOpen: (KnowledgeGraphNode) -> Void

    var body: some View {
        if !notes.isEmpty {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
                JarvisSectionHeadline(title)
                ScrollView(.horizontal) {
                    HStack(spacing: JarvisDesignTokens.notesChipSpacing) {
                        ForEach(notes) { note in
                            JarvisContentTileButton(identifier: "notes.recent.\(note.path)",
                                             width: JarvisDesignTokens.notesRecentTileWidth, action: { onOpen(note) }) {
                                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                                    Text(note.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                                    HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                                        Circle().fill(JarvisNotesFolderPalette.color(note.folder))
                                            .frame(width: JarvisDesignTokens.notesChipSpacing, height: JarvisDesignTokens.notesChipSpacing)
                                        Text(note.directory.isEmpty ? JarvisNotesLocalization.string(.vaultRoot, language: language) : note.directory)
                                            .lineLimit(1)
                                    }
                                    .font(.caption).foregroundStyle(.secondary)
                                    if let visit = visits.first(where: { $0.path == note.path }) {
                                        Text(visit.openedAt.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(language.locale)))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                }

                            }

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
