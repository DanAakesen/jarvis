import JarvisCore
import SwiftUI
import UIKit

private struct JarvisSidebarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? JarvisDesignTokens.sidebarPressedOpacity : 1)
            .contentShape(Rectangle())
    }
}

/// Reveal container at the app root: the drawer sits behind the page and the page slides sideways to
/// uncover it. It renders from the root-owned navigation model only (committed state plus the transient
/// swipe progress), so no screen, sheet, or voice state can leave the page offset or a tap-catcher behind.
struct JarvisSidebarReveal<Page: View>: View {
    @EnvironmentObject private var navigation: JarvisNavigationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var isDraggingClosed = false
    private let page: Page

    init(@ViewBuilder page: () -> Page) {
        self.page = page()
    }

    private var animation: Animation? {
        reduceMotion || navigation.dragProgress != nil ? nil : .interactiveSpring(
            response: JarvisDesignTokens.sidebarSpringResponse,
            dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        )
    }

    private func closeSwipe(drawerWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: JarvisDesignTokens.sidebarGestureMinimumDistance)
            .updating($isDraggingClosed) { _, state, _ in state = true }
            .onChanged { value in
                guard value.translation.width > 0,
                      abs(value.translation.width) > abs(value.translation.height) else { return }
                navigation.updateDrag(progress: 1 - Double(value.translation.width / max(drawerWidth, 1)))
            }
            .onEnded { value in
                guard JarvisSidebarGesturePolicy.shouldClose(
                    translationX: Double(value.translation.width),
                    translationY: Double(value.translation.height),
                    velocityX: Double(value.velocity.width),
                    drawerWidth: Double(drawerWidth),
                    closeThreshold: Double(JarvisDesignTokens.sidebarCloseThreshold)
                ) else {
                    navigation.cancelDrag()
                    return
                }
                navigation.closeSidebar()
            }
    }

    var body: some View {
        GeometryReader { geometry in
            let drawerWidth = min(
                geometry.size.width * JarvisDesignTokens.sidebarWidthFraction,
                JarvisDesignTokens.sidebarMaximumWidth
            )
            let progress = CGFloat(navigation.revealProgress)
            ZStack(alignment: .trailing) {
                if progress > 0 {
                    JarvisSidebar(
                        currentDestination: navigation.currentDestination,
                        safeAreaInsets: ContentView.resolvedSafeAreaInsets(fallback: geometry.safeAreaInsets),
                        onNavigate: { navigation.navigate(to: $0) }
                    )
                    .frame(width: drawerWidth, height: geometry.size.height)
                    .background { JarvisScreenBackground() }
                }

                page
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .allowsHitTesting(progress == 0)
                    .overlay {
                        if progress > 0 {
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture { navigation.closeSidebar() }
                                .gesture(closeSwipe(drawerWidth: drawerWidth))
                                .accessibilityHidden(true)
                        }
                    }
                    .shadow(color: .black.opacity(JarvisDesignTokens.screenDimOpacity * Double(progress)), radius: 14)
                    .offset(x: -drawerWidth * progress)
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .trailing)
            .animation(animation, value: progress)
            .onChange(of: isDraggingClosed) { _, dragging in
                if !dragging { navigation.cancelDrag() }
            }
        }
        .ignoresSafeArea(.container)
    }
}

struct JarvisSidebar: View {
    @EnvironmentObject private var navigation: JarvisNavigationModel
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var focusedDestination: JarvisDestination?
    @FocusState private var settingsFocused: Bool
    @State private var hoveredDestination: JarvisDestination?
    @State private var settingsHovered = false
    let currentDestination: JarvisDestination
    let safeAreaInsets: EdgeInsets
    let onNavigate: (JarvisDestination) -> Void

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Jarvis")
                    .font(.system(size: JarvisDesignTokens.sidebarBrandFontSize, weight: .bold))
                    .foregroundStyle(.primary)
                Spacer()
                Button {
                    onNavigate(.settings)
                } label: {
                    Image(systemName: JarvisDestination.settings.symbolName)
                        .font(.system(size: JarvisDesignTokens.sidebarIconSize))
                        .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                        .frame(
                            width: JarvisDesignTokens.sidebarSettingsButtonSize,
                            height: JarvisDesignTokens.sidebarSettingsButtonSize
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(JarvisSidebarButtonStyle())
                .accessibilityLabel(JarvisDestination.settings.localizedTitle(language: language))
                .focused($settingsFocused)
                .onHover { settingsHovered = $0 }
            }
            .padding(.leading, JarvisDesignTokens.sidebarHeaderLeadingInset)
            .padding(.trailing, JarvisDesignTokens.sidebarHeaderTrailingInset)

            Rectangle()
                .fill(Color(uiColor: .separator))
                .frame(height: JarvisDesignTokens.sidebarHeaderRuleHeight)
                .padding(.horizontal, JarvisDesignTokens.sidebarHeaderRuleInset)
                .padding(.vertical, JarvisDesignTokens.sidebarHeaderRuleVerticalInset)

            GeometryReader { scrollGeometry in
                ScrollView {
                    VStack(spacing: JarvisDesignTokens.sidebarRowSpacing) {
                        ForEach(JarvisDestination.sidebarItems) { destination in
                            sidebarRow(destination)
                        }
                    }
                    .frame(
                        maxWidth: .infinity,
                        minHeight: scrollGeometry.size.height,
                        alignment: .bottom
                    )
                    .padding(.horizontal, JarvisDesignTokens.sidebarHorizontalInset)
                    .padding(.bottom, safeAreaInsets.bottom + JarvisDesignTokens.sidebarVerticalInset)
                }
                .scrollIndicators(.hidden)
            }
        }
        .padding(.top, safeAreaInsets.top + JarvisDesignTokens.sidebarVerticalInset)
        .background(JarvisGlassSurface())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("navigation.sidebar")
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(named: Text(JarvisNotesLocalization.string(.closeSidebar, language: language))) {
            navigation.closeSidebar()
        }
        .environment(\.locale, language.locale)
    }

    private func sidebarRow(_ destination: JarvisDestination) -> some View {
        let isSelected = currentDestination == destination
        let isHighlighted = isSelected
            || focusedDestination == destination
            || hoveredDestination == destination
        return Button {
            onNavigate(destination)
        } label: {
            HStack(spacing: JarvisDesignTokens.sidebarRowLabelSpacing) {
                Image(systemName: destination.symbolName)
                    .font(.system(size: JarvisDesignTokens.sidebarIconSize))
                    .foregroundStyle(destination.isNavigable ? JarvisDesignTokens.secondaryAccent : Color.secondary)
                    .frame(width: JarvisDesignTokens.sidebarIconColumnWidth)
                Text(destination.localizedTitle(language: language))
                    .font(.body.weight(isHighlighted ? .semibold : .regular))
                Spacer(minLength: 0)
                if !destination.isNavigable {
                    Text(JarvisNotesLocalization.string(.later, language: language))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.sidebarRowHeight)
            .foregroundStyle(rowColor(for: destination, selected: isHighlighted))
        }
        .buttonStyle(JarvisSidebarButtonStyle())
        .disabled(!destination.isNavigable)
        .accessibilityIdentifier("navigation.\(destination.rawValue)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .focused($focusedDestination, equals: destination)
        .onHover { hoveredDestination = $0 ? destination : nil }
    }

    private func rowColor(for destination: JarvisDestination, selected: Bool) -> Color {
        guard destination.isNavigable else { return .secondary }
        return selected ? JarvisDesignTokens.primaryAccent : Color.primary
    }
}
