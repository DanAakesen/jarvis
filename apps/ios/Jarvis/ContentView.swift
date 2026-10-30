import JarvisCore
import SwiftUI

struct ContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var sidebarDrag = SidebarDrag()
    @State private var navigation = JarvisNavigationState()

    var body: some View {
        GeometryReader { geometry in
            let drawerWidth = min(
                geometry.size.width * JarvisDesignTokens.sidebarWidthFraction,
                JarvisDesignTokens.sidebarMaximumWidth
            )
            let settledProgress: CGFloat = navigation.isSidebarOpen ? 1 : 0
            let progress = sidebarDrag.isActive
                ? min(max(settledProgress - sidebarDrag.translation / max(drawerWidth, 1), 0), 1)
                : settledProgress

            ZStack(alignment: .trailing) {
                JarvisSidebar(
                    navigation: $navigation,
                    safeAreaInsets: geometry.safeAreaInsets
                )
                .frame(width: drawerWidth, height: geometry.size.height)
                .frame(maxWidth: .infinity, alignment: .trailing)

                NavigationStack(
                    path: Binding(
                        get: { navigation.path },
                        set: { navigation.setPath($0) }
                    )
                ) {
                    JarvisPlaceholderView(destination: .chat)
                        .navigationDestination(for: JarvisDestination.self) { destination in
                            JarvisPlaceholderView(destination: destination)
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
        DragGesture(minimumDistance: 8, coordinateSpace: .named("sidebar"))
            .updating($sidebarDrag) { value, state, transaction in
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth
                ) else { return }
                state = SidebarDrag(translation: value.translation.width, isActive: true)
                transaction.disablesAnimations = true
            }
            .onEnded { value in
                guard canBeginSidebarDrag(
                    value,
                    screenWidth: screenWidth,
                    drawerWidth: drawerWidth
                ) else { return }
                let startProgress: CGFloat = navigation.isSidebarOpen ? 1 : 0
                let projectedProgress = startProgress - value.predictedEndTranslation.width / max(drawerWidth, 1)
                setSidebarOpen(projectedProgress > JarvisDesignTokens.sidebarOpenThreshold)
            }
    }

    private func canBeginSidebarDrag(
        _ value: DragGesture.Value,
        screenWidth: CGFloat,
        drawerWidth: CGFloat
    ) -> Bool {
        guard abs(value.translation.width) > abs(value.translation.height) else { return false }
        if navigation.isSidebarOpen {
            return value.startLocation.x < screenWidth - drawerWidth && value.translation.width > 0
        }
        return value.startLocation.x >= screenWidth * JarvisDesignTokens.sidebarGestureStartFraction
            && value.translation.width < 0
    }

    private func setSidebarOpen(_ open: Bool) {
        withAnimation(reduceMotion ? nil : .interactiveSpring(
            response: JarvisDesignTokens.sidebarSpringResponse,
            dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        )) {
            navigation.setSidebarOpen(open)
        }
    }

    private func closeSidebar() {
        setSidebarOpen(false)
    }
}

private struct SidebarDrag: Equatable {
    var translation: CGFloat = 0
    var isActive = false
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
