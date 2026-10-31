import JarvisCore
import SwiftUI

struct JarvisNotesGraphView: View {
    let graph: KnowledgeGraph
    let copy: JarvisNotesCopy
    let onOpen: (KnowledgeGraphNode) async -> Void

    @State private var selectedNodeID: String?
    @State private var showingList = false
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
            HStack {
                Spacer()
                Button {
                    showingList.toggle()
                } label: {
                    Label(
                        showingList ? copy.showGraph : copy.showGraphList,
                        systemImage: showingList ? "point.3.connected.trianglepath.dotted" : "list.bullet"
                    )
                    .font(.subheadline)
                }
                .buttonStyle(.glass)
                .accessibilityLabel(showingList ? copy.showGraph : copy.showGraphList)
            }
            if showingList {
                graphList
            } else {
                graphCanvas
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

    private var graphList: some View {
        JarvisList {
            ForEach(graph.nodes) { node in
                Button {
                    selectedNodeID = node.id
                    Task { await onOpen(node) }
                } label: {
                    HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                        Circle()
                            .fill(nodeColor(node))
                            .frame(
                                width: JarvisDesignTokens.notesGraphNodeRadius * 2,
                                height: JarvisDesignTokens.notesGraphNodeRadius * 2
                            )
                        Text(node.title)
                            .foregroundStyle(nodeTextColor(node))
                        Spacer()
                        Text(node.folder.isEmpty ? copy.vaultRoot : node.folder)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(minHeight: JarvisDesignTokens.notesRowMinimumHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(node.title)
                .accessibilityValue(node.folder)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func graphNode(_ node: KnowledgeGraphNode) -> some View {
        Button {
            selectedNodeID = node.id
            Task { await onOpen(node) }
        } label: {
            VStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
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
                Text(node.title)
                    .font(.caption2)
                    .foregroundStyle(nodeTextColor(node))
                    .lineLimit(1)
                    .frame(maxWidth: JarvisDesignTokens.notesGraphNodeLabelWidth)
            }
            .padding(JarvisDesignTokens.notesEditorInset)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(node.title)
        .accessibilityValue(node.folder.isEmpty ? copy.vaultRoot : node.folder)
        .accessibilityHint(copy.openNote)
    }

    private func nodeColor(_ node: KnowledgeGraphNode) -> Color {
        guard let selectedNodeID else { return Color.secondary }
        if node.id == selectedNodeID { return Color.accentColor }
        if selectedNeighbours.contains(node.id) {
            return Color.accentColor.opacity(JarvisDesignTokens.notesGraphNeighbourOpacity)
        }
        return Color.secondary.opacity(JarvisDesignTokens.notesGraphNodeOpacity)
    }

    private func nodeTextColor(_ node: KnowledgeGraphNode) -> Color {
        guard let selectedNodeID else { return Color.primary }
        return node.id == selectedNodeID || selectedNeighbours.contains(node.id)
            ? Color.primary
            : Color.secondary
    }
}
