import JarvisCore
import SwiftUI

/// The Notes graph as a 3D scene: the vault's real notes and links, grouped in space by folder. Two fingers turn and
/// tilt it, a pinch zooms, a tap selects (tapping the same spot again reaches notes hidden behind), and the selected
/// note's preview above the dock opens the reader. The maths lives in `JarvisCore` (`JarvisGraphLayout`,
/// `JarvisGraphProjector`, `JarvisGraphLife`); this file is state, gestures and layout, `JarvisGraphPainter` draws.
struct JarvisNotesGraphView: View {
    let graph: KnowledgeGraph
    let copy: JarvisNotesCopy
    let onOpen: (KnowledgeGraphNode) async -> Void
    let onShowList: () -> Void
    var searchMatches: Set<String> = []
    /// Changes when the owner asks to recenter from the page menu.
    var recenterToken = 0

    private struct Prepared {
        let graph: KnowledgeGraph
        let layout: JarvisGraphLayout
        let nodesByID: [String: KnowledgeGraphNode]
        let calm: JarvisGraphPulseSchedule
        let cheap: JarvisGraphPulseSchedule
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(JarvisNeuralEffects.motionEnabledKey) private var motionEnabled = true
    @State private var prepared: Prepared?
    @State private var selectedID: String?
    @State private var selectionStart = Date.distantPast
    @State private var isCheap = JarvisNeuralRendering.usesCheapPath
    @State private var isVisible = true
    @StateObject private var driver = JarvisGraphDriver()
    @State private var focusFeedback = 0

    private var motionMode: JarvisGraphMotionMode {
        JarvisGraphMotionMode(reduceMotion: reduceMotion, motionEnabled: motionEnabled, lowPower: isCheap)
    }

