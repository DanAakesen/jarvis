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

/// Top-most layer of the app root. It renders from the root-owned navigation model only, so no
/// screen, sheet, or voice state below it can hide the drawer or leave a stale scrim behind.
struct JarvisSidebarDrawerLayer: View {
    @EnvironmentObject private var navigation: JarvisNavigationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var animation: Animation? {
        reduceMotion ? nil : .interactiveSpring(
            response: JarvisDesignTokens.sidebarSpringResponse,
            dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        )
    }

    private func closeSwipe(drawerWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: JarvisDesignTokens.sidebarGestureMinimumDistance)
            .onEnded { value in
                guard JarvisSidebarGesturePolicy.shouldClose(
                    translationX: Double(value.translation.width),
                    translationY: Double(value.translation.height),
                    velocityX: Double(value.velocity.width),
                    drawerWidth: Double(drawerWidth),
                    closeThreshold: Double(JarvisDesignTokens.sidebarCloseThreshold)
                ) else { return }
                navigation.closeSidebar()
            }
    }

    var body: some View {
        GeometryReader { geometry in
            let drawerWidth = min(
                geometry.size.width * JarvisDesignTokens.sidebarWidthFraction,
                JarvisDesignTokens.sidebarMaximumWidth
            )
            ZStack(alignment: .trailing) {
                if navigation.isSidebarOpen {
                    Color.black.opacity(JarvisDesignTokens.screenDimOpacity)
                        .ignoresSafeArea()
                        .padding(.trailing, drawerWidth)
                        .contentShape(Rectangle())
                        .onTapGesture { navigation.closeSidebar() }
                        .gesture(closeSwipe(drawerWidth: drawerWidth))
                        .accessibilityHidden(true)

                    JarvisSidebar(
                        currentDestination: navigation.currentDestination,
                        safeAreaInsets: ContentView.resolvedSafeAreaInsets(fallback: geometry.safeAreaInsets),
                        onNavigate: { navigation.navigate(to: $0) }
                    )
                    .frame(width: drawerWidth, height: geometry.size.height)
                    .transition(reduceMotion ? .opacity : .move(edge: .trailing))
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .trailing)
        }
        .ignoresSafeArea(.container)
        .allowsHitTesting(navigation.isSidebarOpen)
        .animation(animation, value: navigation.isSidebarOpen)
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
