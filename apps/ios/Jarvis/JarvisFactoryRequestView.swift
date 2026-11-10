import JarvisCore
import SwiftUI

struct JarvisFactoryRequestView: View {
    let request: String
    let copy: JarvisFactoryCopy

    @State private var isExpanded = false
    @State private var hasOverflow = false

    private let collapsedLineLimit = 5

    private var requestText: some View {
        Text(verbatim: request)
            .font(.body)
    }

    private var toggleTitle: String {
        copy.text(isExpanded ? .showLess : .showMore)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            requestText
                .lineLimit(isExpanded ? nil : collapsedLineLimit)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("factory.request.text")
                .background {
                    GeometryReader { geometry in
                        // Neither measurement depends on the visible expansion state.
                        ZStack(alignment: .topLeading) {
                            measuredText(lineLimit: collapsedLineLimit, width: geometry.size.width)
                            measuredText(lineLimit: nil, width: geometry.size.width)
                        }
                    }
                    .hidden()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }

            if hasOverflow {
                JarvisLabelledButton(
                    title: toggleTitle,
                    trailingSystemImage: isExpanded ? "chevron.up" : "chevron.down",
                    identifier: "factory.request.toggle",
                    accessibilityValue: toggleTitle
                ) {
                    isExpanded.toggle()
                }
            }
        }
        .onPreferenceChange(FactoryRequestHeightPreference.self) { heights in
            guard let collapsed = heights[collapsedLineLimit],
                  let full = heights[0] else { return }
            let overflows = full > collapsed + 0.5
            if hasOverflow != overflows {
                hasOverflow = overflows
            }
        }
        .onChange(of: request) { _, _ in
            isExpanded = false
        }
    }

    private func measuredText(lineLimit: Int?, width: CGFloat) -> some View {
        requestText
            .lineLimit(lineLimit)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: width, alignment: .leading)
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: FactoryRequestHeightPreference.self,
                        value: [lineLimit ?? 0: geometry.size.height]
                    )
                }
            }
    }
}

private struct FactoryRequestHeightPreference: PreferenceKey {
    static var defaultValue: [Int: CGFloat] { [:] }

    static func reduce(value: inout [Int: CGFloat], nextValue: () -> [Int: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
    }
}
