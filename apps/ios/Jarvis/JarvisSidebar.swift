import JarvisCore
import SwiftUI

enum JarvisDesignTokens {
    static let controlMinimumHeight: CGFloat = 44
    static let contentInset: CGFloat = 20
    static let contentSpacing: CGFloat = 16
    static let rowSpacing: CGFloat = 12
    static let compactSpacing: CGFloat = 4
    static let iconLabelSpacing: CGFloat = 6
    static let timelineMarkerTopInset: CGFloat = 7
    static let surfaceCornerRadius: CGFloat = 16
    static let listRowVerticalInset: CGFloat = 12
    static let emptyStateHeight: CGFloat = 180
    static let searchDebounceMilliseconds: Int64 = 250
    static let openedFeedbackMilliseconds: Int64 = 1_600
    static let filterAnimationDuration: Double = 0.18
    static let chartHeight: CGFloat = 220
    static let chartAreaOpacity: Double = 0.16
    static let chartMinimumPointSpacing: CGFloat = 40
    static let chartMaximumWidth: CGFloat = 1_200
    static let timelineMarkerSize: CGFloat = 8
    static let chartSeriesColors: [Color] = [.accentColor, .blue, .green, .orange, .purple]
    static let iconSize: CGFloat = 20
    static let sidebarWidthFraction: CGFloat = 0.74
    static let sidebarMaximumWidth: CGFloat = 320
    static let sidebarGestureStartFraction: CGFloat = 0.62
    static let sidebarGestureMinimumDistance: CGFloat = 8
    static let sidebarOpenThreshold: CGFloat = 0.5
    static let sidebarRowHeight: CGFloat = 52
    static let sidebarRowSpacing: CGFloat = 2
    static let sidebarRowLabelSpacing: CGFloat = 14
    static let sidebarHorizontalInset: CGFloat = 24
    static let sidebarVerticalInset: CGFloat = 16
    static let sidebarIconSize: CGFloat = 21
    static let sidebarIconColumnWidth: CGFloat = 25
    static let sidebarPressedOpacity: CGFloat = 0.58
    static let sidebarSpringResponse: CGFloat = 0.36
    static let sidebarSpringDamping: CGFloat = 0.88
    static let screenDimOpacity: CGFloat = 0.12
    static let screenBlurRadius: CGFloat = 4
}

private struct JarvisSidebarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? JarvisDesignTokens.sidebarPressedOpacity : 1)
            .contentShape(Rectangle())
    }
}

struct JarvisSidebar: View {
    @FocusState private var focusedDestination: JarvisDestination?
    @FocusState private var settingsFocused: Bool
    @State private var hoveredDestination: JarvisDestination?
    @State private var settingsHovered = false
    let currentDestination: JarvisDestination
    let isOpen: Bool
    let safeAreaInsets: EdgeInsets
    let onNavigate: (JarvisDestination) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Jarvis")
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
                Button {
                    onNavigate(.settings)
                } label: {
                    Image(systemName: JarvisDestination.settings.symbolName)
                        .font(.system(size: JarvisDesignTokens.sidebarIconSize))
                        .frame(width: JarvisDesignTokens.sidebarRowHeight, height: JarvisDesignTokens.sidebarRowHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(JarvisSidebarButtonStyle())
                .foregroundStyle(settingsFocused || settingsHovered ? Color.accentColor : Color.primary)
                .accessibilityLabel("Settings")
                .focused($settingsFocused)
                .onHover { settingsHovered = $0 }
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
        .accessibilityHidden(!isOpen)
        .accessibilityAction(named: Text("Close sidebar")) {
            onClose()
        }
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
                    .frame(width: JarvisDesignTokens.sidebarIconColumnWidth)
                Text(destination.title)
                    .font(.body.weight(isHighlighted ? .semibold : .regular))
                Spacer(minLength: 0)
                if !destination.isNavigable {
                    Text("Later")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.sidebarRowHeight)
            .foregroundStyle(rowColor(for: destination, selected: isHighlighted))
        }
        .buttonStyle(JarvisSidebarButtonStyle())
        .disabled(!destination.isNavigable)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .focused($focusedDestination, equals: destination)
        .onHover { hoveredDestination = $0 ? destination : nil }
    }

    private func rowColor(for destination: JarvisDestination, selected: Bool) -> Color {
        guard destination.isNavigable else { return .secondary }
        return selected ? Color.accentColor : Color.primary
    }
}
