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
    public static let shellCount = 32
    public static let midCount = 36
    /// Arms of the heart star; the core holds the heart, an inner ring, the tips and a few free nodes.
    public static let armCount = 7
    public static let coreCount = 1 + 2 * armCount + 14

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
        // Glass shell: an even spread over the sphere, nudged so no ring of nodes shows.
        for index in 0..<Self.shellCount {
            let angle = Double(index) * 2.39996
            let y = 1 - 2 * (Double(index) + 0.5) / Double(Self.shellCount)
            let ring = (1 - y * y).squareRoot()
            let jitter = direction(&random)
            let jx = cos(angle) * ring + jitter.x * 0.12
            let jy = y + jitter.y * 0.12
            let jz = sin(angle) * ring + jitter.z * 0.12
            let length = max((jx * jx + jy * jy + jz * jz).squareRoot(), 1e-6)
            let radius = 0.9 + random.next() * 0.05
            positions.append((JarvisOrbVector(jx / length * radius, jy / length * radius, jz / length * radius), .shell))
        }
        // Two interior shells, so the facets sit at several depths.
        for index in 0..<Self.midCount {
            let angle = Double(index) * 2.39996 + 1.3
            let y = 1 - 2 * (Double(index) + 0.5) / Double(Self.midCount)
            let ring = (1 - y * y).squareRoot()
            let jitter = direction(&random)
            let jx = cos(angle) * ring + jitter.x * 0.18
            let jy = y + jitter.y * 0.18
            let jz = sin(angle) * ring + jitter.z * 0.18
            let length = max((jx * jx + jy * jy + jz * jz).squareRoot(), 1e-6)
            let radius = (index % 2 == 0 ? 0.7 : 0.5) + random.next() * 0.1
            positions.append((JarvisOrbVector(jx / length * radius, jy / length * radius, jz / length * radius), .mid))
        }
        // The core is a star: a heart node, an inner ring, long tips between its points, and a few free nodes in the gaps.
        let armStep = Double.pi * 2 / Double(Self.armCount)
        for index in 0..<Self.coreCount {
            if index == 0 {
                positions.append((JarvisOrbVector(0.03, -0.02, 0), .core))
            } else if index <= Self.armCount {
                let angle = Double(index - 1) * armStep + 0.35 + (random.next() - 0.5) * 0.2
                let radius = 0.15 + random.next() * 0.05
                positions.append((JarvisOrbVector(cos(angle) * radius * 1.1, sin(angle) * radius * 0.94, (random.next() - 0.5) * 0.24), .core))
            } else if index <= 2 * Self.armCount {
                let angle = Double(index - Self.armCount - 1) * armStep + 0.35 + armStep / 2 + (random.next() - 0.5) * 0.2
                let radius = 0.4 + random.next() * 0.14
                positions.append((JarvisOrbVector(cos(angle) * radius * 1.1, sin(angle) * radius * 0.94, (random.next() - 0.5) * 0.4), .core))
            } else {
                let d = direction(&random)
                let radius = 0.2 + 0.3 * random.next()
                positions.append((JarvisOrbVector(d.x * radius * 1.1 + 0.03, d.y * radius * 0.94 - 0.02, d.z * radius * 0.85), .core))
            }
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
        var hubs = Set<Int>()
        for index in 0..<count {
            let layer = positions[index].1
            let within = index - (layer == .shell ? 0 : layer == .mid ? Self.shellCount : Self.shellCount + Self.midCount)
            if layer == .core ? within <= 2 * Self.armCount : within % 3 == 0 { hubs.insert(index) }
        }
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
            let warmth = JarvisLatticeModel.smoothstep(0.9, 0.42, radius)
            let base = layer == .shell ? 0.0086 : layer == .mid ? 0.0072 : 0.008
            let size = (base + random.next() * 0.0044) * (hubs.contains(index) ? 1.6 : 0.7)
            nodes.append(Node(
                position: position, layer: layer, radius: radius, cluster: nearest,
                warmth: warmth, size: size, rank: rank, phase: random.next()
            ))
        }

        // Connections: two nodes are joined only when no third node sits between them (a Gabriel graph on the shell,
        // a relative-neighbourhood graph inside). That keeps the web to long, clean lines that close into triangular
        // and star-shaped facets. The shell and the interior are meshed on their own, then each shell node is tied
        // to its nearest interior node.
        var seen = Set<Int>()
        var edges: [Edge] = []
        func connect(_ a: Int, _ b: Int, curl: Double = 0) {
            let low = min(a, b), high = max(a, b)
            guard low != high, seen.insert(low * 1000 + high).inserted else { return }
            let length = nodes[a].position.distance(to: nodes[b].position)
            let mid = JarvisOrbVector(
                (nodes[a].position.x + nodes[b].position.x) / 2,
                (nodes[a].position.y + nodes[b].position.y) / 2,
                (nodes[a].position.z + nodes[b].position.z) / 2
            )
            let rim = nodes[a].layer == .shell && nodes[b].layer == .shell
            let bow = rim
                ? 0.02 + random.next() * 0.03
                : 0.07 + 0.3 * length * (1 - 0.5 * min(1, mid.length)) + random.next() * 0.05 + curl
            edges.append(Edge(a: low, b: high, bow: bow, rank: min(2, nodes[a].rank + nodes[b].rank)))
        }
        func squared(_ a: Int, _ b: Int) -> Double {
            let dx = nodes[a].position.x - nodes[b].position.x
            let dy = nodes[a].position.y - nodes[b].position.y
            let dz = nodes[a].position.z - nodes[b].position.z
            return dx * dx + dy * dy + dz * dz
        }
        func mesh(_ members: [Int], longest: Double, relative: Bool) {
            for a in members {
                for b in members where b > a {
                    let span = squared(a, b)
                    if span > longest * longest { continue }
                    let open = !members.contains { c in
                        c != a && c != b
                            && (relative ? max(squared(a, c), squared(b, c)) < span : squared(a, c) + squared(b, c) < span)
                    }
                    if open { connect(a, b) }
                }
            }
        }
        // The star: the heart reaches every inner node and every tip, each tip joins the two inner nodes beside it, and
        // neighbouring tips are linked by arcs that curve in toward the heart.
        let heart = Self.shellCount + Self.midCount
        for arm in 0..<Self.armCount {
            let inner = heart + 1 + arm
            let next = heart + 1 + (arm + 1) % Self.armCount
            let tip = heart + 1 + Self.armCount + arm
            connect(heart, inner)
            connect(inner, next)
            connect(tip, inner)
            connect(tip, next)
            connect(heart, tip, curl: 0.05)
            connect(tip, heart + 1 + Self.armCount + (arm + 1) % Self.armCount, curl: 0.26)
        }
        mesh((0..<count).filter { nodes[$0].layer == .shell }, longest: 1.1, relative: false)
        mesh((0..<count).filter { nodes[$0].layer != .shell }, longest: 0.8, relative: true)
        for index in 0..<count where nodes[index].layer == .shell {
            if let inward = neighbours[index].first(where: { nodes[$0].layer != .shell }) { connect(index, inward) }
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
