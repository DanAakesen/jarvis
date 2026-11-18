import JarvisCore
import SwiftUI

/// Shared controls of the Notes, Tasks and Graph pages and their sheets: the editor accessory, rows, banners,
/// task ring and swipe row. Screens compose these; the look (neutral smoked glass, amber text for primary labels,
/// no filled amber buttons) is changed here and nowhere else.
/// HIG: Toolbars, Buttons, Lists and tables, Context menus, Accessibility. API: safeAreaInset, Menu, DragGesture.

/// One icon action inside the editor accessory: a plain 44 pt target, no extra glass.
struct JarvisAccessoryToolButton: View {
    let title: String
    let systemImage: String
    var identifier: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: JarvisDesignTokens.iconButtonGlyphSize, weight: .regular))
                .foregroundStyle(JarvisDesignTokens.secondaryAccent.opacity(isDisabled ? 0.4 : 1))
                .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

struct JarvisAccessoryToolMenu<Content: View>: View {
    let title: String
    let systemImage: String
    var identifier: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        Menu {
            content()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: JarvisDesignTokens.iconButtonGlyphSize, weight: .regular))
                .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

/// The compact bar above the keyboard in every editor: Cancel on the left, Save on the right, tools between.
/// It sits in the bottom safe area, so it rides above the keyboard and stays reachable without one.
struct JarvisEditorAccessory<Tools: View>: View {
    let cancelTitle: String
    let saveTitle: String
    var isSaveDisabled = false
    var isSaving = false
    var isCancelDisabled = false
    var saveHint = ""
    let onCancel: () -> Void
    let onSave: () -> Void
    @ViewBuilder let tools: () -> Tools

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onCancel) {
                Text(cancelTitle)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Color.primary.opacity(isCancelDisabled ? 0.4 : 1))
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isCancelDisabled)
            .accessibilityIdentifier("editor.cancel")
            Spacer(minLength: 0)
            tools()
            Spacer(minLength: 0)
            Button(action: onSave) {
                Group {
                    if isSaving {
                        JarvisLoadingView(size: .inline)
                    } else {
                        Text(saveTitle)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(
                                isSaveDisabled ? Color.secondary.opacity(0.6) : JarvisDesignTokens.primaryAccent
                            )
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 12)
                .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isSaveDisabled || isSaving)
            .accessibilityLabel(saveTitle)
            .accessibilityHint(saveHint)
            .accessibilityIdentifier("editor.save")
        }
        .padding(.horizontal, 8)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
        .padding(.vertical, 6)
    }
}

/// A message above the keyboard or inside a sheet, with its recovery actions. The icon and the words carry the
/// meaning; the tint only supports them.
struct JarvisInlineBanner<Actions: View>: View {
    let message: String
    var systemImage = "exclamationmark.triangle.fill"
    var identifier = "notes.banner"
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: systemImage).foregroundStyle(.red).accessibilityHidden(true)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) { actions() }
        }
        .padding(JarvisDesignTokens.notesSectionSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

/// A row on a quiet surface: leading symbol, title, optional detail line and value, chevron when it opens something.
struct JarvisDetailRow: View {
    let title: String
    var subtitle: String?
    var value: String?
    var systemImage: String?
    var identifier = ""
    var isDisabled = false
    var action: (() -> Void)?

    private var label: some View {
        HStack(spacing: 12) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.body)
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                    .frame(width: 24)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                if let subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            if let value {
                Text(value).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
            }
            if action != nil {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, JarvisPageHeaderMetrics.rowInset)
        .padding(.vertical, JarvisPageHeaderMetrics.rowVerticalInset)
        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    var body: some View {
        if let action {
            Button(action: action) { label }
                .buttonStyle(.plain)
                .disabled(isDisabled)
                .opacity(isDisabled ? 0.5 : 1)
                .accessibilityValue(value ?? "")
                .accessibilityIdentifier(identifier)
        } else {
            label
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(identifier)
        }
    }
}

/// A single choice with a clear selection indicator (symbol and trait, not colour alone).
struct JarvisChoiceRow: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    var isSelected: Bool
    var isDisabled = false
    var identifier = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? JarvisDesignTokens.notesTaskRing : Color.secondary)
                    .accessibilityHidden(true)
                if let systemImage {
                    Image(systemName: systemImage).foregroundStyle(JarvisDesignTokens.secondaryAccent).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body).foregroundStyle(.primary)
                    if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, JarvisPageHeaderMetrics.rowInset)
            .padding(.vertical, JarvisPageHeaderMetrics.rowVerticalInset)
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.notesRowMinimumHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }
}

