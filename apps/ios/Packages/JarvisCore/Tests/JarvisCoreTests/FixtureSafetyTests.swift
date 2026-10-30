import Foundation
import XCTest
@testable import JarvisCore

final class FixtureSafetyTests: XCTestCase {
    func testEveryFixtureResourceContainsOnlySyntheticData() throws {
        let root = try XCTUnwrap(Bundle.module.url(
            forResource: "short-chat", withExtension: "json", subdirectory: "Resources"
        )).deletingLastPathComponent()
        let enumerator = try XCTUnwrap(FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: [.isRegularFileKey]
        ))
        var scanned = 0
        for case let url as URL in enumerator {
            guard try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { continue }
            let text = try String(contentsOf: url, encoding: .utf8)
            XCTAssertEqual(fixtureSafetyViolations(text), [], url.lastPathComponent)
            scanned += 1
        }
        XCTAssertGreaterThanOrEqual(scanned, 7)
    }

    func testSafetyScannerRejectsEmailsBearerTokensOpaqueIDsAndRealHosts() {
        let samples: [(String, String)] = [
            ("fake.person" + "@example.test", "email"),
            (["Bear", "er"].joined() + " fake-credential", "bearer"),
            (String(repeating: "A", count: 43), "opaqueID"),
            ("https://" + "production.company.com" + "/path", "hostname"),
            ("production.company.com", "hostname"),
            ("https://192.0.2.1/path", "hostname"),
            ("http://localhost", "hostname"),
            ("http://fixture-host", "hostname"),
        ]
        for (sample, expected) in samples {
            XCTAssertTrue(fixtureSafetyViolations(sample).contains(expected), sample)
        }
    }

    func testSafetyScannerAllowsExplicitFakeIDsAndReservedHosts() {
        XCTAssertEqual(fixtureSafetyViolations("""
        fake_confirmation_0000000000000000000000000
        https://fixture.test/path https://sub.example.com https://example.net
        https://example.org https://demo.invalid https://demo.example
        """), [])
    }
}

private func fixtureSafetyViolations(_ text: String) -> [String] {
    func matches(_ pattern: String) -> [String] {
        let regex = try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap {
            Range($0.range, in: text).map { String(text[$0]) }
        }
    }
    var failures: [String] = []
    if !matches(#"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#).isEmpty { failures.append("email") }
    if !matches(#"\bbearer\s+[A-Z0-9._~+/-]+=*"#).isEmpty { failures.append("bearer") }
    if matches(#"(?<![A-Z0-9_-])[A-Z0-9_-]{43}(?![A-Z0-9_-])"#).contains(where: {
        !$0.lowercased().hasPrefix("fake_")
    }) { failures.append("opaqueID") }
    let hosts = matches(#"\b(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,63}\b"#)
    let forbiddenHost = hosts.contains {
        let host = $0.lowercased()
        return !["test", "invalid", "example", "example.com", "example.net", "example.org"].contains {
            host == $0 || host.hasSuffix("." + $0)
        }
    }
    let ipHosts = matches(#"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b"#)
    // URL parsing also covers IPv6 and single-label hosts that a domain regex misses.
    let urlHosts = matches(#"https?://[^\s"'\\<>]+"#).compactMap { URL(string: $0)?.host }
    let forbiddenURL = urlHosts.contains { host in
        let host = host.lowercased()
        return !["test", "invalid", "example", "example.com", "example.net", "example.org"].contains {
            host == $0 || host.hasSuffix("." + $0)
        }
    }
    if forbiddenHost || !ipHosts.isEmpty || forbiddenURL { failures.append("hostname") }
    return failures
}
