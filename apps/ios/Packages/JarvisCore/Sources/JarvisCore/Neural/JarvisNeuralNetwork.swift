import Foundation

/// The sparse, dim network behind the orb, on every screen: a handful of small nodes joined by long, angular lines
/// that run off the edges of the screen. Every visible node has a link running toward the orb, so no dot is
/// isolated; those links pass behind the orb or end at its centre (`orbAnchor`), hidden by the sphere.
/// Positions are fixed fractions of the screen, so the background is the same on every launch.
/// `routes` are the paths a neuron takes from the orb to a node.
public struct JarvisNeuralNetwork: Sendable {
    public struct Node: Equatable, Sendable {
        public let x: Double
        public let y: Double
        /// 0–1 brightness; nodes beyond the screen edge are 0 and exist only to carry lines off-screen.
        public let brightness: Double
    }

    /// The way a signal travels from the orb to one node along existing links, as the shortest path.
    public struct Route: Equatable, Sendable {
        public let target: Int
        /// Node indices from the orb anchor to the target.
        public let nodes: [Int]
        /// Link indices along the route; `links[i]` joins `nodes[i]` and `nodes[i + 1]`.
        public let links: [Int]
        /// Length of each segment, in screen-height units on a phone-shaped screen.
        public let segments: [Double]
        public let length: Double
    }

    public let nodes: [Node]
    public let links: [[Int]]
    /// The hidden node at the orb's centre. The screen replaces its position with the real orb centre.
    public let orbAnchor: Int
    public let routes: [Route]

    /// Where the opening screen puts the orb's centre, as fractions of the screen. Screens without an orb use it too,
    /// so the network is the same everywhere.
    public static let orbHome = (x: 0.5, y: 0.39)
    private static let phoneAspect = 0.46

    public static let shared = JarvisNeuralNetwork()

    private init() {
        // Visible nodes (0...6), anchors beyond the edges (7...13), then the orb anchor (14).
        let points: [(Double, Double, Double)] = [
            (0.81, 0.055, 0.95), (0.143, 0.238, 1.0), (0.977, 0.284, 0.7), (0.027, 0.488, 0.7),
            (0.904, 0.665, 0.9), (0.089, 0.794, 0.8), (0.911, 0.859, 0.85),
            (-0.08, 0.185, 0), (0.97, -0.05, 0), (1.08, 0.36, 0), (-0.08, 0.55, 0),
            (0.32, 1.05, 0), (0.74, 1.05, 0), (1.08, 0.62, 0),
            (Self.orbHome.x, Self.orbHome.y, 0),
        ]
        let nodes = points.map { Node(x: $0.0, y: $0.1, brightness: $0.2) }
        let links = [
            [1, 4], [0, 5], [0, 1], [0, 2], [2, 4], [4, 6], [3, 5], [1, 3],
            [1, 7], [0, 8], [2, 9], [3, 10], [5, 11], [6, 12], [4, 13],
            [2, 14], [3, 14], [6, 14],
        ]
        let anchor = 14
        self.nodes = nodes
        self.links = links
        orbAnchor = anchor
        routes = Self.shortestRoutes(nodes: nodes, links: links, anchor: anchor)
    }

    private static func distance(_ a: Node, _ b: Node) -> Double {
        let dx = (a.x - b.x) * phoneAspect, dy = a.y - b.y
        return (dx * dx + dy * dy).squareRoot()
    }

    /// Dijkstra from the orb anchor over the links. Ties are broken by link order, so the result is fixed.
    private static func shortestRoutes(nodes: [Node], links: [[Int]], anchor: Int) -> [Route] {
        var best = [Double](repeating: .infinity, count: nodes.count)
        var via = [(node: Int, link: Int)?](repeating: nil, count: nodes.count)
        var done = [Bool](repeating: false, count: nodes.count)
        best[anchor] = 0
        for _ in nodes.indices {
            var current: Int?
            for index in nodes.indices where !done[index] && best[index].isFinite {
                if current == nil || best[index] < best[current!] { current = index }
            }
            guard let from = current else { break }
            done[from] = true
            for (linkIndex, link) in links.enumerated() where link.contains(from) {
                let to = link[0] == from ? link[1] : link[0]
                let cost = best[from] + distance(nodes[from], nodes[to])
                if cost < best[to] - 1e-12 {
                    best[to] = cost
                    via[to] = (from, linkIndex)
                }
            }
        }
        var routes: [Route] = []
        for target in nodes.indices where target != anchor && via[target] != nil {
            var path = [target], linkPath: [Int] = []
            var cursor = target
            while let step = via[cursor] {
                path.append(step.node)
                linkPath.append(step.link)
                cursor = step.node
            }
            path.reverse()
            linkPath.reverse()
            let segments = (0..<linkPath.count).map { distance(nodes[path[$0]], nodes[path[$0 + 1]]) }
            routes.append(Route(
                target: target, nodes: path, links: linkPath, segments: segments, length: segments.reduce(0, +)
            ))
        }
        return routes
    }
}
