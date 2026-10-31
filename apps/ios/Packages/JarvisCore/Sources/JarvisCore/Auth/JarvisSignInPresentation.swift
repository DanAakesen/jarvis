public enum JarvisSignInPresentation {
    public static func canPresent(
        isHidden: Bool,
        alpha: Double,
        isForegroundActive: Bool,
        isPrivacyCover: Bool,
        hasRootViewController: Bool
    ) -> Bool {
        !isHidden && alpha > 0 && isForegroundActive && !isPrivacyCover && hasRootViewController
    }

    @MainActor
    public static func window<Window>(
        from windows: [Window],
        canPresent: (Window) -> Bool,
        level: (Window) -> Double,
        isKeyWindow: (Window) -> Bool
    ) -> Window? {
        var selected: Window?
        for window in windows where canPresent(window) {
            if let current = selected {
                guard level(window) > level(current) ||
                    (level(window) == level(current) && isKeyWindow(window) && !isKeyWindow(current))
                else { continue }
            }
            selected = window
        }
        return selected
    }

    @MainActor
    public static func viewController<Controller>(
        from root: Controller,
        next: (Controller) -> Controller?,
        canPresent: (Controller) -> Bool
    ) -> Controller? {
        var controller = root
        while let child = next(controller) {
            controller = child
        }
        return canPresent(controller) ? controller : nil
    }
}
