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

/// Cluster colours for the graph: Work amber, Personal green, General muted violet, everything else neutral. Every
/// cluster also carries its folder name, so colour never carries the meaning alone.
enum JarvisNotesGraphPalette {
    static func color(_ scope: JarvisGraphScope) -> Color {
        switch scope {
        case .work: JarvisDesignTokens.primaryAccent
        case .personal: JarvisDesignTokens.notesFolderPersonal
        case .general: JarvisDesignTokens.notesFolderGeneral
        case .other: Color.secondary
        }
    }
}
