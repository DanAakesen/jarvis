import Foundation

enum NavigationBisectVariant: String {
    case A, B, C, D, E, F, G, H, I, J, K

    static var current: Self? {
#if DEBUG && targetEnvironment(simulator)
        let arguments = ProcessInfo.processInfo.arguments
        let prefix = "--ui-test-navigation-variant="
        guard arguments.contains("--ui-test-navigation"),
              let argument = arguments.first(where: { $0.hasPrefix(prefix) }) else { return nil }
        return Self(rawValue: String(argument.dropFirst(prefix.count)))
#else
        return nil
#endif
    }
}
