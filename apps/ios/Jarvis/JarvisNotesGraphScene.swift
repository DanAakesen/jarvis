import JarvisCore
import SwiftUI

/// What one frame of the graph is drawn from. Built from the pure `JarvisCore` maths; the painter only draws it.
struct JarvisGraphFrame {
    let layout: JarvisGraphLayout
    let projector: JarvisGraphProjector
    let projected: [JarvisGraphProjectedNode]
    let focus: JarvisGraphFocus
    let pulses: [JarvisGraphPulse]
    let glows: [JarvisGraphGlow]
    let breath: [Double]
    let mode: JarvisGraphMotionMode
    let selected: Int?
}

/// Holds the camera and the clock between frames. The timeline and the gesture layer drive it from the main thread
/// only. It publishes nothing by itself: after changing it, the view calls `invalidate()` to draw a frame.
final class JarvisGraphDriver: ObservableObject {
    var controller = JarvisGraphCameraController()
    var viewport = JarvisGraphViewport(width: 0, height: 0)
    /// The notes as last drawn, so a tap tests what the owner sees.
    var projected: [JarvisGraphProjectedNode] = []
    var isInteracting = false
    /// Where the camera was before search moved it, so clearing search can go back.
    var cameraBeforeSearch: JarvisGraphCamera?

    private var lastDate: Date?
    private var motionTime = 0.0
    private var wasMoving = false
    private var focus: JarvisGraphFocus?
    private var focusKey: (selected: Int?, matches: Set<String>)?

    /// The timeline runs at full rate while something moves, and at the calm idle rate otherwise.
    var needsFrames: Bool { isInteracting || controller.isMoving }

    func invalidate() { objectWillChange.send() }

    /// A new layout replaces the old one: anything derived from the old notes and links is stale.
    func layoutChanged() {
        focus = nil
        focusKey = nil
        projected = []
    }

    func frame(
        at date: Date, layout: JarvisGraphLayout, schedule: JarvisGraphPulseSchedule, size: CGSize, selectedID: String?,
        selectionStart: Date, matches: Set<String>, mode: JarvisGraphMotionMode
    ) -> JarvisGraphFrame {
        let delta = lastDate.map { max(0, date.timeIntervalSince($0)) } ?? 0
        lastDate = date
        // Pausing and resuming never makes the drift jump: a long gap counts as one frame.
        if mode.drifts { motionTime += min(delta, 0.12) }
        viewport = JarvisGraphViewport(width: Double(size.width), height: Double(size.height))
        controller.advance(by: delta)
        if wasMoving && !controller.isMoving && !isInteracting {
            // Back to the calm idle rate.
            DispatchQueue.main.async { [weak self] in self?.invalidate() }
        }
        wasMoving = controller.isMoving

        let projector = JarvisGraphProjector(layoutRadius: layout.radius, camera: controller.camera, viewport: viewport)
        let projected = projector.project(layout, time: motionTime, mode: mode)
        self.projected = projected
        let selected = selectedID.flatMap { layout.indexByID[$0] }
        var pulses = schedule.pulses(at: motionTime)
        if let selected {
            pulses += JarvisGraphPulseSchedule.selectionPulses(
                layout: layout, selected: selected, elapsed: date.timeIntervalSince(selectionStart), mode: mode
            )
        }
        return JarvisGraphFrame(
            layout: layout, projector: projector, projected: projected,
            focus: focus(layout: layout, selected: selected, matches: matches),
            pulses: pulses, glows: schedule.glows(at: motionTime),
            breath: layout.nodes.map { JarvisGraphLife.breath(of: $0, time: motionTime, mode: mode) },
            mode: mode, selected: selected
        )
    }

    private func focus(layout: JarvisGraphLayout, selected: Int?, matches: Set<String>) -> JarvisGraphFocus {
        if let cached = focus, let key = focusKey, key.selected == selected, key.matches == matches,
           cached.nodes.count == layout.nodes.count, cached.edges.count == layout.edges.count {
            return cached
        }
        let made = JarvisGraphFocus(layout: layout, selected: selected, matches: matches)
        focus = made
        focusKey = (selected, matches)
        return made
    }
}

