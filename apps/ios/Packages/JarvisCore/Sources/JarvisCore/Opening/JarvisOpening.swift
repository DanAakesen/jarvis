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

/// The sparse, dim network behind the orb: a handful of small nodes joined by long, angular lines that run off the
/// edges of the screen. Every visible node has a link running toward the orb, so no dot is isolated; those links
/// pass behind the orb or end at its centre (`orbAnchor`), hidden by the sphere. Fixed positions as fractions of the
/// screen (modelled on `jarvis-opening-selected.png`), so the background is the same on every launch and never moves.
public struct JarvisOpeningNetwork: Sendable {
    public struct Node: Equatable, Sendable {
        public let x: Double
        public let y: Double
        /// 0–1 brightness; nodes beyond the screen edge are 0 and exist only to carry lines off-screen.
        public let brightness: Double
    }

    public let nodes: [Node]
    public let links: [[Int]]
    /// The hidden node at the orb's centre. The screen replaces its position with the real orb centre.
    public let orbAnchor: Int

    public static let shared = JarvisOpeningNetwork()

    private init() {
        // Visible nodes (0...6), anchors beyond the edges (7...13), then the orb anchor (14).
        let points: [(Double, Double, Double)] = [
            (0.81, 0.055, 0.95), (0.143, 0.238, 1.0), (0.977, 0.284, 0.7), (0.027, 0.488, 0.7),
            (0.904, 0.665, 0.9), (0.089, 0.794, 0.8), (0.911, 0.859, 0.85),
            (-0.08, 0.185, 0), (0.97, -0.05, 0), (1.08, 0.36, 0), (-0.08, 0.55, 0),
            (0.32, 1.05, 0), (0.74, 1.05, 0), (1.08, 0.62, 0),
            (0.5, 0.39, 0),
        ]
        nodes = points.map { Node(x: $0.0, y: $0.1, brightness: $0.2) }
        orbAnchor = 14
        links = [
            [1, 4], [0, 5], [0, 1], [0, 2], [2, 4], [4, 6], [3, 5], [1, 3],
            [1, 7], [0, 8], [2, 9], [3, 10], [5, 11], [6, 12], [4, 13],
            [2, 14], [3, 14], [6, 14],
        ]
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
