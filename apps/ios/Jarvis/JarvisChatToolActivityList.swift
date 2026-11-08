import SwiftUI
import JarvisCore

/// Shared by live chat, saved chat and the isolated harness test conversation.
struct JarvisChatToolActivityList: View {
    let groups: [ChatToolActivityGroup]
    let language: JarvisAppLanguage
    let identifierPrefix: String
    @State private var expanded: Set<String> = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageDetailSpacing) {
            ForEach(groups) { group in
                if group.calls.count == 1, let call = group.calls.first {
                    callRow(call, title: displayName(group.toolName))
                        .accessibilityIdentifier("\(identifierPrefix).tool.\(call.id)")
                } else {
                    groupRow(group)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func groupRow(_ group: ChatToolActivityGroup) -> some View {
        let isExpanded = expanded.contains(group.id)
        return VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageDetailSpacing) {
            JarvisRowButton(identifier: "\(identifierPrefix).toolGroup.\(group.id)", action: {
                withAnimation(reduceMotion ? nil : .default) {
                    if isExpanded { expanded.remove(group.id) } else { expanded.insert(group.id) }
                }
            }) {
                HStack(alignment: .firstTextBaseline, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageDetailSpacing) {
                        Text("\(displayName(group.toolName)) ×\(group.calls.count)")
                        Text(summary(group)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if group.calls.contains(where: { $0.outcome == .refused || $0.outcome == .error }) {
                        Image(systemName: "exclamationmark.circle").foregroundStyle(.orange)
                            .accessibilityHidden(true)
                    }
                }
                .font(.caption)
            }
            .accessibilityValue(copy(isExpanded ? .menuExpanded : .menuCollapsed))
            if isExpanded {
                ForEach(Array(group.calls.enumerated()), id: \.element.id) { index, call in
                    callRow(call, title: "\(copy(.toolCall)) \(index + 1)")
                        .padding(.leading, JarvisDesignTokens.chatHorizontalInset)
                        .accessibilityIdentifier("\(identifierPrefix).toolCall.\(call.id)")
                }
            }
        }
    }

    private func callRow(_ call: ChatToolActivityGroup.Call, title: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Image(systemName: call.outcome == nil ? "ellipsis" : (call.outcome == .ok ? "checkmark.circle" : "exclamationmark.circle"))
                .foregroundStyle(call.outcome == .refused || call.outcome == .error ? Color.orange : Color.secondary)
                .accessibilityHidden(true)
            Text(title)
            Text(copy(statusKey(call.outcome))).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.caption)
        .accessibilityElement(children: .combine)
    }

    private func summary(_ group: ChatToolActivityGroup) -> String {
        let outcomes: [ChatToolOutcome?] = [.refused, .error, nil, .ok]
        return outcomes.compactMap { outcome in
            let count = group.calls.filter { $0.outcome == outcome }.count
            return count == 0 ? nil : "\(copy(statusKey(outcome))) \(count)"
        }.joined(separator: " · ")
    }

    private func statusKey(_ outcome: ChatToolOutcome?) -> JarvisChatLocalizationKey {
        switch outcome {
        case .ok: .toolOK
        case .refused: .toolRefused
        case .error: .toolError
        case nil: .toolRunning
        }
    }

    private func displayName(_ name: String) -> String { name.replacingOccurrences(of: "_", with: " ") }
    private func copy(_ key: JarvisChatLocalizationKey) -> String { JarvisChatLocalization.string(key, language: language) }
}
