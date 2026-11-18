import Foundation

public struct JarvisVec3: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(_ x: Double, _ y: Double, _ z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }

    public static let zero = JarvisVec3(0, 0, 0)

    public var length: Double { (x * x + y * y + z * z).squareRoot() }

    public static func + (a: JarvisVec3, b: JarvisVec3) -> JarvisVec3 { JarvisVec3(a.x + b.x, a.y + b.y, a.z + b.z) }
    public static func - (a: JarvisVec3, b: JarvisVec3) -> JarvisVec3 { JarvisVec3(a.x - b.x, a.y - b.y, a.z - b.z) }
    public static func * (a: JarvisVec3, k: Double) -> JarvisVec3 { JarvisVec3(a.x * k, a.y * k, a.z * k) }
}

/// A stable hash for layout and motion. Swift's own `hashValue` changes on every launch, which would move every note.
enum JarvisGraphHash {
    static func hash(_ string: String) -> UInt64 {
        var value: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in string.utf8 {
            value ^= UInt64(byte)
            value = value &* 0x0000_0100_0000_01B3
        }
        return mix(value)
    }

    static func mix(_ input: UInt64) -> UInt64 {
        var z = input &+ 0x9E37_79B9_7F4A_7C15
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// A value in 0..<1 for a seed and a salt, so one hash gives several independent numbers.
    static func unit(_ seed: UInt64, _ salt: UInt64) -> Double {
        Double(mix(seed &+ salt &* 0xD1B5_4A32_D192_ED03) >> 11) / Double(1 << 53)
    }
}

/// The colour family of a folder cluster. Labels carry the meaning; colour only supports them.
public enum JarvisGraphScope: Equatable, Sendable {
    case work
    case personal
    case general
    case other

    public init(clusterKey: String) {
        switch clusterKey.lowercased() {
        case "work": self = .work
        case "personal": self = .personal
        case "general": self = .general
        default: self = .other
        }
    }
}

/// The real vault graph placed in 3D, one cluster per top-level folder. A pure function of the graph: the same vault
/// always gives the same layout, a note's place comes from a hash of its id (not its position in a list), and nothing
/// moves while the owner looks at it.
public struct JarvisGraphLayout: Equatable, Sendable {
    public struct Node: Equatable, Sendable {
        public let id: String
        public let position: JarvisVec3
        public let cluster: Int
        /// 0...1 from the note's real connection count; larger notes draw larger.
        public let weight: Double
        public let openTaskCount: Int?
        /// Per-note offsets (radians) that keep drift and breathing from moving in step.
        public let phase: JarvisVec3

        public var hasOpenTasks: Bool { (openTaskCount ?? 0) > 0 }
    }

    public struct Cluster: Equatable, Sendable {
        /// The top-level folder; "" for notes at the vault root.
        public let key: String
        public let scope: JarvisGraphScope
        public let center: JarvisVec3
        public let radius: Double
        public let count: Int
    }

    public struct Edge: Equatable, Sendable {
        public let source: Int
        public let target: Int
        public let kind: KnowledgeGraphEdge.Kind
        public let score: Double?
    }

    public let nodes: [Node]
    public let clusters: [Cluster]
    public let edges: [Edge]
    /// A sphere around the origin that holds every node, for fitting the camera.
    public let radius: Double
    public let indexByID: [String: Int]

    public static let empty = JarvisGraphLayout(nodes: [], clusters: [], edges: [], radius: 1, indexByID: [:])

    public static func clusterKey(forFolder folder: String) -> String {
        folder.split(separator: "/").first.map(String.init) ?? ""
    }

    public func neighbours(of index: Int) -> [Int] {
        edges.compactMap { edge in
            edge.source == index ? edge.target : edge.target == index ? edge.source : nil
        }
    }

    static let relaxationIterations = 32

