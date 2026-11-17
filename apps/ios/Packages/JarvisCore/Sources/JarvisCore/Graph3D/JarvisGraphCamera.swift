import Foundation

public struct JarvisGraphViewport: Equatable, Sendable {
    public var width: Double
    public var height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }

    var centerX: Double { width / 2 }
    var centerY: Double { height / 2 }
}

/// Where the owner is looking at the graph from: turn (yaw), tilt (pitch), zoom and a pan in points.
public struct JarvisGraphCamera: Equatable, Sendable {
    public var yaw: Double
    public var pitch: Double
    public var zoom: Double
    public var panX: Double
    public var panY: Double

    public static let minimumZoom = 0.65
    public static let maximumZoom = 4.0
    /// The graph can be tilted nearly to the pole, never over it.
    public static let maximumPitch = 80.0 * Double.pi / 180

    /// Looking slightly down on the graph: a negative pitch brings the top toward the viewer.
    public static let home = JarvisGraphCamera(yaw: 0.45, pitch: -0.32, zoom: 1, panX: 0, panY: 0)

    public init(yaw: Double, pitch: Double, zoom: Double, panX: Double, panY: Double) {
        self.yaw = yaw
        self.pitch = min(max(pitch, -Self.maximumPitch), Self.maximumPitch)
        self.zoom = min(max(zoom, Self.minimumZoom), Self.maximumZoom)
        self.panX = panX
        self.panY = panY
    }

    public func orbited(yaw deltaYaw: Double, pitch deltaPitch: Double) -> JarvisGraphCamera {
        JarvisGraphCamera(yaw: yaw + deltaYaw, pitch: pitch + deltaPitch, zoom: zoom, panX: panX, panY: panY)
    }

    public func panned(dx: Double, dy: Double) -> JarvisGraphCamera {
        JarvisGraphCamera(yaw: yaw, pitch: pitch, zoom: zoom, panX: panX + dx, panY: panY + dy)
    }

    /// Zooms so the content under `anchor` stays under the owner's fingers.
    public func zoomed(by factor: Double, anchorX: Double, anchorY: Double, in viewport: JarvisGraphViewport) -> JarvisGraphCamera {
        let next = min(max(zoom * factor, Self.minimumZoom), Self.maximumZoom)
        let ratio = next / zoom
        let ax = anchorX - viewport.centerX, ay = anchorY - viewport.centerY
        return JarvisGraphCamera(
            yaw: yaw, pitch: pitch, zoom: next, panX: ax - ratio * (ax - panX), panY: ay - ratio * (ay - panY)
        )
    }

    func blended(to other: JarvisGraphCamera, _ t: Double) -> JarvisGraphCamera {
        func mix(_ a: Double, _ b: Double) -> Double { a + (b - a) * t }
        // Turn by the short way round, however many times the owner has spun the graph.
        let turn = remainder(other.yaw - yaw, 2 * Double.pi)
        return JarvisGraphCamera(
            yaw: yaw + turn * t, pitch: mix(pitch, other.pitch), zoom: mix(zoom, other.zoom),
            panX: mix(panX, other.panX), panY: mix(panY, other.panY)
        )
    }
}

public struct JarvisGraphProjectedNode: Equatable, Sendable {
    public let index: Int
    public let x: Double
    public let y: Double
    /// 0 at the front of the graph, 1 at the back.
    public let depth: Double
    public let radius: Double
    /// How visible the node is: far nodes fade.
    public let opacity: Double
}

/// A perspective camera around the origin. Pure maths, so it is tested without a device.
public struct JarvisGraphProjector: Sendable {
    public let layoutRadius: Double
    public let camera: JarvisGraphCamera
    public let viewport: JarvisGraphViewport
    private let unit: Double
    private let cosYaw: Double
    private let sinYaw: Double
    private let cosPitch: Double
    private let sinPitch: Double

    static let perspectiveDistance = 3.4
    static let farOpacity = 0.38
    static let minimumRadius = 2.5
    static let maximumRadius = 16.0

    public init(layoutRadius: Double, camera: JarvisGraphCamera, viewport: JarvisGraphViewport) {
        self.layoutRadius = max(layoutRadius, 0.001)
        self.camera = camera
        self.viewport = viewport
        unit = 0.36 * min(viewport.width, viewport.height) / self.layoutRadius
        cosYaw = cos(camera.yaw)
        sinYaw = sin(camera.yaw)
        cosPitch = cos(camera.pitch)
        sinPitch = sin(camera.pitch)
    }

    /// Screen points for one unit of layout space at a perspective scale.
    public func pointsPerUnit(perspective: Double = 1) -> Double { unit * perspective * camera.zoom }

    /// The screen position, how far back the point is (0 front, 1 back) and its perspective scale.
    public func project(_ point: JarvisVec3) -> (x: Double, y: Double, depth: Double, perspective: Double) {
        let x1 = point.x * cosYaw + point.z * sinYaw
        let z1 = -point.x * sinYaw + point.z * cosYaw
        let y2 = point.y * cosPitch - z1 * sinPitch
        let z2 = point.y * sinPitch + z1 * cosPitch
        // z2 grows away from the viewer.
        let distance = Self.perspectiveDistance * layoutRadius
        let perspective = distance / (distance + z2)
        let scale = unit * perspective * camera.zoom
        let depth = min(max((z2 / layoutRadius + 1) / 2, 0), 1)
        return (
            viewport.centerX + camera.panX + x1 * scale,
            viewport.centerY + camera.panY - y2 * scale,
            depth,
            perspective
        )
    }

