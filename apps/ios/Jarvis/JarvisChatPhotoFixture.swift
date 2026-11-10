import JarvisCore
import UIKit

/// Clearly synthetic, simulator-only inputs for the real composer and history presentation.
enum JarvisChatPhotoFixture {
    static var isEnabled: Bool {
#if DEBUG && targetEnvironment(simulator)
        ProcessInfo.processInfo.arguments.contains("--ui-test-chat-photos")
#else
        false
#endif
    }

    static let portraitID = "00000000-0000-4000-8000-000000000001"
    static let landscapeID = "00000000-0000-4000-8000-000000000002"
    static let fileID = "00000000-0000-4000-8000-000000000003"
    static let expiredID = "00000000-0000-4000-8000-000000000004"

    static var pending: [PendingChatAttachment] {
        [
            PendingChatAttachment(name: "Synthetic portrait.jpg", contentType: "image/jpeg", data: image(portrait: true)),
            PendingChatAttachment(name: "Synthetic landscape.jpg", contentType: "image/jpeg", data: image(portrait: false)),
            PendingChatAttachment(name: "Synthetic notes.txt", contentType: "text/plain", data: Data("Synthetic file".utf8)),
        ]
    }

    static func imageData(id: String) throws -> Data {
        switch id {
        case portraitID: image(portrait: true)
        case landscapeID: image(portrait: false)
        default: throw JarvisClientError.httpStatus(404)
        }
    }

    static var history: [[String: Any]] {
        [[
            "id": "40", "sessionId": "12", "channel": "chat", "language": "en", "role": "dan",
            "text": "", "at": "2026-11-06T12:00:00Z", "interrupted": false, "toolCalls": [],
            "attachments": [
                metadata(id: portraitID, name: "Synthetic saved portrait.jpg", type: "image/jpeg", size: 100),
                metadata(id: expiredID, name: "Synthetic expired.jpg", type: "image/jpeg", size: 100),
            ],
        ]]
    }

    static func upload(_ body: Data) -> [String: Any]? {
        let multipart = String(decoding: body, as: UTF8.self)
        for (index, attachment) in pending.enumerated()
        where multipart.contains("filename=\"\(attachment.name)\"") {
            var value = metadata(
                id: [portraitID, landscapeID, fileID][index],
                name: attachment.name, type: attachment.contentType, size: attachment.data.count
            )
            value["status"] = "ready"
            return value
        }
        return nil
    }

    private static func metadata(id: String, name: String, type: String, size: Int) -> [String: Any] {
        ["id": id, "name": name, "contentType": type, "size": size]
    }

    private static func image(portrait: Bool) -> Data {
        let size = portrait ? CGSize(width: 120, height: 180) : CGSize(width: 180, height: 120)
        return UIGraphicsImageRenderer(size: size).image { context in
            (portrait ? UIColor.systemOrange : UIColor.systemTeal).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            ("SYNTHETIC\n\(portrait ? "Portrait" : "Landscape")" as NSString).draw(
                at: CGPoint(x: 8, y: 12),
                withAttributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.black]
            )
        }.jpegData(compressionQuality: 0.9)!
    }
}
