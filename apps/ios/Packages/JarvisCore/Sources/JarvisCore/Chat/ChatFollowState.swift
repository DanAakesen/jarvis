/// Following is sticky across layout changes, but only a user scroll can resume it.
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

    public mutating func interactionEnded(distanceFromBottom: Double?) {
        guard isInteracting else { return }
        isInteracting = false
        if let distanceFromBottom, distanceFromBottom <= 44 {
            isFollowing = true
            hasNewMessages = false
        } else if distanceFromBottom != nil {
            isFollowing = false
        }
    }

    public mutating func messageArrived() {
        if !shouldFollow { hasNewMessages = true }
    }

    public mutating func contentChanged<Message: Equatable>(
        from oldMessages: [Message], to newMessages: [Message], hasOtherChanges: Bool
    ) {
        let onlyOlderMessagesAdded = !oldMessages.isEmpty && newMessages.count > oldMessages.count
            && newMessages.suffix(oldMessages.count).elementsEqual(oldMessages)
        if hasOtherChanges || (oldMessages != newMessages && !onlyOlderMessagesAdded) {
            messageArrived()
        }
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

    public mutating func selectionChanged(messageID: String, isSelected: Bool) {
        if isSelected {
            selectedMessages.insert(messageID)
        } else {
            selectedMessages.remove(messageID)
        }
    }
}
