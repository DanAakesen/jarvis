import Foundation

/// How strongly the graph draws a link. One place for the numbers, so the painter and its test agree. Links must be
/// easy to follow, yet always quieter than the notes they join, so two notes close together still read as two dots.
public enum JarvisGraphLinkStyle {
    /// The strongest a stroke ever gets; notes are drawn at full strength, so links never outshine them.
    public static let ceiling = 0.8
    /// Resting strength of an explicit link, before the fade with distance.
    static let linkStrength = 0.5
    /// A similarity line is a hint, not a link.
    static let similarStrength = 0.2
    /// With a selection or search active, the links that matter and the links that do not.
    static let emphasisFactor = 1.6
    static let dimFactor = 0.3

    public static let linkWidth = 1.2
    public static let similarWidth = 0.7
    public static let emphasisedWidth = 1.7

    /// Stroke opacity for one link, from 0 to `ceiling`. `endpointOpacity` is the fainter end's depth fade.
    public static func opacity(
        kind: KnowledgeGraphEdge.Kind, endpointOpacity: Double, isFocused: Bool, isEmphasised: Bool
    ) -> Double {
        var value = (kind == .link ? linkStrength : similarStrength) * min(max(endpointOpacity, 0), 1)
        if isFocused { value *= isEmphasised ? emphasisFactor : dimFactor }
        return min(value, ceiling)
    }
}

/// Where the selected note's name pill sits over the scene. The pill is as wide as its text needs up to a limit, then
/// wraps onto more lines and grows taller, so a long title is never wider than its border.
public enum JarvisGraphPillPlacement {
    public static let edgeMargin = 6.0
    public static let widestPill = 280.0
    /// Space between the selected note's ring and the pill.
    public static let gap = 8.0
    /// The selection ring sits 7 points outside the note's disc, which is drawn 1.25 times its radius.
    static let ringOffset = 7.0

    /// The widest the pill may be in a scene of this width.
    public static func maximumWidth(sceneWidth: Double) -> Double {
        max(0, min(widestPill, sceneWidth - 2 * edgeMargin))
    }

    /// The pill's top-left corner: above the note and centred on it, kept inside the scene, and below the note when
    /// there is no room above.
    public static func origin(
        noteX: Double, noteY: Double, noteRadius: Double,
        pillWidth: Double, pillHeight: Double, sceneWidth: Double, sceneHeight: Double
    ) -> (x: Double, y: Double) {
        let reach = noteRadius * 1.25 + ringOffset + gap
        let x = min(max(noteX - pillWidth / 2, edgeMargin), max(edgeMargin, sceneWidth - pillWidth - edgeMargin))
        let above = noteY - reach - pillHeight
        let below = noteY + reach
        let top = above >= edgeMargin || below + pillHeight > sceneHeight - edgeMargin ? above : below
        return (x, max(top, edgeMargin))
    }
}
