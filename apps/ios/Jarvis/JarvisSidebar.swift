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

struct JarvisSidebar: View {
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var focusedDestination: JarvisDestination?
    @FocusState private var settingsFocused: Bool
    @State private var hoveredDestination: JarvisDestination?
    @State private var settingsHovered = false
    let currentDestination: JarvisDestination
    let isOpen: Bool
    let safeAreaInsets: EdgeInsets
    let onNavigate: (JarvisDestination) -> Void
    let onClose: () -> Void

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
                        .frame(
                            width: JarvisDesignTokens.sidebarSettingsButtonSize,
                            height: JarvisDesignTokens.sidebarSettingsButtonSize
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(JarvisSidebarButtonStyle())
                .foregroundStyle(
                    settingsFocused || settingsHovered
                        ? JarvisDesignTokens.primaryAccent
                        : Color.primary
                )
                .accessibilityLabel(JarvisDestination.settings.localizedTitle(language: language))
                .accessibilityIdentifier("sidebar.settings")
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
                let bottomInset = safeAreaInsets.bottom
                    + JarvisDesignTokens.sidebarVerticalInset
                ScrollViewReader { scrollProxy in
                    ScrollView {
                        VStack(spacing: JarvisDesignTokens.sidebarRowSpacing) {
                            ForEach(JarvisDestination.sidebarItems) { destination in
                                sidebarRow(destination)
                                    .id(destination)
                            }
                        }
                        .frame(
                            maxWidth: .infinity,
                            minHeight: max(
                                0,
                                scrollGeometry.size.height -
                                    safeAreaInsets.bottom -
                                    JarvisDesignTokens.sidebarVerticalInset
                            ),
                            alignment: .bottom
                        )
                        .padding(.horizontal, JarvisDesignTokens.sidebarHorizontalInset)
                        .padding(.bottom, bottomInset)
                    }
                    .scrollIndicators(.hidden)
                    .onChange(of: isOpen, initial: true) { _, isOpen in
                        if isOpen {
                            scrollProxy.scrollTo(currentDestination, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .padding(.top, safeAreaInsets.top + JarvisDesignTokens.sidebarVerticalInset)
        .background(JarvisGlassSurface())
        .accessibilityHidden(!isOpen)
        .accessibilityAction(named: Text(JarvisNotesLocalization.string(.closeSidebar, language: language))) {
            onClose()
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
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("sidebar.\(destination.rawValue)")
        .focused($focusedDestination, equals: destination)
        .onHover { hoveredDestination = $0 ? destination : nil }
    }

    private func rowColor(for destination: JarvisDestination, selected: Bool) -> Color {
        guard destination.isNavigable else { return .secondary }
        return selected ? JarvisDesignTokens.primaryAccent : Color.primary
    }
}
