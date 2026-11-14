import Foundation

/// Park–Miller generator. The web port uses the same constants, so both platforms grow the same lattice.
/// 64-bit on purpose: `Int` is 32 bits on the Watch's arm64_32.
struct JarvisLatticeRandom {
    private var seed: Int64

    init(seed: Int64) { self.seed = seed }

    mutating func next() -> Double {
        seed = seed * 16807 % 2_147_483_647
        return Double(seed) / 2_147_483_647
    }
}

/// The cognitive lattice: the fixed topology of the Jarvis orb. A few hundred nodes sit in a ball (a bright shell,
/// a middle layer and a dense amber core) and are joined by connections to their neighbours, so the whole thing
/// reads as one connected brain. Nothing here moves: `JarvisLatticeScene` poses it for a point in time.
///
/// Everything is generated from a seed with plain arithmetic, so the app, widgets, Watch and web build the same
/// network. Positions are in orb radii (the glass sphere has radius 1); `z` points at the viewer.
public struct JarvisLatticeModel: Sendable {
    public enum Layer: Int, Sendable { case shell, mid, core }

    public struct Node: Sendable {
        /// Resting position.
        public let position: JarvisOrbVector
        public let layer: Layer
        /// Distance from the centre at rest.
        public let radius: Double
        /// Index of the small group that drifts in depth together.
        public let cluster: Int
        /// 0 cool cyan at the glass, 1 amber at the heart.
        public let warmth: Double
        /// Dot radius in orb radii.
        public let size: Double
        /// 0 always drawn, 1 from reduced detail, 2 only at full detail.
        public let rank: Int
        /// 0–1, spreads twinkle so nodes do not blink together.
        public let phase: Double
    }

    public struct Edge: Sendable {
        public let a: Int
        public let b: Int
        /// How far the connection curves toward the centre, as a fraction of its midpoint's distance from it.
        public let bow: Double
        public let rank: Int
    }

    /// A group of nodes that shifts gently in depth, slowly and out of step with the others.
    public struct Cluster: Sendable {
        public let amplitude: JarvisOrbVector
        public let speed: JarvisOrbVector
        public let phase: JarvisOrbVector
    }

    /// Where a short sequence of lit nodes starts, and how many connections each node is from it.
    public struct Ignition: Sendable {
        public let hops: [UInt8]
        public let period: Double
        public let offset: Double
    }

    /// A faint signal travelling inward along existing connections, from the glass toward the core.
    public struct Route: Sendable {
        public let nodes: [Int]
        /// Edge index for each hop and whether the hop runs from the edge's `a` to its `b`.
        public let edges: [Int]
        public let forward: [Bool]
        public let period: Double
        public let offset: Double
        /// Seconds to cross one connection.
        public let hopDuration: Double
    }

    public static let unreachable: UInt8 = 255
    public static let seed: Int64 = 1834
    public static let shellCount = 72
    public static let midCount = 150
    public static let coreCount = 120

    /// The heart's warm pulse repeats every 1.6 seconds.
    public static let pulsePeriod = 1.6

    public let nodes: [Node]
    public let edges: [Edge]
    public let clusters: [Cluster]
    public let ignitions: [Ignition]
    public let routes: [Route]
    /// Indices of the core nodes, whose centroid is the heart.
    public let coreNodes: [Int]

    public static let shared = JarvisLatticeModel()

