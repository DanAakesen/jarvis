import JarvisCore
import SwiftUI

struct ContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var sidebarDrag = SidebarDrag()
    @State private var navigation = JarvisNavigationState()
    @State private var animationTargetProgress: CGFloat = 0
    @State private var presentedProgress: CGFloat = 0
    @State private var dragStartProgress: CGFloat?
    private let chatClient: JarvisClient?
    private let startupError: String?
    private let fixtureMode: Bool

    init() {
        let sidebarInitiallyOpen = ProcessInfo.processInfo.arguments.contains("--screenshot-sidebar-open")
        let fixtureMode = ProcessInfo.processInfo.arguments.contains("--screenshot-chat-fixture")
        var initialNavigation = JarvisNavigationState()
        if sidebarInitiallyOpen {
            initialNavigation.openSidebar()
        }
        self.fixtureMode = fixtureMode
        if fixtureMode {
            let client = try? JarvisFixtureScenario.makeClient()
            chatClient = client
            startupError = client == nil ? "Fixture preview is unavailable." : nil
        } else {
            do {
                chatClient = try JarvisComposition.makeClient(
                    accessTokenProvider: JarvisUnavailableAccessTokenProvider()
                )
                startupError = nil
            } catch {
                chatClient = nil
                startupError = "Chat isn't configured."
            }
        }
        _navigation = State(initialValue: initialNavigation)
        _animationTargetProgress = State(initialValue: sidebarInitiallyOpen ? 1 : 0)
        _presentedProgress = State(initialValue: sidebarInitiallyOpen ? 1 : 0)
    }

    var body: some View {
        GeometryReader { geometry in
            let drawerWidth = min(
                geometry.size.width * JarvisDesignTokens.sidebarWidthFraction,
                JarvisDesignTokens.sidebarMaximumWidth
            )
            let progress = sidebarDrag.isActive
                ? min(max(sidebarDrag.startProgress - sidebarDrag.translation / max(drawerWidth, 1), 0), 1)
                : presentedProgress

            ZStack(alignment: .trailing) {
                JarvisSidebar(
                    currentDestination: navigation.currentDestination,
                    isOpen: navigation.isSidebarOpen,
                    safeAreaInsets: geometry.safeAreaInsets,
                    onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) },
                    onClose: closeSidebar
                )
                .frame(width: drawerWidth, height: geometry.size.height)
                .frame(maxWidth: .infinity, alignment: .trailing)

                NavigationStack(
                    path: Binding(
                        get: { navigation.path },
                        set: { navigation.setPath($0) }
                    )
                ) {
                    JarvisChatScreen(
                        client: chatClient,
                        fixtureMode: fixtureMode,
                        startupError: startupError,
                        onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) }
                    )
                        .navigationDestination(for: JarvisDestination.self) { destination in
                            if destination == .chat {
                                JarvisChatScreen(
                                    client: chatClient,
                                    fixtureMode: fixtureMode,
                                    startupError: startupError,
                                    onNavigate: { navigate(to: $0, drawerWidth: drawerWidth) }
                                )
                            } else {
                                JarvisPlaceholderView(destination: destination)
                            }
                        }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .background(Color(uiColor: .systemBackground))
                .overlay {
                    Color.black
                        .opacity(progress * JarvisDesignTokens.screenDimOpacity)
                        .accessibilityHidden(true)
                }
                .blur(radius: progress * JarvisDesignTokens.screenBlurRadius)
                .offset(x: -drawerWidth * progress)
                .contentShape(Rectangle())
                .overlay {
                    if progress > 0 {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture(perform: closeSidebar)
                            .accessibilityHidden(true)
                    }
                }
                .gesture(sidebarDragGesture(
                    screenWidth: geometry.size.width,
                    drawerWidth: drawerWidth
                ))
                .accessibilityAction(named: Text("Open sidebar")) {
                    setSidebarOpen(true)
                }
                .accessibilityHidden(navigation.isSidebarOpen)

                Color.clear
                    .frame(width: 1, height: 1)
                    .modifier(SidebarProgressObserver(progress: animationTargetProgress) { value in
                        reportPresentedProgress(value)
                    })
                    .animation(sidebarAnimation, value: animationTargetProgress)
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .background(Color(uiColor: .systemBackground))
            .coordinateSpace(name: "sidebar")
            .clipped()
        }
        .ignoresSafeArea()
    }

    private func sidebarDragGesture(
        screenWidth: CGFloat,
        drawerWidth: CGFloat
    ) -> some Gesture {
        DragGesture(
            minimumDistance: JarvisDesignTokens.sidebarGestureMinimumDistance,
            coordinateSpace: .named("sidebar")
        )
            .updating($sidebarDrag) { value, state, transaction in
                let startProgress = state.isActive ? state.startProgress : presentedProgress
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth,
                    startProgress: startProgress
                ) else { return }
                state = SidebarDrag(
                    startProgress: startProgress,
                    translation: value.translation.width,
                    isActive: true
                )
                transaction.disablesAnimations = true
            }
            .onChanged { value in
                guard dragStartProgress == nil else { return }
                let startProgress = presentedProgress
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth,
                    startProgress: startProgress
                ) else { return }
                dragStartProgress = startProgress
            }
            .onEnded { value in
                guard let startProgress = dragStartProgress else { return }
                dragStartProgress = nil
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth,
                    startProgress: startProgress
                ) else { return }
                let projectedProgress = startProgress - value.predictedEndTranslation.width / max(drawerWidth, 1)
                let currentProgress = startProgress - value.translation.width / max(drawerWidth, 1)
                setSidebarOpen(
                    projectedProgress > JarvisDesignTokens.sidebarOpenThreshold,
                    fromProgress: min(max(currentProgress, 0), 1)
                )
            }
    }

    private func canBeginSidebarDrag(
        _ value: DragGesture.Value,
        screenWidth: CGFloat,
        drawerWidth: CGFloat,
        startProgress: CGFloat
    ) -> Bool {
        guard abs(value.translation.width) > abs(value.translation.height) else { return false }
        if startProgress > 0 {
            return value.startLocation.x < screenWidth - drawerWidth * startProgress
        }
        return value.startLocation.x >= screenWidth * JarvisDesignTokens.sidebarGestureStartFraction
            && value.translation.width < 0
    }

    private var sidebarAnimation: Animation? {
        reduceMotion ? nil : .interactiveSpring(
                response: JarvisDesignTokens.sidebarSpringResponse,
                dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        )
    }

    private func setSidebarOpen(_ open: Bool, fromProgress: CGFloat? = nil) {
        let currentProgress = min(max(fromProgress ?? presentedProgress, 0), 1)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            animationTargetProgress = currentProgress
            presentedProgress = currentProgress
        }
        navigation.setSidebarOpen(open)
        animateSidebar(to: open ? 1 : 0)
    }

    private func navigate(to destination: JarvisDestination, drawerWidth: CGFloat) {
        let currentProgress = sidebarDrag.isActive
            ? sidebarDrag.startProgress - sidebarDrag.translation / max(drawerWidth, 1)
            : presentedProgress
        let boundedProgress = min(max(currentProgress, 0), 1)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            animationTargetProgress = boundedProgress
            presentedProgress = boundedProgress
        }
        navigation.navigate(to: destination)
        animateSidebar(to: navigation.isSidebarOpen ? 1 : 0)
    }

    private func animateSidebar(to progress: CGFloat) {
        if reduceMotion {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                animationTargetProgress = progress
                presentedProgress = progress
            }
        } else {
            DispatchQueue.main.async {
                withAnimation(sidebarAnimation) {
                    animationTargetProgress = progress
                }
            }
        }
    }

    private func reportPresentedProgress(_ progress: CGFloat) {
        guard abs(presentedProgress - progress) > 0.001 else { return }
        DispatchQueue.main.async {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                presentedProgress = progress
            }
        }
    }

    private func closeSidebar() {
        setSidebarOpen(false)
    }
}

private struct SidebarDrag: Equatable {
    var startProgress: CGFloat = 0
    var translation: CGFloat = 0
    var isActive = false
}

private struct SidebarProgressObserver: AnimatableModifier {
    var progress: CGFloat
    let onChange: (CGFloat) -> Void

    var animatableData: CGFloat {
        get { progress }
        set {
            progress = newValue
            onChange(newValue)
        }
    }

    func body(content: Content) -> some View {
        content.onAppear { onChange(progress) }
    }
}

private struct JarvisPlaceholderView: View {
    let destination: JarvisDestination

    var body: some View {
        Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(destination.title)
            .navigationBarTitleDisplayMode(.inline)
    }
}
