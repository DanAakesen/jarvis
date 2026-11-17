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
        let title = displayName(group.toolName)
        return VStack(alignment: .leading, spacing: 0) {
            JarvisRowButton(identifier: "\(identifierPrefix).toolGroup.\(group.id)", action: {
                withAnimation(reduceMotion ? nil : .default) {
                    if isExpanded { expanded.remove(group.id) } else { expanded.insert(group.id) }
                }
            }) {
                JarvisToolActivityRow(kind: group.kind, status: group.status, title: title,
                                      statusText: statusText(group.status), isExpanded: isExpanded)
            }
            .accessibilityLabel(accessibilityLabel(title, group.status))
            .accessibilityValue(copy(isExpanded ? .menuExpanded : .menuCollapsed))
            if isExpanded {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageDetailSpacing) {
                    ForEach(Array(group.calls.enumerated()), id: \.element.id) { index, call in
                        callRow(call, title: "\(copy(.toolCall)) \(index + 1)")
                            .accessibilityIdentifier("\(identifierPrefix).toolCall.\(call.id)")
                    }
                }
                .padding(.leading, JarvisDesignTokens.chatHorizontalInset)
            }
        }
    }

    private func callRow(_ call: ChatToolActivityGroup.Call, title: String) -> some View {
        JarvisToolActivityRow(kind: call.kind, status: call.status, title: title, statusText: statusText(call.status))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel(title, call.status))
    }

    /// Success and running are shown by the icon alone; problems also say so in text so colour is never the only cue.
    private func statusText(_ status: ChatToolStatus) -> String? {
        switch status {
        case .failed: copy(.toolError)
        case .refused: copy(.toolRefused)
        case .running, .succeeded: nil
        }
    }

    private func accessibilityLabel(_ title: String, _ status: ChatToolStatus) -> String {
        let state: JarvisChatLocalizationKey = switch status {
        case .running: .toolRunning
        case .succeeded: .toolOK
        case .failed: .toolError
        case .refused: .toolRefused
        }
        return "\(title), \(copy(state))"
    }

    private func displayName(_ name: String) -> String {
        let words = name.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
    private func copy(_ key: JarvisChatLocalizationKey) -> String { JarvisChatLocalization.string(key, language: language) }
}
