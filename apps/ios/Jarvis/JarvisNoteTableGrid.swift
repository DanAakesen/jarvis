import JarvisCore
import SwiftUI

struct JarvisNoteTableGrid: View {
    @Binding var block: JarvisMarkdownBlock

    var body: some View {
        if let table = block.table {
            VStack(spacing: 6) {
                ScrollView(.horizontal) {
                    Grid(horizontalSpacing: 1, verticalSpacing: 1) {
                        ForEach(table.rows.indices, id: \.self) { row in
                            GridRow {
                                ForEach(table.rows[row].indices, id: \.self) { column in
                                    TextField(row == 0 ? "Heading \(column + 1)" : "", text: cell(row, column))
                                        .font(row == 0 ? .body.weight(.semibold) : .body)
                                        .padding(.horizontal, 8).frame(width: 145, height: 44)
                                        .background((JarvisSurfacePalette.shared.color("field") ?? Color.primary).opacity(row == 0 ? 0.15 : 0.075))
                                        .accessibilityLabel("Row \(row + 1), column \(column + 1)")
                                }
                            }
                        }
                    }.clipShape(RoundedRectangle(cornerRadius: 9))
                }
                HStack {
                    JarvisLabelledButton(title: "Row", systemImage: "plus", isCompact: true) { update { $0.addRow() } }
                    JarvisLabelledButton(title: "Column", systemImage: "plus", isCompact: true) { update { $0.addColumn() } }
                    Spacer()
                    JarvisIconButton(title: "Edit table as Markdown", systemImage: "chevron.left.forwardslash.chevron.right",
                                     identifier: "editor.table.markdown") { block.table = nil }
                }
            }
        }
    }

    private func cell(_ row: Int, _ column: Int) -> Binding<String> {
        Binding(get: {
            guard let rows = block.table?.rows, rows.indices.contains(row), rows[row].indices.contains(column) else { return "" }
            return rows[row][column]
        }, set: { value in update { $0.set(value, row: row, column: column) } })
    }

    private func update(_ change: (inout JarvisMarkdownTable) -> Void) {
        guard var table = block.table else { return }
        change(&table)
        block.table = table
        block.text = table.markdown
    }
}
