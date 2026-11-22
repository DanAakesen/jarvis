/// Following is sticky across layout changes and pauses while the owner reads older messages.
public struct ChatFollowState: Equatable, Sendable {
    public private(set) var isFollowing = true
    public private(set) var hasNewMessages = false
    private var isInteracting = false
    private var selectedMessages: Set<String> = []

    public init() {}

    public var shouldFollow: Bool {
        isFollowing && !isInteracting && selectedMessages.isEmpty
    }

    public var shouldShowJumpToLatest: Bool {
        hasNewMessages && !shouldFollow
    }

    public mutating func interactionBegan() {
        isInteracting = true
    }

    @discardableResult
    public mutating func interactionEnded(distanceFromBottom: Double?) -> Bool {
        guard isInteracting else { return false }
        isInteracting = false
        if let distanceFromBottom {
            isFollowing = distanceFromBottom <= 44
        }
        if shouldFollow { hasNewMessages = false }
        return shouldFollow
    }

    public mutating func messageArrived() {
        hasNewMessages = !shouldFollow
    }

    public mutating func messageSent() {
        isFollowing = true
        isInteracting = false
        hasNewMessages = false
        selectedMessages.removeAll()
    }

    public mutating func jumpedToLatest() {
        messageSent()
    }

    public mutating func notificationMessageOpened() {
        isFollowing = false
        isInteracting = false
        hasNewMessages = true
        selectedMessages.removeAll()
    }

    /// The keyboard came up under the composer: the owner is writing, so the latest message must stay in view.
    public mutating func keyboardOpened() {
        messageSent()
    }

    public mutating func selectionChanged(messageID: String, isSelected: Bool) {
        if isSelected {
            selectedMessages.insert(messageID)
        } else {
            selectedMessages.remove(messageID)
            if shouldFollow { hasNewMessages = false }
        }
    }
}