    public static func make(_ graph: KnowledgeGraph) -> JarvisGraphLayout {
        var seen = Set<String>()
        let source = graph.nodes.sorted { $0.id < $1.id }.filter { seen.insert($0.id).inserted }
        guard !source.isEmpty else { return .empty }

        let keys = source.map { clusterKey(forFolder: $0.folder) }
        let clusterKeys = Array(Set(keys)).sorted()
        let clusterIndex = Dictionary(uniqueKeysWithValues: clusterKeys.enumerated().map { ($1, $0) })
        var members = [[Int]](repeating: [], count: clusterKeys.count)
        for (index, key) in keys.enumerated() { members[clusterIndex[key]!].append(index) }

        let radii = members.map { max(0.45, 0.55 * cbrt(Double($0.count))) }
        let centres = clusterCentres(radii: radii)
        let degrees = source.map { max(0, $0.degree) }
        let maxDegree = degrees.max() ?? 0
        let weights = degrees.map { maxDegree > 0 ? log1p(Double($0)) / log1p(Double(maxDegree)) : 0 }

        var positions = [JarvisVec3](repeating: .zero, count: source.count)
        for (index, node) in source.enumerated() {
            let cluster = clusterIndex[keys[index]]!
            let seed = JarvisGraphHash.hash(node.id)
            let z = 2 * JarvisGraphHash.unit(seed, 1) - 1
            let angle = 2 * Double.pi * JarvisGraphHash.unit(seed, 2)
            let ring = (1 - z * z).squareRoot()
            let direction = JarvisVec3(ring * cos(angle), z, ring * sin(angle))
            // Hubs sit nearer the middle of their cluster.
            let reach = cbrt(JarvisGraphHash.unit(seed, 3)) * (1 - 0.45 * weights[index]) * radii[cluster] * 0.92
            positions[index] = centres[cluster] + direction * reach
        }

        let indexByID = Dictionary(uniqueKeysWithValues: source.enumerated().map { ($1.id, $0) })
        let edges = resolvedEdges(graph.edges, indexByID: indexByID)
        for cluster in members.indices where members[cluster].count > 1 {
            relax(
                &positions, members: members[cluster], center: centres[cluster], radius: radii[cluster], edges: edges
            )
        }

        let nodes = source.enumerated().map { index, node in
            let seed = JarvisGraphHash.hash(node.id)
            return Node(
                id: node.id, position: positions[index], cluster: clusterIndex[keys[index]]!, weight: weights[index],
                openTaskCount: node.openTaskCount,
                phase: JarvisVec3(
                    2 * Double.pi * JarvisGraphHash.unit(seed, 4), 2 * Double.pi * JarvisGraphHash.unit(seed, 5),
                    2 * Double.pi * JarvisGraphHash.unit(seed, 6)
                )
            )
        }
        let clusters = clusterKeys.indices.map { index in
            Cluster(
                key: clusterKeys[index], scope: JarvisGraphScope(clusterKey: clusterKeys[index]),
                center: centres[index], radius: radii[index], count: members[index].count
            )
        }
        let reach = nodes.map { $0.position.length }.max() ?? 0
        return JarvisGraphLayout(
            nodes: nodes, clusters: clusters, edges: edges, radius: max(1, reach + 0.3), indexByID: indexByID
        )
    }

    /// Cluster centres on a Fibonacci spiral over a slightly flattened sphere, scaled so the closest pair of clusters
    /// just clears each other. One cluster sits at the origin.
    static func clusterCentres(radii: [Double]) -> [JarvisVec3] {
        let count = radii.count
        guard count > 1 else { return [.zero] }
        let directions = (0..<count).map { index -> JarvisVec3 in
            let y = 1 - 2 * (Double(index) + 0.5) / Double(count)
            let ring = (1 - y * y).squareRoot()
            let angle = Double(index) * 2.399963229728653
            return JarvisVec3(ring * cos(angle), y * 0.75, ring * sin(angle))
        }
        var scale = 0.0
        for a in 0..<count {
            for b in (a + 1)..<count {
                let gap = (directions[a] - directions[b]).length
                if gap > 1e-9 { scale = max(scale, 1.12 * (radii[a] + radii[b]) / gap) }
            }
        }
        return directions.map { $0 * scale }
    }