    /// The prepared scene, only while it still belongs to the graph on screen.
    private var current: Prepared? {
        guard let prepared, prepared.graph == graph else { return nil }
        return prepared
    }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
            legend
            // The preview floats over the bottom of the scene, so showing it never resizes the scene or moves a note.
            scene.overlay(alignment: .bottom) {
                if let prepared = current, let id = selectedID, let node = prepared.nodesByID[id] {
                    preview(node)
                }
            }
        }
        .task(id: graph) { await prepare() }
        .onChange(of: searchMatches) { _, matches in focusSearch(matches) }
        .onChange(of: recenterToken) { recenter() }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            isCheap = JarvisNeuralRendering.usesCheapPath
        }
        .sensoryFeedback(.impact(weight: .light), trigger: focusFeedback)
    }

    // MARK: Legend

    @ViewBuilder
    private var legend: some View {
        if let layout = current?.layout {
            ScrollView(.horizontal) {
                HStack(spacing: JarvisPageHeaderMetrics.spacing) {
                    ForEach(legendClusters(layout), id: \.key) { cluster in
                        HStack(spacing: JarvisDesignTokens.notesInlineSpacing) {
                            Circle().fill(JarvisNotesGraphPalette.color(cluster.scope))
                                .frame(width: JarvisDesignTokens.notesChipSpacing, height: JarvisDesignTokens.notesChipSpacing)
                            Text(name(of: cluster))
                        }
                        .font(.caption).foregroundStyle(.secondary)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private func legendClusters(_ layout: JarvisGraphLayout) -> [JarvisGraphLayout.Cluster] {
        layout.clusters.sorted { $0.count != $1.count ? $0.count > $1.count : $0.key < $1.key }
    }

    private func name(of cluster: JarvisGraphLayout.Cluster) -> String {
        cluster.key.isEmpty ? copy.vaultRoot : cluster.key
    }

    // MARK: Scene

    @ViewBuilder
    private var scene: some View {
        if let prepared = current {
            GeometryReader { geometry in
                ZStack {
                    timeline(prepared, size: geometry.size)
                    gestureLayer(prepared)
                }
                .onChange(of: geometry.size, initial: true) { _, size in
                    // Search matches that arrived before the scene had a size are framed as soon as it has one.
                    driver.viewport = JarvisGraphViewport(width: Double(size.width), height: Double(size.height))
                    if !searchMatches.isEmpty && driver.cameraBeforeSearch == nil { focusSearch(searchMatches) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(copy.graphAccessibilityLabel(noteCount: prepared.layout.nodes.count))
                .accessibilityHint(copy.graphPanZoomHint)
                .accessibilityIdentifier("notes.graph.canvas")
                .accessibilityAction(named: copy[.list]) { onShowList() }
                .accessibilityAction(named: copy[.recenter]) { recenter() }
                .accessibilityAction(named: copy[.graphRotateLeft]) { nudge(yaw: 0.35, pitch: 0) }
                .accessibilityAction(named: copy[.graphRotateRight]) { nudge(yaw: -0.35, pitch: 0) }
                .accessibilityAction(named: copy[.graphTiltUp]) { nudge(yaw: 0, pitch: 0.25) }
                .accessibilityAction(named: copy[.graphTiltDown]) { nudge(yaw: 0, pitch: -0.25) }
                .accessibilityAction(named: copy[.graphZoomIn]) { nudgeZoom(1.4) }
                .accessibilityAction(named: copy[.graphZoomOut]) { nudgeZoom(1 / 1.4) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
        } else {
            JarvisLoadingView(title: copy.loading)
        }
    }

    private func timeline(_ prepared: Prepared, size: CGSize) -> some View {
        let activeMode = motionMode
        let moving = driver.needsFrames
        let interval: Double? = moving ? nil : activeMode.idleFrameInterval
        // Nothing runs while the app is inactive, the page is covered, or the graph is still and untouched.
        let paused = scenePhase != .active || !isVisible || (activeMode == .still && !moving)
        return TimelineView(.animation(minimumInterval: interval, paused: paused)) { timeline in
            let frame = driver.frame(
                at: timeline.date, layout: prepared.layout,
                schedule: activeMode == .cheap ? prepared.cheap : prepared.calm,
                size: size, selectedID: selectedID, selectionStart: selectionStart, matches: searchMatches,
                mode: activeMode
            )
            let style = style(for: prepared)
            Canvas { context, canvasSize in
                JarvisGraphPainter.paint(&context, size: canvasSize, frame: frame, style: style)
            }
        }
    }

    private func style(for prepared: Prepared) -> JarvisGraphStyle {
        let layout = prepared.layout
        var titles: [Int: String] = [:]
        for (index, node) in layout.nodes.enumerated() where searchMatches.contains(node.id) && titles.count < 6 {
            if let title = prepared.nodesByID[node.id]?.title { titles[index] = title }
        }
        return JarvisGraphStyle(
            clusterColors: layout.clusters.map { JarvisNotesGraphPalette.color($0.scope) },
            clusterNames: layout.clusters.map { name(of: $0) },
            neutral: Color.secondary,
            accent: JarvisDesignTokens.primaryAccent,
            taskRing: JarvisDesignTokens.notesTaskRing,
            selectedTitle: selectedID.flatMap { prepared.nodesByID[$0]?.title },
            matchTitles: titles
        )
    }

    // MARK: Gestures

    private func gestureLayer(_ prepared: Prepared) -> some View {
        JarvisGraphGestureLayer(
            onTouchDown: {
                // A finger on the glass stops a glide or flight at once; a tap then tests the graph the owner sees.
                guard driver.controller.isMoving else { return }
                driver.controller.beginInteraction()
                driver.invalidate()
            },
            onBegan: {
                driver.controller.beginInteraction()
                driver.isInteracting = true
                driver.invalidate()
            },
            onOrbit: { delta in
                let k = turnPerPoint
                driver.controller.orbit(yaw: -Double(delta.width) * k, pitch: -Double(delta.height) * k)
                driver.invalidate()
            },
            onTwist: { radians in
                driver.controller.orbit(yaw: -Double(radians), pitch: 0)
                driver.invalidate()
            },
            onPan: { delta in
                driver.controller.pan(dx: Double(delta.width), dy: Double(delta.height))
                driver.invalidate()
            },
            onPinch: { scale, point in
                driver.controller.zoom(
                    by: Double(scale), anchorX: Double(point.x), anchorY: Double(point.y), in: driver.viewport
                )
                driver.invalidate()
            },
            onEnded: { velocity in
                driver.isInteracting = false
                let k = turnPerPoint
                driver.controller.release(
                    yawVelocity: -Double(velocity.width) * k, pitchVelocity: -Double(velocity.height) * k,
                    allowsInertia: motionMode.allowsInertia
                )
                driver.invalidate()
            },
            onTap: { point in tap(at: point, in: prepared) },
            onLongPress: { point in focusNeighbourhood(at: point, in: prepared) }
        )
        .accessibilityHidden(true)
    }

    /// A drag across the view's width turns the graph half a revolution.
    private var turnPerPoint: Double { Double.pi / max(driver.viewport.width, 1) }

    private func tap(at point: CGPoint, in prepared: Prepared) {
        let candidates = JarvisGraphHitTest.candidates(atX: Double(point.x), y: Double(point.y), in: driver.projected)
        let currentIndex = selectedID.flatMap { prepared.layout.indexByID[$0] }
        let next = JarvisGraphHitTest.selection(afterTapWith: candidates, current: currentIndex)
        select(next.map { prepared.layout.nodes[$0].id }, in: prepared)
    }

    private func select(_ id: String?, in prepared: Prepared) {
        guard id != selectedID else { return }
        selectedID = id
        selectionStart = Date()
        driver.invalidate()
        guard let id, let node = prepared.nodesByID[id], let index = prepared.layout.indexByID[id] else { return }
        let connections = copy.graphConnections(prepared.layout.neighbours(of: index).count)
        let tasks = copy.graphTasks(JarvisGraphTaskSummary(openTaskCount: node.openTaskCount))
        let folder = node.directory.isEmpty ? copy.vaultRoot : node.directory
        AccessibilityNotification.Announcement([node.title, folder, connections, tasks].joined(separator: ", ")).post()
    }

    private func focusNeighbourhood(at point: CGPoint, in prepared: Prepared) {
        let candidates = JarvisGraphHitTest.candidates(atX: Double(point.x), y: Double(point.y), in: driver.projected)
        guard let index = candidates.first else { return }
        select(prepared.layout.nodes[index].id, in: prepared)
        focusFeedback += 1
        let group = [index] + prepared.layout.neighbours(of: index)
        fly(to: driver.controller.camera.framing(group, in: prepared.layout, viewport: driver.viewport, maximumZoom: 2.2))
    }

    // MARK: Camera moves

    /// Reduce Motion cuts to the new view instead of gliding.
    private func fly(to camera: JarvisGraphCamera) {
        driver.controller.fly(to: camera, animated: motionMode != .still)
        driver.invalidate()
    }

    private func nudge(yaw: Double, pitch: Double) {
        fly(to: driver.controller.camera.orbited(yaw: yaw, pitch: pitch))
    }

    private func nudgeZoom(_ factor: Double) {
        let viewport = driver.viewport
        fly(to: driver.controller.camera.zoomed(by: factor, anchorX: viewport.width / 2, anchorY: viewport.height / 2, in: viewport))
    }

    private func recenter() {
        driver.cameraBeforeSearch = nil
        selectedID = nil
        fly(to: .home)
    }

    /// Matches light up and the camera eases to frame them; clearing search goes back to where the owner was.
    private func focusSearch(_ matches: Set<String>) {
        guard let layout = current?.layout, driver.viewport.width > 0 else { return }
        let indices = matches.compactMap { layout.indexByID[$0] }.sorted()
        if indices.isEmpty {
            if let saved = driver.cameraBeforeSearch {
                driver.cameraBeforeSearch = nil
                fly(to: saved)
            }
            return
        }
        if driver.cameraBeforeSearch == nil { driver.cameraBeforeSearch = driver.controller.camera }
        fly(to: driver.controller.camera.framing(indices, in: layout, viewport: driver.viewport))
    }

    private func prepare() async {
        let source = graph
        if prepared?.graph == source { return }
        let layout = await Task.detached(priority: .userInitiated) { JarvisGraphLayout.make(source) }.value
        guard !Task.isCancelled else { return }
        let changedNotes = prepared.map { $0.layout.nodes.map(\.id) != layout.nodes.map(\.id) } ?? false
        driver.layoutChanged()
        prepared = Prepared(
            graph: source, layout: layout,
            nodesByID: Dictionary(source.nodes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }),
            calm: JarvisGraphPulseSchedule(layout: layout, mode: .calm),
            cheap: JarvisGraphPulseSchedule(layout: layout, mode: .cheap)
        )
        if let selectedID, layout.indexByID[selectedID] == nil { self.selectedID = nil }
        // A different set of notes (a folder scope) refits: keep the turn and tilt, reset pan and zoom.
        if changedNotes {
            let camera = driver.controller.camera
            fly(to: JarvisGraphCamera(yaw: camera.yaw, pitch: camera.pitch, zoom: 1, panX: 0, panY: 0))
        } else {
            driver.invalidate()
        }
    }

    // MARK: Preview

    private func preview(_ node: KnowledgeGraphNode) -> some View {
        let location = JarvisNoteTitle.location(path: node.path)
        let summary = JarvisGraphTaskSummary(openTaskCount: node.openTaskCount)
        return JarvisRowButton(identifier: "notes.graph.title", action: { Task { await onOpen(node) } }) {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                Image(systemName: "doc.text")
                    .font(.system(size: JarvisDesignTokens.notesIconSize + 4))
                    .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    Text(node.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(1)
                    Text(location.isEmpty ? copy.vaultRoot : location).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: JarvisDesignTokens.notesInlineSpacing)
                taskLabel(summary)
            }
            .padding(.horizontal, JarvisPageHeaderMetrics.rowInset)
            .padding(.vertical, JarvisPageHeaderMetrics.rowVerticalInset - 2)
        }
        .jarvisRowSurface(RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
        .accessibilityElement(children: .combine)
        .accessibilityHint(copy.openNote)
        .accessibilityIdentifier("notes.graph.selection")
    }

    /// An orange ring and the count: the same mark the graph draws on the note, with words beside it.
    @ViewBuilder
    private func taskLabel(_ summary: JarvisGraphTaskSummary) -> some View {
        HStack(spacing: JarvisDesignTokens.notesInlineSpacing * 2) {
            if case .open = summary {
                Circle().strokeBorder(JarvisDesignTokens.notesTaskRing, lineWidth: 1.5)
                    .frame(width: JarvisDesignTokens.notesChipSpacing * 2, height: JarvisDesignTokens.notesChipSpacing * 2)
                    .accessibilityHidden(true)
            }
            Text(copy.graphTasks(summary)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}
