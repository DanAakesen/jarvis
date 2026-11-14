import Foundation

/// What the opening screen's bar shows. Startup work has no reliable measure today, so the bar is a moving segment
/// (`indeterminate`). A fraction is shown only when real work reports it, never from a timer or invented weights.
public enum JarvisOpeningProgress: Equatable, Sendable {
    case indeterminate
    case measured(Double)

    /// 0–1 when measured; nil while indeterminate.
    public var fraction: Double? {
        guard case .measured(let value) = self else { return nil }
        return value.isFinite ? max(0, min(1, value)) : 0
    }

    /// Whole percent for the accessibility value, or nil while indeterminate.
    public var percent: Int? { fraction.map { Int(($0 * 100).rounded()) } }
}

/// Where the opening screen puts things, for any screen size and safe area. Points, y down.
/// The reference is `docs/ui/opening-final-2026-11-14/jarvis-opening-selected.png`; the raster is not a pixel spec.
public struct JarvisOpeningLayout: Equatable, Sendable {
    public let orbDiameter: Double
    public let orbCenterY: Double
    public let wordmarkCenterY: Double
    public let wordmarkFontSize: Double
    public let barWidth: Double
    public let barHeight: Double
    public let barCenterY: Double

    public static let barHeightPoints = 3.0
    public static let barWidthFraction = 0.4

    public init(width: Double, height: Double, safeTop: Double, safeBottom: Double) {
        let fontSize = max(30, min(40, width * 0.085))
        let diameter = max(120, min(width * 0.56, height * 0.32))
        // The orb sits a little above the middle; never under the status bar.
        let centerY = max(safeTop + 24 + diameter / 2, height * 0.39)
        let gap = max(26, height * 0.045)
        let wordmarkY = centerY + diameter / 2 + gap + fontSize / 2
        // The bar clears the home indicator and the wordmark.
        let barY = min(height - max(safeBottom + 32, height * 0.1), height - safeBottom - 24)
        orbDiameter = diameter
        orbCenterY = centerY
        wordmarkFontSize = fontSize
        wordmarkCenterY = min(wordmarkY, barY - 28 - fontSize / 2)
        barWidth = width * Self.barWidthFraction
        barHeight = Self.barHeightPoints
        barCenterY = barY
    }
}

/// The sparse, dim network behind the orb: a few nodes joined by lines that run off the edges of the screen.
/// Fixed seed, positions as fractions of the screen, so the background is the same on every launch and never moves.
public struct JarvisOpeningNetwork: Sendable {
    public struct Node: Equatable, Sendable {
        public let x: Double
        public let y: Double
        /// 0–1 brightness; nodes beyond the screen edge are 0 and exist only to carry lines off-screen.
        public let brightness: Double
    }

    public let nodes: [Node]
    public let links: [[Int]]

    public static let shared = JarvisOpeningNetwork()

    private init() {
        var random = JarvisLatticeRandom(seed: 2026)
        var nodes: [Node] = []
        // A jittered 4 x 6 grid, skipping cells around the orb so the lines stay quieter than it.
        for row in 0..<6 {
            for column in 0..<4 {
                let x = (Double(column) + 0.2 + random.next() * 0.6) / 4
                let y = (Double(row) + 0.2 + random.next() * 0.6) / 6
                let dx = x - 0.5, dy = (y - 0.39) * 1.6
                guard (dx * dx + dy * dy).squareRoot() > 0.36 else { continue }
                nodes.append(Node(x: x, y: y, brightness: 0.55 + random.next() * 0.45))
            }
        }
        // Beyond the edges, so some lines leave the screen.
        for index in 0..<8 {
            let side = index % 4
            let along = random.next()
            switch side {
            case 0: nodes.append(Node(x: -0.08, y: along, brightness: 0))
            case 1: nodes.append(Node(x: 1.08, y: along, brightness: 0))
            case 2: nodes.append(Node(x: along, y: -0.05, brightness: 0))
            default: nodes.append(Node(x: along, y: 1.05, brightness: 0))
            }
        }
        var links: [[Int]] = []
        var seen = Set<Int>()
        for index in nodes.indices {
            let sorted = nodes.indices.filter { $0 != index }.sorted { left, right in
                let a = Self.distance(nodes[index], nodes[left]), b = Self.distance(nodes[index], nodes[right])
                return a == b ? left < right : a < b
            }
            for other in sorted.prefix(index % 3 == 0 ? 3 : 2) {
                let key = min(index, other) * 1000 + max(index, other)
                if seen.insert(key).inserted { links.append([min(index, other), max(index, other)]) }
            }
        }
        self.nodes = nodes
        self.links = links
    }

    private static func distance(_ a: Node, _ b: Node) -> Double {
        ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)).squareRoot()
    }
}

/// When the opening screen is on screen. Cold start only, never on a warm resume; it ends when authentication and
/// the first fresh data are ready, and gives up waiting for data after a cap so a slow service cannot trap the user.
public enum JarvisOpeningPolicy {
    /// How long after authentication the opening waits for fresh Home data before entering Home anyway.
    public static let dataWait: TimeInterval = 8

    public enum Stage: Equatable, Sendable {
        /// Reading the stored session.
        case resolving
        /// Waiting for Face ID or the passcode.
        case authenticating
        case unlocked
        /// Sign-in, a failure or a retry state: the gate's own screens take over.
        case needsAttention
    }

    public static func isVisible(
        enabled: Bool, coldStart: Bool, stage: Stage, dataReady: Bool, unlockedFor: TimeInterval
    ) -> Bool {
        guard enabled, coldStart else { return false }
        switch stage {
        case .resolving, .authenticating: return true
        case .unlocked: return !dataReady && unlockedFor < dataWait
        case .needsAttention: return false
        }
    }
}