struct JarvisGraphStyle {
    let clusterColors: [Color]
    let clusterNames: [String]
    let neutral: Color
    let accent: Color
    let taskRing: Color
    let selectedTitle: String?
    /// Search matches that get a plain label, nearest the viewer first.
    let matchTitles: [Int: String]

    func color(forCluster index: Int) -> Color {
        clusterColors.indices.contains(index) ? clusterColors[index] : neutral
    }
}

/// Draws the projected graph with batched paths: lines and dots are merged by colour and opacity level, so a frame is
/// a few dozen draw operations however many notes there are.
enum JarvisGraphPainter {
    private static let levels = 8

    private struct EdgeKey: Hashable {
        let colour: Int
        let level: Int
        let thin: Bool
        let strong: Bool
    }

    private struct NodeKey: Hashable {
        let colour: Int
        let level: Int
    }

    private static func level(_ value: Double) -> Int {
        max(1, min(levels, Int((min(max(value, 0), 1) * Double(levels)).rounded())))
    }

    private static func isOffscreen(_ x: Double, _ y: Double, _ size: CGSize, margin: Double = 24) -> Bool {
        x < -margin || y < -margin || x > Double(size.width) + margin || y > Double(size.height) + margin
    }

    /// A link is skipped only when both ends lie beyond the same side of the view; one that crosses it is drawn.
    private static func isOutsideTogether(
        _ a: JarvisGraphProjectedNode, _ b: JarvisGraphProjectedNode, _ size: CGSize, margin: Double
    ) -> Bool {
        let width = Double(size.width), height = Double(size.height)
        return (a.x < -margin && b.x < -margin) || (a.x > width + margin && b.x > width + margin)
            || (a.y < -margin && b.y < -margin) || (a.y > height + margin && b.y > height + margin)
    }

    static func paint(_ context: inout GraphicsContext, size: CGSize, frame: JarvisGraphFrame, style: JarvisGraphStyle) {
        if frame.mode.usesGlow { paintHaze(&context, frame: frame, style: style) }
        paintEdges(&context, size: size, frame: frame, style: style)
        paintNodes(&context, size: size, frame: frame, style: style)
        paintPulses(&context, frame: frame, style: style)
        paintSelection(&context, frame: frame, style: style)
        paintLabels(&context, size: size, frame: frame, style: style)
    }

