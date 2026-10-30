import Foundation
import JarvisCore

enum JarvisFixtureScenario {
    static func makeClient() throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!
            ),
            transport: FixtureTransport(scenario: Data(scenario.utf8)),
            tokenStore: FixtureTokenStore(),
            accessTokenProvider: FixtureTokenProvider()
        )
    }

    private static let scenario = #"""
    {
      "version": 1,
      "interactions": [
        {
          "method":"GET","path":"/api/conversation/history","query":{"limit":"50"},
          "response":{"statusCode":200,"body":{
            "messages":[
              {"id":"410","sessionId":"12","channel":"chat","language":"en","role":"dan","text":"Can you review the latest release?","model":null,"interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:32:00Z","toolCalls":[],"attachments":[]},
              {"id":"411","sessionId":"12","channel":"chat","language":"en","role":"jarvis","text":"I checked the candidate and the available checks passed.","model":"fixture","interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:32:40Z","toolCalls":[{"id":"fixture-tool-1","tool":"list_release","outcome":"ok","taskId":null,"artifactId":null}],"attachments":[]},
              {"id":"412","sessionId":"12","channel":"chat","language":"en","role":"dan","text":"What still needs my attention?","model":null,"interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:34:00Z","toolCalls":[],"attachments":[]},
              {"id":"413","sessionId":"12","channel":"chat","language":"en","role":"jarvis","text":"One request is waiting for your decision.","model":"fixture","interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:34:20Z","toolCalls":[],"attachments":[]}
            ],
            "nextCursor":null
          }}
        },
        {
          "method":"GET","path":"/api/now",
          "response":{"statusCode":200,"body":{
            "running":[{"id":"21","title":"Synthetic release task","project":"fixture","agent":"copilot","activity":"Checking the release","startedAt":"2026-10-30T09:30:00Z"}],
            "items":[
              {"id":"22","category":"attention","title":"Synthetic task needs attention","link":"task:21","at":"2026-10-30T09:30:00Z"},
              {"id":"23","category":"release","title":"Synthetic deployment update","link":"release:23","at":"2026-10-30T09:31:00Z"},
              {"id":"24","category":"credential","title":"Synthetic credential warning","link":null,"at":"2026-10-30T09:32:00Z"},
              {"id":"25","category":"alert","title":"Synthetic alert","link":null,"at":"2026-10-30T09:33:00Z"}
            ],
            "updatedAt":"2026-10-30T09:34:00Z",
            "awayMode":false,
            "confirmations":[{"id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","actionKind":"other","summary":"Synthetic confirmation awaiting a decision.","expiresAt":"2026-10-30T09:39:00Z"}]
          }}
        },
        {
          "method":"GET","path":"/api/conversation/turns/active",
          "response":{"statusCode":200,"body":{"turns":[]}}
        },
        {
          "method":"POST","path":"/api/conversation/sessions/12/turns",
          "stream":{"statusCode":200,"headers":{"Content-Type":"text/event-stream"},"chunks":[
            {"text":"event: user\ndata: {\"id\":\"430\",\"sessionId\":\"12\",\"role\":\"dan\",\"text\":\"The fixture turn\",\"model\":null,\"at\":\"2026-10-30T09:35:00Z\"}\n\n"},
            {"text":"event: delta\ndata: {\"text\":\"This response is \"}\n\n","delayMilliseconds":30},
            {"text":"event: delta\ndata: {\"text\":\"synthetic.\"}\n\n","delayMilliseconds":30},
            {"text":"event: done\ndata: {\"id\":\"431\",\"sessionId\":\"12\",\"role\":\"jarvis\",\"text\":\"This response is synthetic.\",\"model\":\"fixture\",\"at\":\"2026-10-30T09:35:01Z\"}\n\n"}
          ]}
        },
        {
          "method":"GET","path":"/api/conversation/history","query":{"limit":"50","sessionId":"12"},
          "response":{"statusCode":200,"body":{"messages":[
            {"id":"430","sessionId":"12","channel":"chat","language":"en","role":"dan","text":"The fixture turn","model":null,"interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:35:00Z","toolCalls":[],"attachments":[]},
            {"id":"431","sessionId":"12","channel":"chat","language":"en","role":"jarvis","text":"This response is synthetic.","model":"fixture","interrupted":false,"voiceMinutes":null,"at":"2026-10-30T09:35:01Z","toolCalls":[],"attachments":[]}
          ],"nextCursor":null}}
        }
      ]
    }
    """#
}

private actor FixtureTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct FixtureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