    private init() {
        var random = JarvisLatticeRandom(seed: Self.seed)

        // Rest positions.
        var positions: [(JarvisOrbVector, Layer)] = []
        func direction(_ random: inout JarvisLatticeRandom) -> JarvisOrbVector {
            let y = random.next() * 2 - 1
            let angle = random.next() * Double.pi * 2
            let ring = (1 - y * y).squareRoot()
            return JarvisOrbVector(cos(angle) * ring, y, sin(angle) * ring)
        }
        for index in 0..<Self.shellCount {
            let angle = Double(index) * 2.39996
            let y = 1 - 2 * (Double(index) + 0.5) / Double(Self.shellCount)
            let ring = (1 - y * y).squareRoot()
            let jitter = direction(&random)
            let jx = cos(angle) * ring + jitter.x * 0.16
            let jy = y + jitter.y * 0.16
            let jz = sin(angle) * ring + jitter.z * 0.16
            let length = max((jx * jx + jy * jy + jz * jz).squareRoot(), 1e-6)
            let radius = 0.88 + random.next() * 0.07
            positions.append((JarvisOrbVector(jx / length * radius, jy / length * radius, jz / length * radius), .shell))
        }
        for _ in 0..<Self.midCount {
            let d = direction(&random)
            let radius = 0.34 + 0.5 * pow(random.next(), 1.1)
            positions.append((JarvisOrbVector(d.x * radius, d.y * radius, d.z * radius), .mid))
        }
        for _ in 0..<Self.coreCount {
            let d = direction(&random)
            // A five-lobed star keeps the heart from looking like a ball.
            let lobes = 1 + 0.3 * cos(5 * atan2(d.y, d.x) + 0.6) + 0.1 * cos(3 * atan2(d.y, d.x) - 0.4)
            let radius = 0.56 * pow(random.next(), 0.78) * lobes
            positions.append((JarvisOrbVector(d.x * radius * 1.1 + 0.03, d.y * radius * 0.94 - 0.02, d.z * radius * 0.85), .core))
        }
        let count = positions.count

        // Clusters: nine drifting centres; every node follows the nearest one.
        var clusterCenters: [JarvisOrbVector] = []
        var clusters: [Cluster] = []
        for _ in 0..<9 {
            let d = direction(&random)
            let radius = 0.12 + random.next() * 0.58
            clusterCenters.append(JarvisOrbVector(d.x * radius, d.y * radius, d.z * radius))
            clusters.append(Cluster(
                amplitude: JarvisOrbVector(0.022 + random.next() * 0.014, 0.022 + random.next() * 0.014, 0.085 + random.next() * 0.05),
                speed: JarvisOrbVector(0.2 + random.next() * 0.24, 0.2 + random.next() * 0.24, 0.17 + random.next() * 0.2),
                phase: JarvisOrbVector(random.next() * 6.283, random.next() * 6.283, random.next() * 6.283)
            ))
        }

        // Neighbours by distance (index breaks ties, so the order never depends on rounding).
        var neighbours: [[Int]] = []
        for index in 0..<count {
            let origin = positions[index].0
            neighbours.append((0..<count).filter { $0 != index }.sorted { left, right in
                let a = origin.distance(to: positions[left].0), b = origin.distance(to: positions[right].0)
                return a == b ? left < right : a < b
            })
        }

        // Ranks: hubs always show, so the orb still reads as a network at 18 pt.
        let coreByRadius = (0..<count).filter { positions[$0].1 == .core }
            .sorted { positions[$0].0.length < positions[$1].0.length }
        var hubs = Set(coreByRadius.prefix(20))
        for index in 0..<count where positions[index].1 == .shell && index % 3 == 0 { hubs.insert(index) }
        for index in 0..<count where positions[index].1 == .mid && index % 5 == 0 { hubs.insert(index) }
        var nodes: [Node] = []
        for index in 0..<count {
            let (position, layer) = positions[index]
            let radius = position.length
            var nearest = 0
            var best = Double.infinity
            for (cluster, center) in clusterCenters.enumerated() {
                let distance = position.distance(to: center)
                if distance < best { best = distance; nearest = cluster }
            }
            let rank = hubs.contains(index) ? 0 : (index % 2 == 0 ? 1 : 2)
            let warmth = JarvisLatticeModel.smoothstep(0.92, 0.2, radius)
            let base = layer == .shell ? 0.0058 : layer == .mid ? 0.0042 : 0.0038
            let size = (base + random.next() * 0.0034) * (hubs.contains(index) ? 1.7 : 1)
            nodes.append(Node(
                position: position, layer: layer, radius: radius, cluster: nearest,
                warmth: warmth, size: size, rank: rank, phase: random.next()
            ))
        }

        // Connections: nearest neighbours, a longer skip for the interior, and one spoke from every shell node
        // to the nearest interior node, so the glass is tied into the core.
        var seen = Set<Int>()
        var edges: [Edge] = []
        func connect(_ a: Int, _ b: Int) {
            let low = min(a, b), high = max(a, b)
            guard low != high, seen.insert(low * 1000 + high).inserted else { return }
            let mid = JarvisOrbVector(
                (nodes[a].position.x + nodes[b].position.x) / 2,
                (nodes[a].position.y + nodes[b].position.y) / 2,
                (nodes[a].position.z + nodes[b].position.z) / 2
            )
            let bow = 0.015 + 0.05 * (1 - min(1, mid.length)) + random.next() * 0.025
            edges.append(Edge(a: low, b: high, bow: bow, rank: min(2, nodes[a].rank + nodes[b].rank)))
        }
        for index in 0..<count {
            let reach = nodes[index].layer == .core ? 6 : 4
            for neighbour in neighbours[index].prefix(reach) { connect(index, neighbour) }
            // Long chords across the interior give the web its star-shaped arcs.
            if nodes[index].layer != .shell {
                let far = (0..<count).filter {
                    nodes[$0].layer != .shell && (0.3...0.62).contains(nodes[index].position.distance(to: nodes[$0].position))
                }
                if !far.isEmpty {
                    if index % 4 != 0 { connect(index, far[Int(random.next() * Double(far.count)) % far.count]) }
                }
            }
            if nodes[index].layer == .shell, let inward = neighbours[index].first(where: { nodes[$0].layer != .shell }) {
                connect(index, inward)
            }
        }

        var adjacency = [[(node: Int, edge: Int)]](repeating: [], count: count)
        for (index, edge) in edges.enumerated() {
            adjacency[edge.a].append((edge.b, index))
            adjacency[edge.b].append((edge.a, index))
        }

        // Node sequences: eight ignition points among the hubs, with the hop distance to every node.
        let hubList = hubs.sorted()
        var ignitions: [Ignition] = []
        for index in 0..<8 {
            let start = hubList[(index * hubList.count / 8 + Int(random.next() * 3)) % hubList.count]
            var hops = [UInt8](repeating: Self.unreachable, count: count)
            hops[start] = 0
            var frontier = [start]
            while !frontier.isEmpty {
                var next: [Int] = []
                for node in frontier {
                    for step in adjacency[node] where hops[step.node] == Self.unreachable {
                        hops[step.node] = hops[node] + 1
                        next.append(step.node)
                    }
                }
                frontier = next
            }
            ignitions.append(Ignition(hops: hops, period: 5.2 + random.next() * 3.4, offset: random.next() * 8))
        }

        // Signals: from a shell node inward along existing connections, a few hops each.
        var routes: [Route] = []
        let shellNodes = (0..<count).filter { nodes[$0].layer == .shell }
        var attempt = 0
        while routes.count < 22, attempt < shellNodes.count * 2 {
            let start = shellNodes[(attempt * 7 + 3) % shellNodes.count]
            attempt += 1
            var path = [start]
            var pathEdges: [Int] = []
            var forward: [Bool] = []
            var current = start
            while path.count < 8 {
                let wanted = nodes[current].radius - 0.15
                let inward = adjacency[current]
                    .filter { nodes[$0.node].radius < nodes[current].radius - 0.02 && !path.contains($0.node) }
                    .sorted { left, right in
                        let a = abs(nodes[left.node].radius - wanted), b = abs(nodes[right.node].radius - wanted)
                        return a == b ? left.node < right.node : a < b
                    }
                guard let step = inward.first else { break }
                pathEdges.append(step.edge)
                forward.append(edges[step.edge].a == current)
                path.append(step.node)
                current = step.node
                if nodes[current].layer == .core && nodes[current].radius < 0.16 { break }
            }
            guard path.count >= 3 else { continue }
            routes.append(Route(
                nodes: path, edges: pathEdges, forward: forward,
                period: 4.4 + random.next() * 3.6, offset: random.next() * 9,
                hopDuration: 0.5 + random.next() * 0.2
            ))
        }

        self.nodes = nodes
        self.edges = edges
        self.clusters = clusters
        self.ignitions = ignitions
        self.routes = routes
        self.coreNodes = (0..<count).filter { nodes[$0].layer == .core }
    }

    public static func smoothstep(_ edge0: Double, _ edge1: Double, _ value: Double) -> Double {
        JarvisOrbMotion.smoothstep(edge0, edge1, value)
    }
}
