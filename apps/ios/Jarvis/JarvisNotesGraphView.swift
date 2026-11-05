import JarvisCore
import SwiftUI

struct JarvisNotesGraphView: View {
    let graph: KnowledgeGraph
    let copy: JarvisNotesCopy
    let onOpen: (KnowledgeGraphNode) async -> Void
    var searchMatches: Set<String> = []

    @State private var selectedNodeID: String?
    @State private var scale: CGFloat = 1
    @State private var startingScale: CGFloat = 1
    @State private var offset = CGSize.zero
    @State private var startingOffset = CGSize.zero

    private var selectedNeighbours: Set<String> {
        guard let selectedNodeID else { return [] }
        return JarvisNotesLogic.connectedIDs(in: graph, to: selectedNodeID)
    }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            ScrollView(.horizontal) {
                HStack(spacing: JarvisPageHeaderMetrics.spacing) {
                    ForEach(JarvisNotesPresentation.folderShares(graph)) { share in
                        HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                            Circle().fill(JarvisNotesFolderPalette.color(share.folder))
                                .frame(width: JarvisDesignTokens.notesChipSpacing, height: JarvisDesignTokens.notesChipSpacing)
                            Text(share.folder.isEmpty ? copy.vaultRoot : share.folder)
                        }
                        .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .scrollIndicators(.hidden)
            graphCanvas
            if let selected = graph.nodes.first(where: { $0.id == selectedNodeID }) {
                HStack {
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        Text(selected.title).font(.subheadline.weight(.semibold))
                        Text(selected.directory.isEmpty ? copy.vaultRoot : selected.directory)
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    JarvisTextButton(title: copy.openNote, identifier: "notes.graph.open") { Task { await onOpen(selected) } }
                }
                .padding(JarvisPageHeaderMetrics.heroInset)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
                .accessibilityIdentifier("notes.graph.selection")
            }
        }
    }

    private var graphCanvas: some View {
        GeometryReader { geometry in
            let positions = JarvisNotesPresentation.graphPositions(graph)
            ZStack {
                Canvas { context, size in
                    for edge in graph.edges {
                        guard let source = positions[edge.source], let target = positions[edge.target] else { continue }
                        var path = Path()
                        path.move(to: CGPoint(x: source.x * size.width, y: source.y * size.height))
                        path.addLine(to: CGPoint(x: target.x * size.width, y: target.y * size.height))
                        let emphasized = selectedNodeID == nil
                            || selectedNodeID == edge.source
                            || selectedNodeID == edge.target
                            || selectedNeighbours.contains(edge.source)
                            || selectedNeighbours.contains(edge.target)
                        context.stroke(
                            path,
                            with: .color(Color.secondary.opacity(
                                emphasized
                                    ? JarvisDesignTokens.notesGraphEmphasizedOpacity
                                    : JarvisDesignTokens.notesGraphDimmedOpacity
                            )),
                            lineWidth: JarvisDesignTokens.notesGraphEdgeWidth
                        )
                    }
                }
                ForEach(graph.nodes) { node in
                    if let position = positions[node.id] {
                        graphNode(node)
                            .position(x: position.x * geometry.size.width, y: position.y * geometry.size.height)
                    }
                }
            }
            .scaleEffect(scale)
            .offset(offset)
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        offset = CGSize(
                            width: startingOffset.width + value.translation.width,
                            height: startingOffset.height + value.translation.height
                        )
                    }
                    .onEnded { _ in startingOffset = offset }
            )
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { value in
                        scale = min(
                            max(
                                startingScale * value.magnification,
                                JarvisDesignTokens.notesGraphMinimumZoom
                            ),
                            JarvisDesignTokens.notesGraphMaximumZoom
                        )
                    }
                    .onEnded { _ in startingScale = scale }
            )
            .accessibilityLabel(copy.graph)
            .accessibilityHint(copy.graphPanZoomHint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }

    private func graphNode(_ node: KnowledgeGraphNode) -> some View {
        Button {
            selectedNodeID = selectedNodeID == node.id ? nil : node.id
        } label: {
            ZStack {
                Circle()
                    .fill(nodeColor(node))
                    .overlay {
                        Circle()
                            .strokeBorder(
                                node.id == selectedNodeID ? Color.accentColor : Color.clear,
                                lineWidth: JarvisDesignTokens.notesGraphSelectionStroke
                            )
                    }
                    .frame(
                        width: JarvisDesignTokens.notesGraphNodeRadius * 2,
                        height: JarvisDesignTokens.notesGraphNodeRadius * 2
                    )
            }
            .frame(minWidth: JarvisDesignTokens.controlMinimumHeight, minHeight: JarvisDesignTokens.controlMinimumHeight)
            .overlay(alignment: .center) {
                if selectedNodeID == node.id || searchMatches.contains(node.id) {
                    Text(node.title)
                        .font(.caption2)
                        .foregroundStyle(nodeTextColor(node))
                        .lineLimit(1)
                        .frame(width: JarvisDesignTokens.notesGraphNodeLabelWidth)
                        .offset(y: JarvisDesignTokens.notesGraphLabelOffset)
                        .allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(node.title)
        .accessibilityValue(node.folder.isEmpty ? copy.vaultRoot : node.folder)
        .accessibilityAction(named: copy.openNote) { Task { await onOpen(node) } }
        .accessibilityAddTraits(selectedNodeID == node.id ? .isSelected : [])
        .accessibilityIdentifier("notes.graph.node.\(node.id)")
    }

    private func nodeColor(_ node: KnowledgeGraphNode) -> Color {
        let color = JarvisNotesFolderPalette.color(node.folder)
        if !searchMatches.isEmpty { return color.opacity(searchMatches.contains(node.id) ? 1 : JarvisDesignTokens.notesGraphNodeOpacity) }
        guard let selectedNodeID else { return color }
        if node.id == selectedNodeID { return color }
        if selectedNeighbours.contains(node.id) {
            return color.opacity(JarvisDesignTokens.notesGraphNeighbourOpacity)
        }
        return color.opacity(JarvisDesignTokens.notesGraphNodeOpacity)
    }

    private func nodeTextColor(_ node: KnowledgeGraphNode) -> Color {
        guard let selectedNodeID else { return Color.primary }
        return node.id == selectedNodeID || selectedNeighbours.contains(node.id)
            ? Color.primary
            : Color.secondary
    }
}