    /// Every note on screen at `time`. Order matches `layout.nodes`.
    public func project(_ layout: JarvisGraphLayout, time: Double = 0, mode: JarvisGraphMotionMode = .still) -> [JarvisGraphProjectedNode] {
        let amplitude = JarvisGraphLife.driftAmplitude(layoutRadius: layout.radius)
        let zoomScale = camera.zoom.squareRoot()
        return layout.nodes.indices.map { index in
            let node = layout.nodes[index]
            let position = mode.drifts
                ? node.position + JarvisGraphLife.drift(of: node, time: time, amplitude: amplitude, mode: mode)
                : node.position
            let p = project(position)
            let base = 2.6 + 4.2 * node.weight
            return JarvisGraphProjectedNode(
                index: index, x: p.x, y: p.y, depth: p.depth,
                radius: min(max(base * p.perspective * zoomScale, Self.minimumRadius), Self.maximumRadius),
                opacity: 1 - (1 - Self.farOpacity) * p.depth
            )
        }
    }
}

extension JarvisGraphCamera {
    /// A camera that frames the given notes: same turn and tilt, panned and zoomed so they fill the view.
    public func framing(
        _ indices: [Int], in layout: JarvisGraphLayout, viewport: JarvisGraphViewport, maximumZoom: Double = 2.4,
        margin: Double = 56
    ) -> JarvisGraphCamera {
        guard !indices.isEmpty, viewport.width > 0, viewport.height > 0 else { return self }
        let neutral = JarvisGraphCamera(yaw: yaw, pitch: pitch, zoom: 1, panX: 0, panY: 0)
        let projector = JarvisGraphProjector(layoutRadius: layout.radius, camera: neutral, viewport: viewport)
        let points = indices.filter { layout.nodes.indices.contains($0) }
            .map { projector.project(layout.nodes[$0].position) }
        guard !points.isEmpty else { return self }
        let minX = points.map(\.x).min()!, maxX = points.map(\.x).max()!
        let minY = points.map(\.y).min()!, maxY = points.map(\.y).max()!
        let width = maxX - minX + 2 * margin, height = maxY - minY + 2 * margin
        let fitted = min(viewport.width / width, viewport.height / height)
        let zoom = min(max(fitted, Self.minimumZoom), maximumZoom)
        let rx = (minX + maxX) / 2 - viewport.centerX, ry = (minY + maxY) / 2 - viewport.centerY
        return JarvisGraphCamera(yaw: yaw, pitch: pitch, zoom: zoom, panX: -zoom * rx, panY: -zoom * ry)
    }
}

/// The camera plus the motion that carries it: a damped spin after the owner lets go, and eased flights for search,
/// focus and recenter. A new touch takes over from wherever the camera is. Reduce Motion cuts instead of gliding.
public struct JarvisGraphCameraController: Equatable, Sendable {
    public private(set) var camera: JarvisGraphCamera
    private var flight: Flight?
    private var yawVelocity = 0.0
    private var pitchVelocity = 0.0

    private struct Flight: Equatable, Sendable {
        let from: JarvisGraphCamera
        let to: JarvisGraphCamera
        var elapsed: Double
    }

    static let flightDuration = 0.55
    static let spinDecay = 3.5
    static let maximumSpin = 6.0
    static let restingSpin = 0.03

    public init(camera: JarvisGraphCamera = .home) {
        self.camera = camera
    }

    public var isMoving: Bool {
        flight != nil || abs(yawVelocity) > Self.restingSpin || abs(pitchVelocity) > Self.restingSpin
    }

    /// Any touch stops a glide or a flight where it is.
    public mutating func beginInteraction() {
        flight = nil
        yawVelocity = 0
        pitchVelocity = 0
    }

    public mutating func orbit(yaw: Double, pitch: Double) { camera = camera.orbited(yaw: yaw, pitch: pitch) }
    public mutating func pan(dx: Double, dy: Double) { camera = camera.panned(dx: dx, dy: dy) }

    public mutating func zoom(by factor: Double, anchorX: Double, anchorY: Double, in viewport: JarvisGraphViewport) {
        camera = camera.zoomed(by: factor, anchorX: anchorX, anchorY: anchorY, in: viewport)
    }

    /// Lets go of an orbit; with `allowsInertia` the spin carries on and slows down.
    public mutating func release(yawVelocity: Double, pitchVelocity: Double, allowsInertia: Bool) {
        guard allowsInertia else {
            self.yawVelocity = 0
            self.pitchVelocity = 0
            return
        }
        self.yawVelocity = min(max(yawVelocity, -Self.maximumSpin), Self.maximumSpin)
        self.pitchVelocity = min(max(pitchVelocity, -Self.maximumSpin), Self.maximumSpin)
    }

    public mutating func fly(to target: JarvisGraphCamera, animated: Bool) {
        yawVelocity = 0
        pitchVelocity = 0
        if animated && target != camera {
            flight = Flight(from: camera, to: target, elapsed: 0)
        } else {
            flight = nil
            camera = target
        }
    }

    public mutating func advance(by seconds: Double) {
        let dt = min(max(seconds, 0), 0.1)
        if var active = flight {
            active.elapsed += dt
            let t = min(active.elapsed / Self.flightDuration, 1)
            camera = t >= 1 ? active.to : active.from.blended(to: active.to, t * t * (3 - 2 * t))
            flight = t >= 1 ? nil : active
            return
        }
        guard isMoving else { return }
        camera = camera.orbited(yaw: yawVelocity * dt, pitch: pitchVelocity * dt)
        if abs(camera.pitch) >= JarvisGraphCamera.maximumPitch - 1e-9 { pitchVelocity = 0 }
        let decay = exp(-Self.spinDecay * dt)
        yawVelocity *= decay
        pitchVelocity *= decay
        if abs(yawVelocity) <= Self.restingSpin { yawVelocity = 0 }
        if abs(pitchVelocity) <= Self.restingSpin { pitchVelocity = 0 }
    }
}