    /// A faint soft volume behind each folder's notes.
    private static func paintHaze(_ context: inout GraphicsContext, frame: JarvisGraphFrame, style: JarvisGraphStyle) {
        for (index, cluster) in frame.layout.clusters.enumerated() {
            let p = frame.projector.project(cluster.center)
            let radius = cluster.radius * frame.projector.pointsPerUnit(perspective: p.perspective) * 1.1
            let center = CGPoint(x: p.x, y: p.y)
            let color = style.color(forCluster: index)
            let opacity = 0.16 * (1 - 0.5 * p.depth)
            context.fill(
                Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)),
                with: .radialGradient(
                    Gradient(colors: [color.opacity(opacity), color.opacity(0)]),
                    center: center, startRadius: 0, endRadius: radius
                )
            )
        }
    }

    private static func paintEdges(_ context: inout GraphicsContext, size: CGSize, frame: JarvisGraphFrame, style: JarvisGraphStyle) {
        let layout = frame.layout
        var paths: [EdgeKey: Path] = [:]
        for (index, edge) in layout.edges.enumerated() {
            let a = frame.projected[edge.source], b = frame.projected[edge.target]
            if isOutsideTogether(a, b, size, margin: 40) { continue }
            let sourceCluster = layout.nodes[edge.source].cluster
            let sameCluster = sourceCluster == layout.nodes[edge.target].cluster
            let emphasised = frame.focus.isFocused && frame.focus.edges[index]
            var opacity = (edge.kind == .link ? 0.30 : 0.13) * min(a.opacity, b.opacity)
            if frame.focus.isFocused { opacity *= emphasised ? 2.4 : 0.3 }
            let key = EdgeKey(
                colour: sameCluster ? sourceCluster : layout.clusters.count,
                level: level(min(opacity, 0.8) / 0.8), thin: edge.kind == .similar, strong: emphasised
            )
            paths[key, default: Path()].move(to: CGPoint(x: a.x, y: a.y))
            paths[key, default: Path()].addLine(to: CGPoint(x: b.x, y: b.y))
        }
        for (key, path) in paths.sorted(by: { $0.key.level < $1.key.level }) {
            context.stroke(
                path,
                with: .color(style.color(forCluster: key.colour).opacity(Double(key.level) / Double(levels) * 0.8)),
                lineWidth: key.strong ? 1.5 : key.thin ? 0.6 : 1
            )
        }
    }

    private static func paintNodes(_ context: inout GraphicsContext, size: CGSize, frame: JarvisGraphFrame, style: JarvisGraphStyle) {
        let layout = frame.layout
        var fills: [NodeKey: Path] = [:]
        var rings: [Int: Path] = [:]
        for (index, node) in layout.nodes.enumerated() where index != frame.selected {
            let p = frame.projected[index]
            if isOffscreen(p.x, p.y, size, margin: p.radius + 6) { continue }
            let factor: Double
            switch frame.focus.nodes[index] {
            case .dimmed: factor = 0.28
            case .neighbour: factor = 0.9
            default: factor = 1
            }
            let visible = level(min(p.opacity * factor * frame.breath[index], 1))
            let rect = CGRect(x: p.x - p.radius, y: p.y - p.radius, width: p.radius * 2, height: p.radius * 2)
            fills[NodeKey(colour: node.cluster, level: visible), default: Path()].addEllipse(in: rect)
            if node.hasOpenTasks {
                rings[visible, default: Path()].addEllipse(in: rect.insetBy(dx: -3.5, dy: -3.5))
            }
        }
        for (key, path) in fills.sorted(by: { $0.key.level < $1.key.level }) {
            context.fill(path, with: .color(style.color(forCluster: key.colour).opacity(Double(key.level) / Double(levels))))
        }
        for (key, path) in rings.sorted(by: { $0.key < $1.key }) {
            context.stroke(path, with: .color(style.taskRing.opacity(Double(key) / Double(levels))), lineWidth: 1.5)
        }
    }

    private static func glow(_ context: inout GraphicsContext, at point: CGPoint, radius: CGFloat, color: Color, strength: Double) {
        context.fill(
            Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)),
            with: .radialGradient(
                Gradient(colors: [color.opacity(0.55 * strength), color.opacity(0)]),
                center: point, startRadius: 0, endRadius: radius
            )
        )
    }

    private static func paintPulses(_ context: inout GraphicsContext, frame: JarvisGraphFrame, style: JarvisGraphStyle) {
        guard frame.mode != .still else { return }
        let layout = frame.layout
        if frame.mode.usesGlow {
            for item in frame.glows where frame.projected.indices.contains(item.node) {
                let p = frame.projected[item.node]
                glow(&context, at: CGPoint(x: p.x, y: p.y), radius: p.radius * 4, color: style.color(forCluster: layout.nodes[item.node].cluster), strength: item.strength)
            }
        }
        for pulse in frame.pulses where frame.projected.indices.contains(pulse.from) && frame.projected.indices.contains(pulse.to) {
            let a = frame.projected[pulse.from], b = frame.projected[pulse.to]
            func point(_ t: Double) -> CGPoint { CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t) }
            let head = point(pulse.progress)
            var trail = Path()
            trail.move(to: point(max(0, pulse.progress - 0.28)))
            trail.addLine(to: head)
            let fade = sin(pulse.progress * Double.pi) * pulse.strength * min(a.opacity, b.opacity)
            let color = style.color(forCluster: layout.nodes[pulse.from].cluster)
            context.stroke(trail, with: .color(color.opacity(0.85 * fade)), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
            if frame.mode.usesGlow {
                glow(&context, at: head, radius: 9, color: color, strength: fade)
            } else {
                context.fill(Path(ellipseIn: CGRect(x: head.x - 2, y: head.y - 2, width: 4, height: 4)), with: .color(color.opacity(fade)))
            }
        }
    }

    private static func paintSelection(_ context: inout GraphicsContext, frame: JarvisGraphFrame, style: JarvisGraphStyle) {
        guard let selected = frame.selected, frame.projected.indices.contains(selected) else { return }
        let p = frame.projected[selected]
        let center = CGPoint(x: p.x, y: p.y)
        let radius = p.radius * 1.25
        let color = style.color(forCluster: frame.layout.nodes[selected].cluster)
        if frame.mode.usesGlow { glow(&context, at: center, radius: radius * 4.5, color: color, strength: 1) }
        let disc = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
        context.fill(disc, with: .color(color))
        if frame.layout.nodes[selected].hasOpenTasks {
            context.stroke(
                Path(ellipseIn: CGRect(x: center.x - radius - 3.5, y: center.y - radius - 3.5, width: (radius + 3.5) * 2, height: (radius + 3.5) * 2)),
                with: .color(style.taskRing), lineWidth: 1.5
            )
        }
        context.stroke(
            Path(ellipseIn: CGRect(x: center.x - radius - 7, y: center.y - radius - 7, width: (radius + 7) * 2, height: (radius + 7) * 2)),
            with: .color(style.accent), lineWidth: 2
        )
    }

    private static func paintLabels(_ context: inout GraphicsContext, size: CGSize, frame: JarvisGraphFrame, style: JarvisGraphStyle) {
        let width = Double(size.width), height = Double(size.height)
        for (index, cluster) in frame.layout.clusters.enumerated() where style.clusterNames.indices.contains(index) {
            let p = frame.projector.project(cluster.center)
            let radius = cluster.radius * frame.projector.pointsPerUnit(perspective: p.perspective)
            let text = Text(verbatim: style.clusterNames[index])
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.primary.opacity(0.92 - 0.4 * p.depth))
            let resolved = context.resolve(text)
            let measured = resolved.measure(in: CGSize(width: 180, height: 30))
            let x = min(max(p.x, Double(measured.width) / 2 + 6), width - Double(measured.width) / 2 - 6)
            let y = min(max(p.y - radius * 0.85 - 6, Double(measured.height) / 2 + 4), height - Double(measured.height) / 2 - 4)
            context.draw(resolved, at: CGPoint(x: x, y: y), anchor: .center)
        }
        for (index, title) in style.matchTitles.sorted(by: { $0.key < $1.key }) where frame.projected.indices.contains(index) && index != frame.selected {
            let p = frame.projected[index]
            let text = Text(verbatim: title).font(.caption2).foregroundStyle(Color.primary.opacity(0.85))
            context.draw(context.resolve(text), at: CGPoint(x: p.x, y: p.y + p.radius + 9), anchor: .center)
        }
        if let selected = frame.selected, let title = style.selectedTitle, frame.projected.indices.contains(selected) {
            let p = frame.projected[selected]
            let resolved = context.resolve(Text(verbatim: title).font(.caption.weight(.semibold)).foregroundStyle(style.accent))
            let measured = resolved.measure(in: CGSize(width: 200, height: 30))
            let pill = CGSize(width: measured.width + 18, height: measured.height + 8)
            let x = min(max(p.x, Double(pill.width) / 2 + 6), width - Double(pill.width) / 2 - 6)
            let y = max(p.y - p.radius * 1.25 - 26, Double(pill.height) / 2 + 4)
            let rect = CGRect(x: x - Double(pill.width) / 2, y: y - Double(pill.height) / 2, width: pill.width, height: pill.height)
            context.fill(Path(roundedRect: rect, cornerRadius: pill.height / 2), with: .color(Color.black.opacity(0.55)))
            context.stroke(Path(roundedRect: rect, cornerRadius: pill.height / 2), with: .color(style.accent.opacity(0.6)), lineWidth: 1)
            context.draw(resolved, at: CGPoint(x: x, y: y), anchor: .center)
        }
    }
}
