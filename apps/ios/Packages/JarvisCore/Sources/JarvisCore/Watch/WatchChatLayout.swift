import Foundation

/// Scroll arithmetic for the Watch Chat composer, kept portable so it can be tested without a Watch.
public enum WatchChatLayout {
    /// Distance from the newest message beyond which the reader counts as browsing history.
    public static let readingDistance = 80.0
    /// Gap between the newest message and the top of the composer.
    public static let endGap = 8.0

    /// Height of real scrolling content after the newest message. The scroll view runs under the composer and the
    /// bottom safe area, so this must cover both or the last lines stay hidden when scrolled to the end.
    public static func endClearance(composerHeight: Double, safeAreaBottom: Double) -> Double {
        guard composerHeight.isFinite, safeAreaBottom.isFinite else { return endGap }
        return max(0, composerHeight) + max(0, safeAreaBottom) + endGap
    }

    /// Reading history starts beyond `readingDistance` and ends again within a third of it, so the composer
    /// does not flicker around the threshold. The clearance counts as the end of the conversation.
    public static func isReading(distanceFromEnd: Double, wasReading: Bool, clearance: Double) -> Bool {
        let distance = max(0, distanceFromEnd - max(0, clearance))
        return wasReading ? distance > readingDistance / 3 : distance > readingDistance
    }
}
