import JarvisCore
import SwiftUI

enum JarvisNotesFolderPalette {
    static func color(_ folder: String) -> Color {
        switch folder.split(separator: "/").first?.lowercased() {
        case "work": JarvisDesignTokens.primaryAccent
        case "personal": JarvisDesignTokens.notesFolderPersonal
        case "people": JarvisDesignTokens.ambientWarm
        default: Color.secondary
        }
    }
}