/// The open-task circle. Tapping it completes or reopens the task, separately from editing or deleting it.
struct JarvisTaskRing: View {
    var title: String
    var isDone = false
    var isBusy = false
    var isDisabled = false
    var diameter: CGFloat = 26
    var identifier = ""
    var action: (() -> Void)?

    private var glyph: some View {
        ZStack {
            if isBusy {
                JarvisLoadingView(size: .inline)
            } else if isDone {
                Image(systemName: "checkmark.circle.fill")
                    .resizable().scaledToFit()
                    .foregroundStyle(JarvisDesignTokens.notesTaskRing)
            } else {
                Circle().strokeBorder(JarvisDesignTokens.notesTaskRing, lineWidth: 2.5)
            }
        }
        .frame(width: diameter, height: diameter)
    }

    @ViewBuilder
    var body: some View {
        if let action {
            Button(action: action) {
                glyph
                    .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isDisabled || isBusy)
            .accessibilityLabel(title)
            .accessibilityAddTraits(isDone ? .isSelected : [])
            .accessibilityIdentifier(identifier)
        } else {
            glyph.accessibilityHidden(true)
        }
    }
}

/// A row with the approved swipe: short left swipe pins, long left swipe deletes. On a pinned row (`isPinned`) the
/// swipe only unpins, however far it goes. Pin and Delete are also named accessibility actions, so nothing depends
/// on the gesture. The owner confirms deletion; this row only asks.
struct JarvisPinDeleteSwipeRow<Content: View>: View {
    let title: String
    var accessibilityValue = ""
    var identifier: String
    let pinTitle: String
    let pinImage: String
    let deleteTitle: String
    var isPinned = false
    var isDisabled = false
    var extraActionTitle: String?
    var onExtra: (() -> Void)?
    let onOpen: () -> Void
    let onPin: () -> Void
    let onDelete: () -> Void
    @ViewBuilder let content: () -> Content
    @GestureState private var offset: CGFloat = 0
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    private let pinWidth = CGFloat(JarvisNotesLogic.pinSwipeDistance)
    private let deleteWidth = CGFloat(JarvisNotesLogic.deleteSwipeDistance)

    private var isDeleting: Bool { !isPinned && -offset >= deleteWidth }

    var body: some View {
        ZStack(alignment: .trailing) {
            VStack(spacing: 2) {
                Image(systemName: isDeleting ? "trash" : pinImage).font(.system(size: 20, weight: .medium))
                Text(isDeleting ? deleteTitle : pinTitle).font(.caption2.weight(.semibold)).lineLimit(1)
            }
            .foregroundStyle(isDeleting ? Color.white : Color.primary)
            .frame(width: pinWidth)
            .frame(maxHeight: .infinity)
            .background(isDeleting ? Color.red : (reduceTransparency ? JarvisDesignTokens.glassSolid : Color.primary.opacity(0.16)))
            .frame(width: max(0, -offset), alignment: .trailing)
            .clipped()
            .accessibilityHidden(true)

            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { if !isDisabled && offset == 0 { onOpen() } }
                .offset(x: offset)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(title)
                .accessibilityValue(accessibilityValue)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { if !isDisabled { onOpen() } }
                .accessibilityAction(named: Text(pinTitle)) { if !isDisabled { onPin() } }
                .accessibilityAction(named: Text(deleteTitle)) { if !isDisabled { onDelete() } }
                .modifier(JarvisOptionalAccessibilityAction(title: extraActionTitle, action: isDisabled ? nil : onExtra))
                .accessibilityIdentifier(identifier)
                .disabled(isDisabled)
        }
        .frame(maxWidth: .infinity)
        .clipShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .updating($offset) { value, state, _ in
                    guard !isDisabled, abs(value.translation.width) > abs(value.translation.height) else {
                        state = 0
                        return
                    }
                    state = min(0, max(isPinned ? -pinWidth : -deleteWidth, value.translation.width))
                }
                .onEnded { value in
                    guard !isDisabled, abs(value.translation.width) > abs(value.translation.height) else { return }
                    switch JarvisNotesLogic.swipeAction(distance: Double(-value.translation.width), allowsDelete: !isPinned) {
                    case .delete: onDelete()
                    case .pin: onPin()
                    case .none: break
                    }
                }
        )
    }
}

/// An accessibility action that exists only when the row has one, such as Complete on a task row.
private struct JarvisOptionalAccessibilityAction: ViewModifier {
    let title: String?
    let action: (() -> Void)?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let title, let action {
            content.accessibilityAction(named: Text(title), action)
        } else {
            content
        }
    }
}

/// A horizontal hairline for row separators drawn in an overlay, where `Divider` would pick the wrong axis.
struct JarvisHairline: View {
    var body: some View {
        Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 0.5).accessibilityHidden(true)
    }
}
