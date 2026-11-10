/// Following is sticky across layout changes, but only a user scroll can resume it.
public struct ChatFollowState: Equatable, Sendable {
    public private(set) var isFollowing = true
    private var isInteracting = false
    private var selectedMessages: Set<String> = []

    public init() {}

    public var shouldFollow: Bool {
        isFollowing && !isInteracting && selectedMessages.isEmpty
    }

    public mutating func interactionBegan() {
        isInteracting = true
    }

    public mutating func interactionEnded(distanceFromBottom: Double?) {
        guard isInteracting else { return }
        isInteracting = false
        if let distanceFromBottom { isFollowing = distanceFromBottom <= 44 }
    }

    public mutating func selectionChanged(messageID: String, isSelected: Bool) {
        if isSelected {
            selectedMessages.insert(messageID)
        } else {
            selectedMessages.remove(messageID)
        }
    }
}
