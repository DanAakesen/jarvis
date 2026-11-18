import Foundation

public enum JarvisGraphEmphasis: Equatable, Sendable {
    case normal
    case selected
    case neighbour
    case matched
    case dimmed
}

/// Which notes and links stand out when a note is selected or search has matches. Nothing is added or inferred.
public struct JarvisGraphFocus: Equatable, Sendable {
    public let nodes: [JarvisGraphEmphasis]
    /// Per layout edge: it touches the selected note or a match.
    public let edges: [Bool]
    public let isFocused: Bool

    public init(layout: JarvisGraphLayout, selected: Int?, matches: Set<String>) {
        let selected = selected.flatMap { layout.nodes.indices.contains($0) ? $0 : nil }
        let matched = Set(matches.compactMap { layout.indexByID[$0] })
        let isFocused = selected != nil || !matched.isEmpty
        self.isFocused = isFocused
        guard isFocused else {
            nodes = [JarvisGraphEmphasis](repeating: .normal, count: layout.nodes.count)
            edges = [Bool](repeating: true, count: layout.edges.count)
            return
        }
        let neighbours = Set(selected.map { layout.neighbours(of: $0) } ?? [])
        nodes = layout.nodes.indices.map { index in
            if index == selected { return .selected }
            if matched.contains(index) { return .matched }
            if neighbours.contains(index) { return .neighbour }
            return .dimmed
        }
        edges = layout.edges.map { edge in
            edge.source == selected || edge.target == selected || matched.contains(edge.source) || matched.contains(edge.target)
        }
    }
}

public enum JarvisGraphHitTest {
    /// Half of the 44 pt minimum touch target.
    public static let touchRadius = 22.0
    /// Notes this close together on screen count as overlapping, and the one nearer the viewer comes first.
    static let overlapTolerance = 10.0

    /// Every note within reach of a touch, best first: the closest to the finger, but among notes that overlap there
    /// the one nearest the viewer. Tapping the same spot again walks on through the list, so notes hidden behind
    /// another one stay selectable.
    public static func candidates(
        atX x: Double, y: Double, in nodes: [JarvisGraphProjectedNode], touchRadius: Double = touchRadius
    ) -> [Int] {
        let hits = nodes.compactMap { node -> (index: Int, distance: Double, depth: Double)? in
            let distance = ((node.x - x) * (node.x - x) + (node.y - y) * (node.y - y)).squareRoot()
            return distance <= max(touchRadius, node.radius) ? (node.index, distance, node.depth) : nil
        }
        guard let closest = hits.map(\.distance).min() else { return [] }
        let overlapping = hits.filter { $0.distance <= closest + overlapTolerance }
            .sorted { $0.depth != $1.depth ? $0.depth < $1.depth : $0.index < $1.index }
        let rest = hits.filter { $0.distance > closest + overlapTolerance }
            .sorted { $0.distance != $1.distance ? $0.distance < $1.distance : $0.index < $1.index }
        return (overlapping + rest).map(\.index)
    }

    /// The selection after a tap: nothing under the finger clears it, a new spot picks the best note, and the same
    /// spot again moves to the next note behind (or clears when there is only one).
    public static func selection(afterTapWith candidates: [Int], current: Int?) -> Int? {
        guard let first = candidates.first else { return nil }
        guard let current, let position = candidates.firstIndex(of: current) else { return first }
        guard candidates.count > 1 else { return nil }
        return candidates[(position + 1) % candidates.count]
    }
}

public enum JarvisGraphTaskSummary: Equatable, Sendable {
    case open(Int)
    case none
    /// The service did not report a count for this note; nothing is guessed.
    case unavailable

    public init(openTaskCount: Int?) {
        switch openTaskCount {
        case .some(let count) where count > 0: self = .open(count)
        case .some: self = .none
        case .none: self = .unavailable
        }
    }
}
