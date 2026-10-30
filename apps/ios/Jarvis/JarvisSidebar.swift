import JarvisCore
import SwiftUI

enum JarvisDesignTokens {
    static let sidebarWidthFraction: CGFloat = 0.74
    static let sidebarMaximumWidth: CGFloat = 320
    static let sidebarGestureStartFraction: CGFloat = 0.62
    static let sidebarOpenThreshold: CGFloat = 0.5
    static let sidebarRowHeight: CGFloat = 52
    static let sidebarRowSpacing: CGFloat = 2
    static let sidebarHorizontalInset: CGFloat = 24
    static let sidebarVerticalInset: CGFloat = 16
    static let sidebarIconSize: CGFloat = 21
    static let sidebarSpringResponse: CGFloat = 0.36
    static let sidebarSpringDamping: CGFloat = 0.88
    static let screenDimOpacity: CGFloat = 0.12
    static let screenBlurRadius: CGFloat = 4
}

private struct JarvisSidebarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.58 : 1)
            .contentShape(Rectangle())
    }
}

private struct JarvisSidebar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var navigation: JarvisNavigationState
    let safeAreaInsets: EdgeInsets

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Jarvis")
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
                Button {
                    navigate(to: .settings)
                } label: {
                    Image(systemName: JarvisDestination.settings.symbolName)
                        .font(.system(size: JarvisDesignTokens.sidebarIconSize))
                        .frame(width: JarvisDesignTokens.sidebarRowHeight, height: JarvisDesignTokens.sidebarRowHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(JarvisSidebarButtonStyle())
                .foregroundStyle(.primary)
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, JarvisDesignTokens.sidebarHorizontalInset)

            GeometryReader { scrollGeometry in
                ScrollView {
                    VStack(spacing: JarvisDesignTokens.sidebarRowSpacing) {
                        ForEach(Array(JarvisDestination.sidebarItems.reversed())) { destination in
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
        .background(Color(uiColor: .systemBackground))
        .accessibilityAction(named: Text("Close sidebar")) {
            withSidebarAnimation {
                navigation.closeSidebar()
            }
        }
    }

    private func sidebarRow(_ destination: JarvisDestination) -> some View {
        let isSelected = navigation.currentDestination == destination
        return Button {
            navigate(to: destination)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: destination.symbolName)
                    .font(.system(size: JarvisDesignTokens.sidebarIconSize))
                    .frame(width: JarvisDesignTokens.sidebarIconSize + 4)
                Text(destination.title)
                    .font(.body.weight(isSelected ? .semibold : .regular))
                Spacer(minLength: 0)
                if !destination.isNavigable {
                    Text("Later")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.sidebarRowHeight)
            .foregroundStyle(rowColor(for: destination, selected: isSelected))
        }
        .buttonStyle(JarvisSidebarButtonStyle())
        .disabled(!destination.isNavigable)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func rowColor(for destination: JarvisDestination, selected: Bool) -> Color {
        guard destination.isNavigable else { return .secondary }
        return selected ? .accentColor : .primary
    }

    private func navigate(to destination: JarvisDestination) {
        withSidebarAnimation {
            navigation.navigate(to: destination)
        }
    }

    private func withSidebarAnimation(_ update: () -> Void) {
        withAnimation(reduceMotion ? nil : .interactiveSpring(
            response: JarvisDesignTokens.sidebarSpringResponse,
            dampingFraction: JarvisDesignTokens.sidebarSpringDamping
        ), update)
    }
}