    /// Real edges only: unknown ends and self links are dropped, a pair is drawn once and an explicit link wins over a
    /// similarity edge between the same notes.
    static func resolvedEdges(_ edges: [KnowledgeGraphEdge], indexByID: [String: Int]) -> [Edge] {
        struct Pair: Hashable {
            let a: Int
            let b: Int
        }
        var byPair: [Pair: Edge] = [:]
        for edge in edges {
            guard let source = indexByID[edge.source], let target = indexByID[edge.target], source != target else { continue }
            let pair = Pair(a: min(source, target), b: max(source, target))
            let resolved = Edge(source: pair.a, target: pair.b, kind: edge.type, score: edge.score)
            if let existing = byPair[pair] {
                if existing.kind == .similar && edge.type == .link { byPair[pair] = resolved }
            } else {
                byPair[pair] = resolved
            }
        }
        return byPair.values.sorted { ($0.source, $0.target) < ($1.source, $1.target) }
    }

    private struct GridCell: Hashable {
        let x: Int
        let y: Int
        let z: Int
    }

    /// A short fixed relaxation inside one cluster: linked notes are drawn together, overlapping notes are pushed
    /// apart, and the cluster is kept round. A spatial grid keeps it linear in the number of notes.
    private static func relax(
        _ positions: inout [JarvisVec3], members: [Int], center: JarvisVec3, radius: Double, edges: [Edge]
    ) {
        let count = members.count
        let local = Dictionary(uniqueKeysWithValues: members.enumerated().map { ($1, $0) })
        let links = edges.compactMap { edge -> (Int, Int)? in
            guard let a = local[edge.source], let b = local[edge.target] else { return nil }
            return (a, b)
        }
        let spacing = 1.61 * radius / cbrt(Double(count))
        let minimum = 0.55 * spacing
        let rest = 0.6 * spacing
        var points = members.map { positions[$0] }

        func cell(_ point: JarvisVec3) -> GridCell {
            GridCell(
                x: Int((point.x / minimum).rounded(.down)),
                y: Int((point.y / minimum).rounded(.down)),
                z: Int((point.z / minimum).rounded(.down))
            )
        }

        for _ in 0..<relaxationIterations {
            var shift = [JarvisVec3](repeating: .zero, count: count)
            for (a, b) in links {
                let delta = points[b] - points[a]
                let length = delta.length
                guard length > rest else { continue }
                let pull = delta * ((length - rest) / length * 0.09)
                shift[a] = shift[a] + pull
                shift[b] = shift[b] - pull
            }

            var grid: [GridCell: [Int]] = [:]
            for index in 0..<count { grid[cell(points[index]), default: []].append(index) }
            for index in 0..<count {
                let home = cell(points[index])
                for dx in -1...1 {
                    for dy in -1...1 {
                        for dz in -1...1 {
                            let neighbour = GridCell(x: home.x + dx, y: home.y + dy, z: home.z + dz)
                            guard let others = grid[neighbour] else { continue }
                            for other in others where other > index {
                                var delta = points[index] - points[other]
                                var length = delta.length
                                guard length < minimum else { continue }
                                if length < 1e-9 {
                                    delta = JarvisVec3(Double(index % 7) - 3, Double(other % 5) - 2, 1)
                                    length = delta.length
                                }
                                let push = delta * ((minimum - length) / length * 0.5)
                                shift[index] = shift[index] + push
                                shift[other] = shift[other] - push
                            }
                        }
                    }
                }
            }

            for index in 0..<count {
                let offset = points[index] - center
                var next = points[index] + shift[index] - offset * 0.02
                let distance = (next - center).length
                let limit = radius * 1.15
                if distance > limit { next = center + (next - center) * (limit / distance) }
                points[index] = next
            }
        }
        for (index, member) in members.enumerated() { positions[member] = points[index] }
    }
}
